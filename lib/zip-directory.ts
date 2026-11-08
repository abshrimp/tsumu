import JSZip from "jszip";

// JSZip first materializes every physical entry and then indexes it by its
// normalized name. Count central records before either allocation or deduplication.
export async function openImportZip(bytes: Uint8Array, maxFiles: number): Promise<JSZip> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (i: number) => view.getUint16(i, true);
  const u32 = (i: number) => view.getUint32(i, true);
  const invalid = () => new Error("ZIPのファイル一覧が不正です。");
  let end = bytes.length - 22;
  const min = Math.max(0, end - 65535);
  while (end >= min && u32(end) !== 0x06054b50) end--;
  if (end < min || end + 22 + u16(end + 20) !== bytes.length) throw invalid();
  let records = u16(end + 10);
  let size = u32(end + 12);
  let offset = u32(end + 16);
  let centralEnd = end;

  if (records === 0xffff || size === 0xffffffff || offset === 0xffffffff ||
      u16(end + 4) === 0xffff || u16(end + 6) === 0xffff || u16(end + 8) === 0xffff) {
    // Bounded, single-volume ZIP64. JSZip does not support ZIP64 extensions.
    const locator = end - 20;
    centralEnd = locator - 56;
    if (centralEnd < 0 || u32(locator) !== 0x07064b50 ||
        view.getBigUint64(locator + 8, true) !== BigInt(centralEnd) ||
        u32(centralEnd) !== 0x06064b50 || view.getBigUint64(centralEnd + 4, true) !== 44n ||
        u32(centralEnd + 16) !== 0 || u32(centralEnd + 20) !== 0) throw invalid();
    records = Number(view.getBigUint64(centralEnd + 32, true));
    size = Number(view.getBigUint64(centralEnd + 40, true));
    offset = Number(view.getBigUint64(centralEnd + 48, true));
  }
  const start = centralEnd - size;
  if (start < 0 || offset > start) throw invalid();
  // Allow explicit directory records in addition to the format's file limit.
  const maxRecords = maxFiles * 4;
  if (records > maxRecords) throw new Error("ZIP内のファイルが多すぎます。");
  let count = 0;
  let pos = start;
  while (pos < centralEnd) {
    if (pos + 46 > centralEnd || u32(pos) !== 0x02014b50) throw invalid();
    if (++count > maxRecords) throw new Error("ZIP内のファイルが多すぎます。");
    pos += 46 + u16(pos + 28) + u16(pos + 30) + u16(pos + 32);
  }
  if (pos !== centralEnd || count !== records) throw invalid();
  const zip = await JSZip.loadAsync(bytes);
  if (Object.keys(zip.files).length !== count) throw new Error("ZIPに重複したファイルパスがあります。");
  return zip;
}
