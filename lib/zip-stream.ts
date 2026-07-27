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

/** Stop decompression as soon as its *actual* output exceeds the limit. */
export function readZipEntryLimited(entry: JSZip.JSZipObject, maxBytes: number): Promise<Uint8Array<ArrayBuffer>> {
  return new Promise((resolve, reject) => {
    const stream = (entry as JSZip.JSZipObject & {
      internalStream(type: "uint8array"): ZipByteStream;
    }).internalStream("uint8array");
    const chunks: Uint8Array[] = [];
    let length = 0;
    let settled = false;
    stream.on("data", (chunk) => {
      if (settled) return;
      length += chunk.byteLength;
      if (length > maxBytes) {
        settled = true;
        stream.pause();
        reject(new ZipEntryTooLargeError());
        return;
      }
      chunks.push(chunk.slice());
    }).on("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    }).on("end", () => {
      if (settled) return;
      settled = true;
      const result = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.byteLength;
      }
      resolve(result);
    }).resume();
  });
}
