import { tr } from "./i18n";
import type JSZip from "jszip";

/** アーカイブの項目を展開している途中で、許される最大のバイト数を超えた。 */
export class ZipEntryTooLargeError extends Error {
  constructor() {
    super(tr("The ZIP expands beyond the size limit."));
  }
}

// JSZip は実行時に internalStream を公開しているが、インストールされた型の宣言には、
// このストリームの API が含まれていない。ここで、その使う部分の型を明示する。
interface ZipByteStream {
  on(event: "data", callback: (chunk: Uint8Array) => void): ZipByteStream;
  on(event: "error", callback: (error: Error) => void): ZipByteStream;
  on(event: "end", callback: () => void): ZipByteStream;
  pause(): ZipByteStream;
  resume(): ZipByteStream;
}

// ZIP は、展開後のバイト列の標準の CRC-32 を保存している。検証するのは、上限の範囲で
// 実際に読む項目だけ。先に CRC を確かめると、ZIP 全体を展開することになる。
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let bit = 0; bit < 8; bit++) n = (n >>> 1) ^ (n & 1 ? 0xedb88320 : 0);
  return n;
});

/** *実際の* 出力が上限を超えた時点で、すぐに展開を止める。 */
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
