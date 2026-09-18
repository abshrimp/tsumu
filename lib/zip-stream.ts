import { tr } from "./i18n";
import type JSZip from "jszip";
import { zipEntrySize } from "./zip-directory";

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
    const declared = zipEntrySize(entry);
    if (declared !== null && declared > maxBytes) throw new ZipEntryTooLargeError();
    const limit = declared ?? maxBytes;
    // 検証済みの長さがある項目は、展開したチャンクを出力先に直接書き込む。
    const output = retain && declared !== null ? new Uint8Array(declared) : null;
    const stream = (entry as JSZip.JSZipObject & {
      internalStream(type: "uint8array"): ZipByteStream;
    }).internalStream("uint8array");
    const metadata = (entry as { _data?: { uncompressedSize?: number; crc32?: number } })._data;
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
      if (output) output.set(chunk, length - chunk.byteLength);
      else if (retain) chunks.push(chunk.slice());
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
      if (declared !== null && length !== declared) {
        reject(new Error("ZIP length mismatch: " + entry.name));
        return;
      }
      if (output) { resolve(output); return; }
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
