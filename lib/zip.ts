import { base64ToBytes as decodeBase64, bytesToBase64 as encodeBase64 } from "./base64";

const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let bit = 0; bit < 8; bit++) n = (n >>> 1) ^ (n & 1 ? 0xedb88320 : 0);
  return n;
});

const CP437 =
  "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»" +
  "░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀" +
  "αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■\u00a0";

const utf8Encoder = new TextEncoder();
const utf8Decoder = new TextDecoder("utf-8");
const utf8FatalDecoder = new TextDecoder("utf-8", { fatal: true });

function computeCrc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.byteLength; i++) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ bytes[i]) & 255];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function decodeZipName(bytes: Uint8Array, utf8Flag: boolean, onInvalid: () => Error): string {
  if (utf8Flag) {
    try {
      return utf8FatalDecoder.decode(bytes);
    } catch {
      throw onInvalid();
    }
  }
  let ascii = true;
  for (let i = 0; i < bytes.byteLength; i++) {
    if (bytes[i] >= 0x80) {
      ascii = false;
      break;
    }
  }
  if (ascii) return utf8Decoder.decode(bytes);
  let out = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    const byte = bytes[i];
    out += byte < 0x80 ? String.fromCharCode(byte) : CP437[byte - 0x80];
  }
  return out;
}

async function deflateRaw(bytes: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([new Uint8Array(bytes)])
    .stream()
    .pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function verifyEmptyDeflateStream(bytes: Uint8Array, onInvalid: () => Error): Promise<void> {
  const reader = new Blob([new Uint8Array(bytes)])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"))
    .getReader();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      if (value.byteLength > 0) {
        await reader.cancel().catch(() => {});
        throw onInvalid();
      }
    }
  } catch (err) {
    if (err instanceof Error) throw onInvalid();
    throw err;
  } finally {
    reader.releaseLock();
  }
}

export class ZipEntry {
  name: string;
  dir: boolean;
  uncompressedSize?: number;
  crc32: number;
  method: number;
  unixPermissions: number | null;
  readonly compressedData: Uint8Array;

  constructor(init: {
    name: string;
    dir: boolean;
    uncompressedSize: number;
    crc32: number;
    method: number;
    unixPermissions: number | null;
    compressedData: Uint8Array;
  }) {
    this.name = init.name;
    this.dir = init.dir;
    this.uncompressedSize = init.uncompressedSize;
    this.crc32 = init.crc32;
    this.method = init.method;
    this.unixPermissions = init.unixPermissions;
    this.compressedData = init.compressedData;
  }

  bytes(
    maxBytes = Number.MAX_SAFE_INTEGER,
    onTooLarge?: () => Error,
  ): Promise<Uint8Array<ArrayBuffer>> {
    return readZipBytes(this, maxBytes, onTooLarge);
  }

  async text(maxBytes = Number.MAX_SAFE_INTEGER): Promise<string> {
    return utf8Decoder.decode(await this.bytes(maxBytes));
  }

  async base64(maxBytes = Number.MAX_SAFE_INTEGER): Promise<string> {
    return encodeBase64(await this.bytes(maxBytes));
  }

  async arrayBuffer(maxBytes = Number.MAX_SAFE_INTEGER): Promise<ArrayBuffer> {
    return (await this.bytes(maxBytes)).buffer;
  }
}

export interface ZipOpenOptions {
  maxRecords?: number;
  maxExpandedBytes?: number;
  onTooManyRecords?: (records: number) => Error;
  onInvalidDirectory?: () => Error;
  onDuplicatePath?: () => Error;
}

interface ParsedMember {
  name: string;
  dir: boolean;
  start: number;
  data: number;
  end: number;
  size: number;
  crc32: number;
  method: number;
  unixPermissions: number | null;
  next: number;
}

export class ZipArchive {
  readonly files: Record<string, ZipEntry>;
  readonly entries: readonly ZipEntry[];

  constructor(entries: ZipEntry[]) {
    this.entries = entries;
    const map: Record<string, ZipEntry> = Object.create(null);
    for (const entry of entries) map[entry.name] = entry;
    this.files = map;
  }

  file(name: string): ZipEntry | null {
    const entry = Object.hasOwn(this.files, name) ? this.files[name] : undefined;
    return entry && !entry.dir ? entry : null;
  }

  static async open(
    source: Uint8Array | ArrayBuffer,
    options: ZipOpenOptions = {},
  ): Promise<ZipArchive> {
    const bytes = source instanceof Uint8Array ? source : new Uint8Array(source);
    const invalid = options.onInvalidDirectory ?? (() => new Error("The ZIP file directory is invalid."));
    const duplicate = options.onDuplicatePath ?? (() => new Error("The ZIP contains duplicate file paths."));
    const maxExpanded = options.maxExpandedBytes ?? Number.MAX_SAFE_INTEGER;
    const checkRecords = (count: number) => {
      if (options.maxRecords !== undefined && count > options.maxRecords) {
        throw options.onTooManyRecords ? options.onTooManyRecords(count) : new Error("The ZIP contains too many files.");
      }
    };

    if (bytes.byteLength < 22) throw invalid();
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const u16 = (i: number) => view.getUint16(i, true);
    const u32 = (i: number) => view.getUint32(i, true);

    let end = bytes.byteLength - 22;
    const min = Math.max(0, end - 65535);
    while (end >= min && (u32(end) !== 0x06054b50 || end + 22 + u16(end + 20) !== bytes.byteLength)) {
      end--;
    }
    if (end < min) throw invalid();

    let records = u16(end + 10);
    let size = u32(end + 12);
    let offset = u32(end + 16);
    let centralEnd = end;

    if (
      records === 0xffff ||
      size === 0xffffffff ||
      offset === 0xffffffff ||
      u16(end + 4) === 0xffff ||
      u16(end + 6) === 0xffff ||
      u16(end + 8) === 0xffff
    ) {
      const locator = end - 20;
      centralEnd = locator - 56;
      if (
        centralEnd < 0 ||
        u32(locator) !== 0x07064b50 ||
        view.getBigUint64(locator + 8, true) !== BigInt(centralEnd) ||
        u32(centralEnd) !== 0x06064b50 ||
        view.getBigUint64(centralEnd + 4, true) !== 44n ||
        u32(locator + 4) !== 0 ||
        u32(locator + 16) !== 1 ||
        u32(centralEnd + 16) !== 0 ||
        u32(centralEnd + 20) !== 0 ||
        view.getBigUint64(centralEnd + 24, true) !== view.getBigUint64(centralEnd + 32, true)
      ) {
        throw invalid();
      }
      const r64 = view.getBigUint64(centralEnd + 32, true);
      const s64 = view.getBigUint64(centralEnd + 40, true);
      const o64 = view.getBigUint64(centralEnd + 48, true);
      if (
        r64 > BigInt(Number.MAX_SAFE_INTEGER) ||
        s64 > BigInt(Number.MAX_SAFE_INTEGER) ||
        o64 > BigInt(Number.MAX_SAFE_INTEGER)
      ) {
        throw invalid();
      }
      records = Number(r64);
      size = Number(s64);
      offset = Number(o64);
    } else if (u16(end + 4) !== 0 || u16(end + 6) !== 0 || u16(end + 8) !== records) {
      throw invalid();
    }

    const centralStart = centralEnd - size;
    if (centralStart < 0 || offset > centralStart) throw invalid();
    checkRecords(records);

    const prefix = centralStart - offset;
    const members: ParsedMember[] = [];
    let pos = centralStart;

    while (pos < centralEnd) {
      if (pos + 46 > centralEnd || u32(pos) !== 0x02014b50) throw invalid();
      checkRecords(members.length + 1);

      const versionMadeBy = u16(pos + 4);
      const flags = u16(pos + 8);
      const method = u16(pos + 10);
      const crc32 = u32(pos + 16);
      let compressed = u32(pos + 20);
      let uncompressed = u32(pos + 24);
      const nameLength = u16(pos + 28);
      const extra = pos + 46 + nameLength;
      const endExtra = extra + u16(pos + 30);
      const next = endExtra + u16(pos + 32);
      let disk = u16(pos + 34);
      const externalAttr = u32(pos + 38);
      let localRelOffset = u32(pos + 42);

      if (!nameLength || next > centralEnd || (flags & 1) !== 0 || (method !== 0 && method !== 8)) {
        throw invalid();
      }

      let hasZip64 = false;
      for (let p = extra; p < endExtra;) {
        if (p + 4 > endExtra) throw invalid();
        const id = u16(p);
        const fieldEnd = p + 4 + u16(p + 2);
        p += 4;
        if (fieldEnd > endExtra) throw invalid();
        if (id === 1) {
          if (hasZip64) throw invalid();
          hasZip64 = true;
          const readU64 = () => {
            if (p + 8 > fieldEnd) throw invalid();
            const n = view.getBigUint64(p, true);
            p += 8;
            if (n > BigInt(Number.MAX_SAFE_INTEGER)) throw invalid();
            return Number(n);
          };
          if (uncompressed === 0xffffffff) uncompressed = readU64();
          if (compressed === 0xffffffff) compressed = readU64();
          if (localRelOffset === 0xffffffff) localRelOffset = readU64();
          if (disk === 0xffff) {
            if (p + 4 > fieldEnd) throw invalid();
            disk = u32(p);
          }
        }
        p = fieldEnd;
      }

      if (disk !== 0 || uncompressed > maxExpanded || compressed > centralStart) throw invalid();
      const start = prefix + localRelOffset;
      if (
        start + 30 > centralStart ||
        u32(start) !== 0x04034b50 ||
        u16(start + 26) !== nameLength ||
        u16(start + 8) !== method
      ) {
        throw invalid();
      }
      const data = start + 30 + nameLength + u16(start + 28);
      if (data + compressed > centralStart) throw invalid();
      for (let i = 0; i < nameLength; i++) {
        if (view.getUint8(start + 30 + i) !== view.getUint8(pos + 46 + i)) throw invalid();
      }
      if ((method === 0 && uncompressed !== compressed) || (!uncompressed && crc32 !== 0)) {
        throw invalid();
      }

      const name = decodeZipName(bytes.subarray(pos + 46, pos + 46 + nameLength), (flags & 0x0800) !== 0, invalid);
      const hostOs = versionMadeBy >>> 8;
      const unixPermissions = hostOs === 3 ? externalAttr >>> 16 : null;
      const isDir =
        name.endsWith("/") ||
        (unixPermissions !== null && (unixPermissions & 0o170000) === 0o040000) ||
        (hostOs === 0 && !uncompressed && (externalAttr & 0x10) !== 0);

      members.push({
        name,
        dir: isDir,
        start,
        data,
        end: data + compressed,
        size: uncompressed,
        crc32,
        method,
        unixPermissions,
        next,
      });
      pos = next;
    }

    if (pos !== centralEnd || members.length !== records) throw invalid();

    let previousEnd = 0;
    for (const m of [...members].sort((a, b) => a.start - b.start)) {
      if (m.start < previousEnd) throw invalid();
      previousEnd = m.end;
      if (!m.size && m.method === 8) {
        await verifyEmptyDeflateStream(bytes.subarray(m.data, m.end), invalid);
      }
    }

    const seenNames = new Set<string>();
    const entries: ZipEntry[] = [];
    for (const m of members) {
      if (seenNames.has(m.name)) throw duplicate();
      seenNames.add(m.name);
      entries.push(
        new ZipEntry({
          name: m.name,
          dir: m.dir,
          uncompressedSize: m.size,
          crc32: m.crc32,
          method: m.method,
          unixPermissions: m.unixPermissions,
          compressedData: bytes.subarray(m.data, m.end),
        }),
      );
    }

    return new ZipArchive(entries);
  }
}

export async function readZipBytes(
  entry: ZipEntry,
  maxBytes: number,
  onTooLarge?: () => Error,
): Promise<Uint8Array<ArrayBuffer>> {
  return consumeZipBytes(entry, maxBytes, true, onTooLarge);
}

export async function verifyZipBytes(
  entry: ZipEntry,
  maxBytes: number,
  onTooLarge?: () => Error,
): Promise<void> {
  await consumeZipBytes(entry, maxBytes, false, onTooLarge);
}

async function consumeZipBytes(
  entry: ZipEntry,
  maxBytes: number,
  retain: boolean,
  onTooLarge: () => Error = () => new Error("The ZIP expands beyond the size limit."),
): Promise<Uint8Array<ArrayBuffer>> {
  const declared =
    typeof entry.uncompressedSize === "number" &&
    Number.isSafeInteger(entry.uncompressedSize) &&
    entry.uncompressedSize >= 0
      ? entry.uncompressedSize
      : null;
  if (declared !== null && declared > maxBytes) throw onTooLarge();
  const limit = declared ?? maxBytes;

  if (entry.method === 0) {
    const len = entry.compressedData.byteLength;
    if (len > limit) throw onTooLarge();
    if (computeCrc32(entry.compressedData) !== (entry.crc32 >>> 0)) {
      throw new Error("ZIP CRC-32 mismatch: " + entry.name);
    }
    if (declared !== null && len !== declared) {
      throw new Error("ZIP length mismatch: " + entry.name);
    }
    if (!retain) return new Uint8Array(0);
    const out = new Uint8Array(len);
    out.set(entry.compressedData);
    return out;
  }

  if (entry.method !== 8) {
    throw new Error("Unsupported ZIP compression method: " + entry.method);
  }
  if (!entry.compressedData.byteLength && declared === 0 && (entry.crc32 >>> 0) === 0) {
    return new Uint8Array(0);
  }

  const output = retain && declared !== null ? new Uint8Array(declared) : null;
  const chunks: Uint8Array[] = [];
  let length = 0;
  let crc = 0xffffffff;

  const reader = new Blob([new Uint8Array(entry.compressedData)])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"))
    .getReader();

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value || !value.byteLength) continue;
      length += value.byteLength;
      if (length > limit) {
        await reader.cancel().catch(() => {});
        throw onTooLarge();
      }
      for (let i = 0; i < value.byteLength; i++) {
        crc = (crc >>> 8) ^ crcTable[(crc ^ value[i]) & 255];
      }
      if (output) output.set(value, length - value.byteLength);
      else if (retain) chunks.push(value.slice());
    }
  } finally {
    reader.releaseLock();
  }

  if (((crc ^ 0xffffffff) >>> 0) !== (entry.crc32 >>> 0)) {
    throw new Error("ZIP CRC-32 mismatch: " + entry.name);
  }
  if (declared !== null && length !== declared) {
    throw new Error("ZIP length mismatch: " + entry.name);
  }
  if (output) return output;
  if (!retain) return new Uint8Array(0);

  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

export interface ZipWriteEntryOptions {
  base64?: boolean;
  unixPermissions?: number;
}

export interface ZipBuildOptions {
  compression?: "DEFLATE" | "STORE";
}

export interface ZipFolder {
  file(path: string, data: string | Uint8Array | ArrayBuffer, options?: ZipWriteEntryOptions): ZipFolder;
  folder(prefix: string): ZipFolder;
}

interface PendingZipRecord {
  name: string;
  dir: boolean;
  bytes: Uint8Array;
  unixPermissions?: number;
}

export class ZipBuilder {
  comment = "";
  private readonly records = new Map<string, PendingZipRecord>();

  file(
    path: string,
    data: string | Uint8Array | ArrayBuffer,
    options?: ZipWriteEntryOptions,
  ): this {
    const bytes =
      typeof data === "string"
        ? options?.base64
          ? decodeBase64(data)
          : utf8Encoder.encode(data)
        : data instanceof ArrayBuffer
          ? new Uint8Array(data)
          : data;
    this.records.set(path, {
      name: path,
      dir: false,
      bytes,
      unixPermissions: options?.unixPermissions,
    });
    return this;
  }

  folder(prefix: string): ZipFolder {
    const clean = prefix.replace(/^\/+|\/+$/g, "");
    const dirName = clean ? clean + "/" : "";
    if (dirName && !this.records.has(dirName)) {
      this.records.set(dirName, { name: dirName, dir: true, bytes: new Uint8Array(0) });
    }
    const scoped: ZipFolder = {
      file: (subPath, data, options) => {
        this.file(dirName + subPath.replace(/^\/+/, ""), data, options);
        return scoped;
      },
      folder: (subPrefix) => this.folder(dirName + subPrefix.replace(/^\/+/, "")),
    };
    return scoped;
  }

  async toBytes(options: ZipBuildOptions = {}): Promise<Uint8Array<ArrayBuffer>> {
    const compression = options.compression ?? "DEFLATE";
    const items = [...this.records.values()];
    if (items.length > 0xffff) throw new Error("Too many ZIP entries");

    const encoded = await Promise.all(
      items.map(async (item) => {
        const nameBytes = utf8Encoder.encode(item.name);
        const utf8Flag = /[^\x00-\x7f]/.test(item.name) ? 0x0800 : 0;
        const crc = item.dir || !item.bytes.byteLength ? 0 : computeCrc32(item.bytes);
        const useDeflate = compression === "DEFLATE" && !item.dir && item.bytes.byteLength > 0;
        const compressed = useDeflate ? await deflateRaw(item.bytes) : item.bytes;
        const method = useDeflate ? 8 : 0;
        return { item, nameBytes, utf8Flag, crc, compressed, method };
      }),
    );

    const commentBytes = this.comment ? utf8Encoder.encode(this.comment) : new Uint8Array(0);
    if (commentBytes.byteLength > 0xffff) throw new Error("ZIP comment is too long");

    let localSize = 0;
    let centralSize = 0;
    for (const entry of encoded) {
      localSize += 30 + entry.nameBytes.byteLength + entry.compressed.byteLength;
      centralSize += 46 + entry.nameBytes.byteLength;
    }
    const totalSize = localSize + centralSize + 22 + commentBytes.byteLength;
    if (totalSize > 0xffffffff) throw new Error("ZIP archive exceeds 4 GiB");

    const output = new Uint8Array(totalSize);
    const view = new DataView(output.buffer);
    let localOffset = 0;
    let centralOffset = localSize;

    for (const { item, nameBytes, utf8Flag, crc, compressed, method } of encoded) {
      const memberLocalOffset = localOffset;

      // Local file header (30 bytes)
      view.setUint32(localOffset, 0x04034b50, true);
      view.setUint16(localOffset + 4, 20, true);
      view.setUint16(localOffset + 6, utf8Flag, true);
      view.setUint16(localOffset + 8, method, true);
      view.setUint16(localOffset + 10, 0, true);
      view.setUint16(localOffset + 12, 0x0021, true);
      view.setUint32(localOffset + 14, crc, true);
      view.setUint32(localOffset + 18, compressed.byteLength, true);
      view.setUint32(localOffset + 22, item.bytes.byteLength, true);
      view.setUint16(localOffset + 26, nameBytes.byteLength, true);
      view.setUint16(localOffset + 28, 0, true);
      output.set(nameBytes, localOffset + 30);
      output.set(compressed, localOffset + 30 + nameBytes.byteLength);
      localOffset += 30 + nameBytes.byteLength + compressed.byteLength;

      // Central directory header (46 bytes)
      const versionMadeBy = item.unixPermissions !== undefined ? 0x0314 : 0x0014;
      const externalAttr =
        item.unixPermissions !== undefined
          ? ((item.unixPermissions & 0xffff) << 16) >>> 0
          : item.dir
            ? 0x10
            : 0;
      view.setUint32(centralOffset, 0x02014b50, true);
      view.setUint16(centralOffset + 4, versionMadeBy, true);
      view.setUint16(centralOffset + 6, 20, true);
      view.setUint16(centralOffset + 8, utf8Flag, true);
      view.setUint16(centralOffset + 10, method, true);
      view.setUint16(centralOffset + 12, 0, true);
      view.setUint16(centralOffset + 14, 0x0021, true);
      view.setUint32(centralOffset + 16, crc, true);
      view.setUint32(centralOffset + 20, compressed.byteLength, true);
      view.setUint32(centralOffset + 24, item.bytes.byteLength, true);
      view.setUint16(centralOffset + 28, nameBytes.byteLength, true);
      view.setUint16(centralOffset + 30, 0, true);
      view.setUint16(centralOffset + 32, 0, true);
      view.setUint16(centralOffset + 34, 0, true);
      view.setUint16(centralOffset + 36, 0, true);
      view.setUint32(centralOffset + 38, externalAttr, true);
      view.setUint32(centralOffset + 42, memberLocalOffset, true);
      output.set(nameBytes, centralOffset + 46);
      centralOffset += 46 + nameBytes.byteLength;
    }

    // End of central directory record (22 bytes + optional comment)
    view.setUint32(centralOffset, 0x06054b50, true);
    view.setUint16(centralOffset + 4, 0, true);
    view.setUint16(centralOffset + 6, 0, true);
    view.setUint16(centralOffset + 8, encoded.length, true);
    view.setUint16(centralOffset + 10, encoded.length, true);
    view.setUint32(centralOffset + 12, centralSize, true);
    view.setUint32(centralOffset + 16, localSize, true);
    view.setUint16(centralOffset + 20, commentBytes.byteLength, true);
    if (commentBytes.byteLength) output.set(commentBytes, centralOffset + 22);

    return output;
  }

  async toArrayBuffer(options?: ZipBuildOptions): Promise<ArrayBuffer> {
    return (await this.toBytes(options)).buffer;
  }

  async toBlob(options?: ZipBuildOptions): Promise<Blob> {
    return new Blob([await this.toBytes(options)], { type: "application/zip" });
  }
}
