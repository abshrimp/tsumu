import { tr } from "./i18n";
import { rebindImportedAssetUrls } from "./imported-asset-urls";
import { sanitizeImportedInlineIcons } from "./imported-svg";
import { IMPORT_LIMITS, isImportObject, validateImportedDoc } from "./site-import-format";
import type JSZip from "jszip";
import { openImportZip, zipEntrySize } from "./zip-directory";
import type { SiteDoc } from "./types";
import { isEmbeddedAssetUrl, uploadStaticAsset } from "./assets";
import { decodePortableDoc } from "./portable-doc";
import { readZipEntryLimited, ZipEntryTooLargeError } from "./zip-stream";

export const EDITABLE_DOC_PATH = "_tsumu/doc.json";
export const EDITABLE_ASSETS_PATH = "_tsumu/assets.json";

export interface ArchiveAssetMap {
  version: 1;
  assets: Record<string, string>;
}

export interface SiteImport {
  doc: SiteDoc;
  /** 元のアセットの ID → アーカイブの中のバイト列（ある場合）。 */
  assets: Map<string, Uint8Array>;
  warnings: string[];
}

export { IMPORT_LIMITS, validateImportedDoc } from "./site-import-format";

const decoder = new TextDecoder("utf-8", { fatal: true });

function jsonText(bytes: Uint8Array): unknown {
  let content: string;
  try { content = decoder.decode(bytes); }
  catch { throw new Error(tr("The document must use UTF-8 encoding.")); }
  try { return JSON.parse(content.replace(/^\uFEFF/, "")) as unknown; }
  catch { throw new Error(tr("Could not parse doc.json as JSON.")); }
}

function pathOK(path: string): boolean {
  return !!path && !path.includes("\\") && !path.startsWith("/") &&
    !/[\u0000-\u001f\u007f]/.test(path) &&
    path.split("/").every((part) => part && part !== "." && part !== "..");
}
export function isEditorDocument(entry: JSZip.JSZipObject): boolean {
  return !entry.dir && /^(?:[^/]+\/)?_tsumu\/doc\.json$/i.test(entry.name);
}

export async function parseSiteImport(
  bytes: Uint8Array,
  mode: "zip" | "doc",
): Promise<SiteImport> {
  if (mode === "zip") return parseEditableZip(await openImportZip(bytes, IMPORT_LIMITS.entries));
  if (bytes.byteLength > IMPORT_LIMITS.docBytes) {
    throw new Error(tr("The import file is too large."));
  }
  return { doc: validateImportedDoc(await decodePortableDoc(jsonText(bytes), IMPORT_LIMITS.docBytes)),
    assets: new Map(), warnings: [] };
}

export async function parseEditableZip(zip: JSZip): Promise<SiteImport> {
  const entries = Object.values(zip.files).filter((entry) => !entry.dir);
  if (entries.length > IMPORT_LIMITS.entries) throw new Error(tr("The ZIP contains too many files."));
  for (const entry of entries) {
    const original = (entry as JSZip.JSZipObject & { unsafeOriginalName?: string }).unsafeOriginalName;
    if (original && original !== entry.name) {
      throw new Error(tr("The ZIP contains an unsafe path."));
    }
  }
  const editableDocs = entries.filter(isEditorDocument);
  if (editableDocs.length > 1) {
    throw new Error(tr("The ZIP contains multiple editor documents."));
  }
  let size = 0;
  const canonicalPaths = new Set<string>();
  for (const entry of entries) {
    if (!pathOK(entry.name)) throw new Error(tr("The ZIP contains an unsafe path."));
    // 大文字と小文字を区別しない環境や、Unicode を正規化する環境でも、ZIP の中の項目が
    // 一意に決まらなければならない。
    const canonical = entry.name.normalize("NFC").toLowerCase();
    if (canonicalPaths.has(canonical)) throw new Error(tr("The ZIP contains duplicate file paths."));
    canonicalPaths.add(canonical);
    const n = zipEntrySize(entry);
    if (n === null) throw new Error(tr("A file in the ZIP has an invalid size."));
    if (n > IMPORT_LIMITS.expandedBytes || (size += n) > IMPORT_LIMITS.expandedBytes) {
      throw new Error(tr("The ZIP expands beyond the size limit."));
    }
  }
  const documentEntry = editableDocs[0];
  if (!documentEntry) {
    throw new Error(tr("The ZIP does not contain _tsumu/doc.json. Importing a plain HTML ZIP is a separate feature."));
  }
  const docBytes = await readZipEntryLimited(documentEntry, IMPORT_LIMITS.docBytes);
  if (docBytes.length > IMPORT_LIMITS.docBytes) throw new Error(tr("doc.json exceeds the size limit."));
  const doc = validateImportedDoc(await decodePortableDoc(jsonText(docBytes), IMPORT_LIMITS.docBytes));
  const root = documentEntry.name.replace(/_tsumu\/doc\.json$/i, "");
  const parent = documentEntry.name.slice(0, documentEntry.name.lastIndexOf("/") + 1);
  // アセットのパスは、アーカイブの中の明示的な対応表のファイルから読む。
  const mapEntry = zip.file(parent + "assets.json");
  if (!mapEntry) throw new Error(tr("The ZIP is missing _tsumu/assets.json."));
  const metadata = jsonText(await readZipEntryLimited(mapEntry, IMPORT_LIMITS.docBytes));
  if (!isImportObject(metadata) || metadata.version !== 1 ||
      !isImportObject(metadata.assets)) {
    throw new Error(tr("The ZIP asset manifest is invalid."));
  }
  const mapped = metadata.assets;
  if (new Set(Object.values(mapped)).size !== Object.keys(mapped).length ||
      Object.keys(mapped).length !== Object.keys(doc.assets).length ||
      Object.keys(mapped).some((id) => !Object.hasOwn(doc.assets, id) ||
        typeof mapped[id] !== "string" || !pathOK(mapped[id]))) {
    throw new Error(tr("The ZIP asset manifest is invalid."));
  }
  const assets = new Map<string, Uint8Array>();
  const warnings: string[] = [];
  for (const [id, original] of Object.entries(doc.assets)) {
    const location = mapped[id];
    if (typeof location !== "string" || !pathOK(location)) {
      throw new Error(tr("The ZIP asset manifest is invalid."));
    }
    const entry = zip.file(root + location);
    if (!entry) {
      if (!original.dataUrl) warnings.push(tr("The ZIP is missing an asset: {name}", { name: original.name }));
      continue;
    }
    const n = zipEntrySize(entry);
    if (n !== null && n > IMPORT_LIMITS.assetBytes) {
      warnings.push(tr("The asset is too large to import: {name}", { name: original.name }));
      continue;
    }
    try {
      const contents = await readZipEntryLimited(entry, IMPORT_LIMITS.assetBytes);
      assets.set(id, contents);
    } catch (error) {
      if (!(error instanceof ZipEntryTooLargeError)) throw error;
      warnings.push(tr("The asset is too large to import: {name}", { name: original.name }));
    }
  }
  return { doc, assets, warnings };
}

/** アセットの ID はすべて保つ。置き換えるのは保存場所だけ。 */
export async function restoreImportAssets(
  imported: SiteImport,
  progress: (message: string) => void = () => {},
  createdPaths: string[] = [],
): Promise<{ doc: SiteDoc; warnings: string[]; createdPaths: string[] }> {
  const doc = structuredClone(imported.doc);
  const warnings = [...imported.warnings];
  let number = 0, embeddedBytes = 0;
  const countEmbedded = (url?: string) => {
    embeddedBytes += url?.length ?? 0;
    if (embeddedBytes > IMPORT_LIMITS.docBytes) throw new Error(tr("The edit data exceeds the size limit."));
  };
  const assets = Object.entries(doc.assets);
  for (const [id, asset] of assets) {
    number++;
    progress(tr("Restoring assets… {number} / {total}", { number, total: assets.length }));
    const archived = imported.assets.get(id);
    let bytes = archived;
    if (!bytes && isEmbeddedAssetUrl(asset.dataUrl)) {
      try {
        const blob = await (await fetch(asset.dataUrl)).blob();
        if (blob.size <= IMPORT_LIMITS.assetBytes) bytes = new Uint8Array(await blob.arrayBuffer());
      } catch { /* Warn below if a usable source is unavailable. */ }
    }
    if (bytes && bytes.byteLength <= IMPORT_LIMITS.assetBytes) {
      const mime = asset.mimeType || guessMime(asset.name);
      try {
        const result = await uploadStaticAsset(new File([bytes as Uint8Array<ArrayBuffer>], asset.name, { type: mime }));
        if (result.path) createdPaths.push(result.path);
        doc.assets[id] = {
          ...asset, ...result, id, name: asset.name,
          width: asset.width > 0 ? asset.width : result.width,
          height: asset.height > 0 ? asset.height : result.height,
          svgFilter: result.svgFilter,
          ...(result.path ? { dataUrl: undefined } : { path: undefined }),
        };
      } catch (e) {
        warnings.push(tr("Could not save {name} ({reason})", { name: asset.name, reason: String(e instanceof Error ? e.message : e) }));
        // 対応表のバイト列を、埋め込まれた古い写しより優先する。
        if (archived) delete asset.dataUrl;
        delete asset.path;
        if (bytes.byteLength <= IMPORT_LIMITS.localAssetBytes && !asset.dataUrl) {
          const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mime });
          asset.dataUrl = await blobToDataUrl(blob);
        }
      }
      countEmbedded(doc.assets[id].dataUrl);
      continue;
    }
    delete asset.dataUrl;
    if (!bytes) warnings.push(tr("Could not retrieve the asset: {name}", { name: asset.name }));
    // 取り込み先の環境の、関係の無いアセットのキーを指さないようにする。
    if (asset.path) delete asset.path;
  }
  // 履歴からの復元とファイルの取り込みで、同じ SVG の無害化の方針を使う。
  sanitizeImportedInlineIcons(doc);
  rebindImportedAssetUrls(imported.doc, doc);
  return { doc, warnings: [...new Set(warnings)], createdPaths };
}

function guessMime(name: string) {
  const extension = name.split(".").at(-1)?.toLowerCase();
  const types: Record<string, string> = {
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
    webp: "image/webp", svg: "image/svg+xml", gif: "image/gif",
    avif: "image/avif", mp4: "video/mp4", mp3: "audio/mpeg",
    css: "text/css", js: "text/javascript", woff2: "font/woff2",
  };
  return types[extension || ""] || "application/octet-stream";
}
async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
