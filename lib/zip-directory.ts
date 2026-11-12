import { tr } from "./i18n";
import JSZip from "jszip";
import { IMPORT_LIMITS } from "./site-import-format";

// JSZip は、検証済みの長さ 0 の CompressedObject を、"" を返す Promise に置き換える。
const emptyEntries = new WeakSet<JSZip.JSZipObject>();
export function zipEntrySize(entry: JSZip.JSZipObject): number | null {
  const size = (entry as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize;
  if (typeof size === "number" && Number.isSafeInteger(size) && size >= 0) return size;
  return emptyEntries.has(entry) ? 0 : null;
}

const invalid = () => new Error(tr("The ZIP file directory is invalid."));

function member(view: DataView, pos: number, directory: number, centralEnd: number, prefix: number) {
  const u16 = (i: number) => view.getUint16(i, true);
  const u32 = (i: number) => view.getUint32(i, true);
  const nameLength = u16(pos + 28);
  const extra = pos + 46 + nameLength, endExtra = extra + u16(pos + 30);
  const next = endExtra + u16(pos + 32);
  if (!nameLength || next > centralEnd) throw invalid();
  let size = u32(pos + 24), compressed = u32(pos + 20), offset = u32(pos + 42), disk = u16(pos + 34);
  // JSZip の 64 ビットの読み取りは、32 ビットの演算を使う。切り詰められた大きさや位置で、
  // ライブラリが見る項目が変わる前に、元の欄を検証する。
  let hasZip64 = false;
  for (let p = extra; p < endExtra;) {
    if (p + 4 > endExtra) throw invalid();
    const id = u16(p), end = p + 4 + u16(p + 2);
    p += 4;
    if (end > endExtra) throw invalid();
    if (id === 1) {
      if (hasZip64) throw invalid();
      hasZip64 = true;
      const field = () => {
        if (p + 8 > end) throw invalid();
        const n = view.getBigUint64(p, true);
        p += 8;
        if (n > BigInt(Number.MAX_SAFE_INTEGER)) throw invalid();
        return Number(n);
      };
      if (size === 0xffffffff) size = field();
      if (compressed === 0xffffffff) compressed = field();
      if (offset === 0xffffffff) offset = field();
      if (disk === 0xffff) { if (p + 4 > end) throw invalid(); disk = u32(p); }
    }
    p = end;
  }
  if (disk !== 0 || size > IMPORT_LIMITS.expandedBytes || compressed > directory) throw invalid();
  const start = prefix + offset;
  if (start + 30 > directory || u32(start) !== 0x04034b50 || u16(start + 26) !== nameLength ||
      u16(start + 8) !== u16(pos + 10)) throw invalid();
  const data = start + 30 + nameLength + u16(start + 28);
  if (data + compressed > directory) throw invalid();
  for (let i = 0; i < nameLength; i++) {
    if (view.getUint8(start + 30 + i) !== view.getUint8(pos + 46 + i)) throw invalid();
  }
  if ((u16(pos + 10) === 0 && size !== compressed) || (!size && u32(pos + 16) !== 0)) throw invalid();
  return { start, data, end: data + compressed, size, method: u16(pos + 10), next };
}

/** JSZip は、空と宣言された項目の圧縮済みのバイト列を捨てる。そうなる前に確かめる。 */
async function verifyEmptyStream(bytes: Uint8Array) {
  const reader = new Blob([new Uint8Array(bytes)]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      if (value.length) {
        await reader.cancel().catch(() => {});
        throw invalid();
      }
    }
  } finally { reader.releaseLock(); }
}

// JSZip は、まず物理的なすべての項目を実体化し、その後で正規化した名前で索引を作る。
// そのどちらの割り当てや重複の除去よりも前に、セントラルディレクトリの記録を数える。
export async function openImportZip(bytes: Uint8Array, maxFiles: number): Promise<JSZip> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (i: number) => view.getUint16(i, true);
  const u32 = (i: number) => view.getUint32(i, true);
  let end = bytes.length - 22;
  const min = Math.max(0, end - 65535);
  while (end >= min && (u32(end) !== 0x06054b50 || end + 22 + u16(end + 20) !== bytes.length)) end--;
  if (end < min) throw invalid();
  let records = u16(end + 10);
  let size = u32(end + 12);
  let offset = u32(end + 16);
  let centralEnd = end;

  if (records === 0xffff || size === 0xffffffff || offset === 0xffffffff ||
      u16(end + 4) === 0xffff || u16(end + 6) === 0xffff || u16(end + 8) === 0xffff) {
    // 上限があり、単一のボリュームの ZIP64 だけを扱う。JSZip は ZIP64 の拡張に対応していない。
    const locator = end - 20;
    centralEnd = locator - 56;
    if (centralEnd < 0 || u32(locator) !== 0x07064b50 ||
        view.getBigUint64(locator + 8, true) !== BigInt(centralEnd) ||
        u32(centralEnd) !== 0x06064b50 || view.getBigUint64(centralEnd + 4, true) !== 44n ||
        u32(locator + 4) !== 0 || u32(locator + 16) !== 1 ||
        u32(centralEnd + 16) !== 0 || u32(centralEnd + 20) !== 0 ||
        view.getBigUint64(centralEnd + 24, true) !== view.getBigUint64(centralEnd + 32, true)) throw invalid();
    records = Number(view.getBigUint64(centralEnd + 32, true));
    size = Number(view.getBigUint64(centralEnd + 40, true));
    offset = Number(view.getBigUint64(centralEnd + 48, true));
  } else if (u16(end + 4) !== 0 || u16(end + 6) !== 0 || u16(end + 8) !== records) throw invalid();
  const start = centralEnd - size;
  if (start < 0 || offset > start) throw invalid();
  // 形式のファイル数の上限に加えて、明示的なディレクトリの記録も許す。
  const maxRecords = maxFiles * 4;
  if (records > maxRecords) throw new Error(tr("The ZIP contains too many files."));
  const members: ReturnType<typeof member>[] = [];
  let pos = start;
  while (pos < centralEnd) {
    if (pos + 46 > centralEnd || u32(pos) !== 0x02014b50) throw invalid();
    if (members.length >= maxRecords) throw new Error(tr("The ZIP contains too many files."));
    const m = member(view, pos, start, centralEnd, start - offset);
    members.push(m);
    pos = m.next;
  }
  if (pos !== centralEnd || members.length !== records) throw invalid();
  let previousEnd = 0;
  for (const m of members.sort((a, b) => a.start - b.start)) {
    if (m.start < previousEnd) throw invalid();
    previousEnd = m.end;
    if (!m.size && m.method === 8) await verifyEmptyStream(bytes.subarray(m.data, m.end));
  }
  // 検証済みで表現できるディレクトリを、単一のボリュームの EOCD として渡す。
  // パーサーが、別の ZIP64 のロケーターや、コメントの中の EOCD を選ぶことがあってはならない。
  let input = bytes;
  if (centralEnd !== end || end + 22 !== bytes.length) {
    input = new Uint8Array(centralEnd + 22);
    input.set(bytes.subarray(0, centralEnd));
    const trailer = new DataView(input.buffer, centralEnd);
    trailer.setUint32(0, 0x06054b50, true);
    trailer.setUint16(8, records, true);
    trailer.setUint16(10, records, true);
    trailer.setUint32(12, size, true);
    trailer.setUint32(16, offset, true);
  }
  const zip = await JSZip.loadAsync(input);
  if (Object.keys(zip.files).length !== records) throw new Error(tr("The ZIP contains duplicate file paths."));
  for (const entry of Object.values(zip.files)) {
    if (!entry.dir && (entry as { _data?: unknown })._data instanceof Promise) emptyEntries.add(entry);
  }
  return zip;
}
