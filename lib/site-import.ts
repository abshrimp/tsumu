import { rebindImportedAssetUrls } from "./imported-asset-urls";
import { IMPORT_LIMITS, isImportObject, validateImportedDoc } from "./site-import-format";
import type JSZip from "jszip";
import { openImportZip, zipEntrySize } from "./zip-directory";
import type { Asset, SiteDoc } from "./types";
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
  /** Original asset ID -> bytes from the archive, if present. */
  assets: Map<string, Uint8Array>;
  warnings: string[];
}

export { IMPORT_LIMITS, validateImportedDoc } from "./site-import-format";

const decoder = new TextDecoder("utf-8", { fatal: true });

function jsonText(bytes: Uint8Array): unknown {
  let content: string;
  try { content = decoder.decode(bytes); }
  catch { throw new Error("編集データの文字コードはUTF-8である必要があります。"); }
  try { return JSON.parse(content.replace(/^\uFEFF/, "")) as unknown; }
  catch { throw new Error("doc.jsonをJSONとして読み込めませんでした。"); }
}

function pathOK(path: string): boolean {
  return !!path && !path.includes("\\") && !path.startsWith("/") &&
    !/[\u0000-\u001f\u007f]/.test(path) &&
    path.split("/").every((part) => part && part !== "." && part !== "..");
}
function findEditDoc(entries: JSZip.JSZipObject[]) {
  return entries.find((entry) => /^(?:[^/]+\/)?_tsumu\/doc\.json$/i.test(entry.name));
}

export async function parseSiteImport(
  bytes: Uint8Array,
  mode: "zip" | "doc",
): Promise<SiteImport> {
  if (bytes.byteLength > (mode === "zip" ? IMPORT_LIMITS.zipBytes : IMPORT_LIMITS.docBytes)) {
    throw new Error("インポートするファイルが大きすぎます。");
  }
  if (mode === "doc") {
    return { doc: validateImportedDoc(await decodePortableDoc(jsonText(bytes), IMPORT_LIMITS.docBytes)),
      assets: new Map(), warnings: [] };
  }
  const zip = await openImportZip(bytes, IMPORT_LIMITS.entries);
  const entries = Object.values(zip.files).filter((entry) => !entry.dir);
  if (entries.length > IMPORT_LIMITS.entries) throw new Error("ZIP内のファイルが多すぎます。");
  for (const entry of entries) {
    const original = (entry as JSZip.JSZipObject & { unsafeOriginalName?: string }).unsafeOriginalName;
    if (original && original !== entry.name) {
      throw new Error("ZIPに安全でないファイルパスがあります。");
    }
  }
  const editableDocs = entries.filter((entry) =>
    /^(?:[^/]+\/)?_tsumu\/doc\.json$/i.test(entry.name));
  if (editableDocs.length > 1) {
    throw new Error("ZIPに複数の編集データが見つかりました。");
  }
  let size = 0;
  const canonicalPaths = new Set<string>();
  for (const entry of entries) {
    if (!pathOK(entry.name)) throw new Error("ZIPに安全でないファイルパスがあります。");
    // ZIP members must be unambiguous on case-insensitive and Unicode-normalizing hosts.
    const canonical = entry.name.normalize("NFC").toLowerCase();
    if (canonicalPaths.has(canonical)) throw new Error("ZIPに重複したファイルパスがあります。");
    canonicalPaths.add(canonical);
    const n = zipEntrySize(entry);
    if (n === null) throw new Error("ZIP内のファイルサイズが正しくありません。");
    if (n > IMPORT_LIMITS.expandedBytes || (size += n) > IMPORT_LIMITS.expandedBytes) {
      throw new Error("ZIP展開後のデータが大きすぎます。");
    }
  }
  const documentEntry = findEditDoc(entries);
  if (!documentEntry) {
    throw new Error("ZIPに_tsumu/doc.jsonがありません。HTML ZIPの取り込みとは別の機能です。");
  }
  const docBytes = await readZipEntryLimited(documentEntry, IMPORT_LIMITS.docBytes);
  if (docBytes.length > IMPORT_LIMITS.docBytes) throw new Error("doc.jsonが大きすぎます。");
  const doc = validateImportedDoc(await decodePortableDoc(jsonText(docBytes), IMPORT_LIMITS.docBytes));
  const root = documentEntry.name.replace(/_tsumu\/doc\.json$/i, "");
  const parent = documentEntry.name.slice(0, documentEntry.name.lastIndexOf("/") + 1);
  // Asset paths are read from the archive's explicit mapping file.
  const mapEntry = zip.file(parent + "assets.json");
  if (!mapEntry) throw new Error("ZIPに_tsumu/assets.jsonがありません。");
  const metadata = jsonText(await readZipEntryLimited(mapEntry, IMPORT_LIMITS.docBytes));
  if (!isImportObject(metadata) || metadata.version !== 1 ||
      !isImportObject(metadata.assets)) {
    throw new Error("ZIPのアセット対応表が不正です。");
  }
  const mapped = metadata.assets;
  if (new Set(Object.values(mapped)).size !== Object.keys(mapped).length ||
      Object.keys(mapped).length !== Object.keys(doc.assets).length ||
      Object.keys(mapped).some((id) => !Object.hasOwn(doc.assets, id) ||
        typeof mapped[id] !== "string" || !pathOK(mapped[id]))) {
    throw new Error("ZIPのアセット対応表が不正です。");
  }
  const assets = new Map<string, Uint8Array>();
  const warnings: string[] = [];
  for (const [id, original] of Object.entries(doc.assets)) {
    const location = mapped[id];
    if (typeof location !== "string" || !pathOK(location)) {
      throw new Error("ZIPのアセット対応表が不正です。");
    }
    const entry = zip.file(root + location);
    if (!entry) {
      if (!original.dataUrl) warnings.push("ZIPにアセットがありません: " + original.name);
      continue;
    }
    const n = zipEntrySize(entry);
    if (n !== null && n > IMPORT_LIMITS.assetBytes) {
      warnings.push("サイズが大きいためアセットを取り込めません: " + original.name);
      continue;
    }
    try {
      const contents = await readZipEntryLimited(entry, IMPORT_LIMITS.assetBytes);
      assets.set(id, contents);
    } catch (error) {
      if (!(error instanceof ZipEntryTooLargeError)) throw error;
      warnings.push("サイズが大きいためアセットを取り込めません: " + original.name);
    }
  }
  return { doc, assets, warnings };
}

/** Preserve every asset ID: only its storage location is replaced. */
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
    if (embeddedBytes > IMPORT_LIMITS.docBytes) throw new Error("編集データが容量上限を超えています。");
  };
  for (const [id, asset] of Object.entries(doc.assets)) {
    number++;
    progress("アセットを復元中… " + number + " / " + Object.keys(doc.assets).length);
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
          svgFilter: asset.svgFilter ?? result.svgFilter,
          ...(result.path ? { dataUrl: undefined } : { path: undefined }),
        };
      } catch (e) {
        warnings.push("アセットを保存できませんでした: " + asset.name + " (" + String(e instanceof Error ? e.message : e) + ")");
        // The manifest bytes take precedence over an older embedded copy.
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
    if (!bytes) warnings.push("アセットを取得できませんでした: " + asset.name);
    // Do not point at an unrelated asset key in the destination installation.
    if (asset.path) delete asset.path;
  }
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
