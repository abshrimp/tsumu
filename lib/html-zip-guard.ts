import type JSZip from "jszip";
import { IMPORT_LIMITS } from "./site-import";
import { ZIP_CSS_LIMITS } from "./zip-css";

export const HTML_ZIP_LIMITS = {
  zipBytes: IMPORT_LIMITS.zipBytes,
  entries: 200,
  expandedBytes: IMPORT_LIMITS.expandedBytes,
  htmlBytes: IMPORT_LIMITS.docBytes,
  assetBytes: IMPORT_LIMITS.assetBytes,
  cssBytes: ZIP_CSS_LIMITS.source,
} as const;

type ZipEntry = JSZip.JSZipObject & {
  unsafeOriginalName?: string;
  _data?: { uncompressedSize?: number };
};

/**
 * Validate paths and advertised sizes before unpacking or uploading anything.
 * JSZip normalizes traversal paths; unsafeOriginalName preserves that evidence.
 */
export function inspectHtmlZip(zip: JSZip): {
  htmlEntries: JSZip.JSZipObject[];
  htmlEntry: JSZip.JSZipObject;
  assetEntries: JSZip.JSZipObject[];
} {
  const files = Object.values(zip.files).filter((entry) => !entry.dir) as ZipEntry[];
  if (files.length > HTML_ZIP_LIMITS.entries) {
    throw new Error("ZIPに入れられるファイルは200個までです");
  }
  const paths = new Set<string>();
  let expanded = 0;
  let cssBytes = 0;

  for (const entry of files) {
    const name = entry.name;
    if ((entry.unsafeOriginalName && entry.unsafeOriginalName !== name) ||
        !name || name.includes("\\") || /[\u0000-\u001f\u007f]/.test(name) ||
        name.split("/").some((part) => !part || part === "." || part === "..")) {
      throw new Error("ZIPに安全でないファイルパスがあります。");
    }
    // Avoid overwriting distinct assets on case-insensitive or Unicode-normalizing hosts.
    const canonical = name.normalize("NFC").toLowerCase();
    if (paths.has(canonical)) throw new Error("ZIPに重複したファイルパスがあります。");
    paths.add(canonical);

    const size = entry._data?.uncompressedSize;
    // Unknown/unsafe sizes cannot be used to bound a ZIP bomb before extraction.
    if (!Number.isSafeInteger(size) || size! < 0) {
      throw new Error("ZIP内のファイルサイズが正しくありません。");
    }
    expanded += size!;
    if (expanded > HTML_ZIP_LIMITS.expandedBytes) {
      throw new Error("ZIP展開後のデータが大きすぎます。");
    }
    if (/\.html?$/i.test(name)) {
      if (size! > HTML_ZIP_LIMITS.htmlBytes) throw new Error("ZIP内のHTMLが大きすぎます。");
    } else if (/\.css$/i.test(name)) {
      cssBytes += size!;
      if (cssBytes > HTML_ZIP_LIMITS.cssBytes) throw new Error("ZIP内のCSSは合計2MBまでです");
    } else if (size! > HTML_ZIP_LIMITS.assetBytes) {
      throw new Error("ZIP内のアセットが大きすぎます。");
    }
  }

  const entries = files.filter((entry) =>
    !entry.name.startsWith("__MACOSX/") && !entry.name.endsWith(".DS_Store"));
  const htmlEntries = entries.filter((entry) => /\.html?$/i.test(entry.name));
  if (!htmlEntries.length) throw new Error("ZIP内にHTMLファイルが見つかりません");
  const htmlEntry = htmlEntries.find((entry) => /(^|\/)index\.html?$/i.test(entry.name)) ?? htmlEntries[0];
  return { htmlEntries, htmlEntry, assetEntries: entries.filter((entry) => !/\.html?$/i.test(entry.name)) };
}

/** Stop decompression as soon as its *actual* output exceeds the limit. */
export function readZipEntryLimited(entry: JSZip.JSZipObject, maxBytes: number): Promise<Uint8Array<ArrayBuffer>> {
  return new Promise((resolve, reject) => {
    const stream = entry.internalStream("uint8array");
    const chunks: Uint8Array[] = [];
    let length = 0;
    let settled = false;
    stream.on("data", (chunk) => {
      if (settled) return;
      length += chunk.byteLength;
      if (length > maxBytes) {
        settled = true;
        stream.pause();
        reject(new Error("ZIP展開後のデータが大きすぎます。"));
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
