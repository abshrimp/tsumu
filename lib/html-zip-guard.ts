import { tr } from "./i18n";
import type JSZip from "jszip";
import { IMPORT_LIMITS } from "./site-import";
import { zipEntrySize } from "./zip-directory";
import { ZIP_CSS_LIMITS } from "./zip-css";

export const isHtmlIndex = (path: string) => /(^|\/)index\.html?$/i.test(path);

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
    throw new Error(tr("A zip can contain up to 200 files"));
  }
  const paths = new Set<string>();
  let expanded = 0;
  let cssBytes = 0;

  for (const entry of files) {
    const name = entry.name;
    if ((entry.unsafeOriginalName && entry.unsafeOriginalName !== name) ||
        !name || name.includes("\\") || /[\u0000-\u001f\u007f]/.test(name) ||
        name.split("/").some((part) => !part || part === "." || part === "..")) {
      throw new Error(tr("The ZIP contains an unsafe path."));
    }
    // Avoid overwriting distinct assets on case-insensitive or Unicode-normalizing hosts.
    const canonical = name.normalize("NFC").toLowerCase();
    if (paths.has(canonical)) throw new Error(tr("The ZIP contains duplicate file paths."));
    paths.add(canonical);

    const size = zipEntrySize(entry);
    // Unknown/unsafe sizes cannot be used to bound a ZIP bomb before extraction.
    if (size === null) {
      throw new Error(tr("A file in the ZIP has an invalid size."));
    }
    expanded += size;
    if (expanded > HTML_ZIP_LIMITS.expandedBytes) {
      throw new Error(tr("The ZIP expands beyond the size limit."));
    }
    if (/\.html?$/i.test(name)) {
      if (size > HTML_ZIP_LIMITS.htmlBytes) throw new Error(tr("The HTML file in the ZIP is too large."));
    } else if (/\.css$/i.test(name)) {
      cssBytes += size;
      if (cssBytes > HTML_ZIP_LIMITS.cssBytes) throw new Error(tr("ZIP stylesheets must total 2 MB or less."));
    } else if (size > HTML_ZIP_LIMITS.assetBytes) {
      throw new Error(tr("An asset in the ZIP is too large."));
    }
  }

  const entries = files.filter((entry) =>
    !entry.name.startsWith("__MACOSX/") && !entry.name.endsWith(".DS_Store"));
  const htmlEntries = entries.filter((entry) => /\.html?$/i.test(entry.name));
  if (!htmlEntries.length) throw new Error(tr("No HTML file found in the zip"));
  // Archives may list a nested index before the site's home page.
  let htmlEntry = htmlEntries[0];
  let indexDepth = Infinity;
  for (const entry of htmlEntries) {
    if (!isHtmlIndex(entry.name)) continue;
    const depth = entry.name.split("/").length;
    if (depth < indexDepth) {
      indexDepth = depth;
      htmlEntry = entry;
    }
  }
  return { htmlEntries, htmlEntry, assetEntries: entries.filter((entry) => !/\.html?$/i.test(entry.name)) };
}

export { readZipEntryLimited } from "./zip-stream";
