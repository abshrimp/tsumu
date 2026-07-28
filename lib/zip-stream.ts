import type JSZip from "jszip";

/** An archive entry exceeded the maximum allowed bytes while being decompressed. */
export class ZipEntryTooLargeError extends Error {
  constructor() {
    super("ZIP展開後のデータが大きすぎます。");
  }
}

// JSZip exposes internalStream at runtime, but the installed type declaration
// does not include this streaming API. Keep its surface explicitly typed here.
interface ZipByteStream {
  on(event: "data", callback: (chunk: Uint8Array) => void): ZipByteStream;
  on(event: "error", callback: (error: Error) => void): ZipByteStream;
  on(event: "end", callback: () => void): ZipByteStream;
  pause(): ZipByteStream;
  resume(): ZipByteStream;
}

// ZIP stores the standard CRC-32 of the uncompressed bytes. Validate only the
// bounded members being consumed; eager CRC checking would inflate the entire ZIP.
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let bit = 0; bit < 8; bit++) n = (n >>> 1) ^ (n & 1 ? 0xedb88320 : 0);
  return n;
});

/** Stop decompression as soon as its *actual* output exceeds the limit. */
export function readZipEntryLimited(entry: JSZip.JSZipObject, maxBytes: number): Promise<Uint8Array<ArrayBuffer>> {
  return consumeZipEntry(entry, maxBytes, true);
}

export async function verifyZipEntry(entry: JSZip.JSZipObject, maxBytes: number): Promise<void> {
  await consumeZipEntry(entry, maxBytes, false);
}

function consumeZipEntry(entry: JSZip.JSZipObject, maxBytes: number, retain: boolean): Promise<Uint8Array<ArrayBuffer>> {
  return new Promise((resolve, reject) => {
    const stream = (entry as JSZip.JSZipObject & {
      internalStream(type: "uint8array"): ZipByteStream;
    }).internalStream("uint8array");
    const metadata = (entry as { _data?: { uncompressedSize?: number; crc32?: number } })._data;
    const declared = metadata?.uncompressedSize;
    const limit = typeof declared === "number" ? Math.min(declared, maxBytes) : maxBytes;
    const chunks: Uint8Array[] = [];
    let length = 0;
    let settled = false;
    let crc = 0xffffffff;
    stream.on("data", (chunk) => {
      if (settled) return;
      length += chunk.byteLength;
      if (length > limit) {
        settled = true;
        stream.pause();
        reject(new ZipEntryTooLargeError());
        return;
      }
      if (metadata?.crc32 !== undefined) for (const byte of chunk) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
      if (retain) chunks.push(chunk.slice());
    }).on("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    }).on("end", () => {
      if (settled) return;
      settled = true;
      if (metadata?.crc32 !== undefined && ((crc ^ 0xffffffff) >>> 0) !== (metadata.crc32 >>> 0)) {
        reject(new Error("ZIP CRC-32 mismatch: " + entry.name));
        return;
      }
      const result = new Uint8Array(retain ? length : 0);
      let offset = 0;
      for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.byteLength;
      }
      resolve(result);
    }).resume();
  });
}
