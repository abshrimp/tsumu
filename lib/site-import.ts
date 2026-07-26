import JSZip from "jszip";
import type { Asset, SiteDoc } from "./types";
import { uploadStaticAsset } from "./assets";
import { decodePortableDoc } from "./portable-doc";

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

export const IMPORT_LIMITS = {
  zipBytes: 100 * 1024 * 1024,
  docBytes: 12 * 1024 * 1024,
  expandedBytes: 300 * 1024 * 1024,
  assetBytes: 25 * 1024 * 1024,
  entries: 500,
  assets: 250,
  localAssetBytes: 2 * 1024 * 1024,
} as const;

const decoder = new TextDecoder("utf-8", { fatal: true });
const suspicious = new Set(["__proto__", "prototype", "constructor"]);

function jsonText(bytes: Uint8Array): unknown {
  let content: string;
  try { content = decoder.decode(bytes); }
  catch { throw new Error("編集データの文字コードはUTF-8である必要があります。"); }
  try { return JSON.parse(content.replace(/^\uFEFF/, "")) as unknown; }
  catch { throw new Error("doc.jsonをJSONとして読み込めませんでした。"); }
}

function assertOrdinaryObject(input: unknown): input is Record<string, unknown> {
  return !!input && typeof input === "object" && !Array.isArray(input);
}

/** Reject malformed archives before writing any site or uploading any asset. */
export function validateImportedDoc(value: unknown): SiteDoc {
  if (!assertOrdinaryObject(value)) throw new Error("サイトの編集データではありません。");
  const doc = value as Record<string, unknown>;
  if (typeof doc.siteName !== "string" || !doc.siteName.trim() ||
      !assertOrdinaryObject(doc.pages) || !assertOrdinaryObject(doc.nodes) ||
      !assertOrdinaryObject(doc.assets) ||
      !Array.isArray(doc.pageOrder) || !doc.pageOrder.length ||
      doc.pageOrder.length > 500 || Object.keys(doc.nodes).length > 25000 ||
      Object.keys(doc.assets).length > IMPORT_LIMITS.assets) {
    throw new Error("ページ・要素・アセット情報が不正な編集データです。");
  }
  let visited = 0;
  function check(value: unknown, depth = 0) {
    if (++visited > 400000 || depth > 80) throw new Error("編集データが複雑すぎます。");
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) check(item, depth + 1);
      return;
    }
    for (const [key, item] of Object.entries(value)) {
      if (suspicious.has(key)) throw new Error("編集データに使用できないプロパティがあります。");
      check(item, depth + 1);
    }
  }
  check(value);
  for (const id of doc.pageOrder) {
    if (typeof id !== "string" || !assertOrdinaryObject(doc.pages[id])) {
      throw new Error("ページの参照が壊れています。");
    }
    const page = doc.pages[id];
    if (typeof page.slug !== "string" || !Array.isArray(page.children)) {
      throw new Error("ページの構造が正しくありません。");
    }
  }
  for (const [id, item] of Object.entries(doc.assets)) {
    if (!assertOrdinaryObject(item) || typeof item.id !== "string" || item.id !== id ||
        typeof item.name !== "string") {
      throw new Error("アセットIDと参照情報が正しくありません。");
    }
  }
  return value as unknown as SiteDoc;
}

function pathOK(path: string): boolean {
  return !!path && !path.includes("\\") && !path.startsWith("/") &&
    !path.includes("\0") && path.split("/").every((part) => part && part !== "." && part !== "..");
}
function uncompressedSize(entry: JSZip.JSZipObject): number | null {
  const size = (entry as unknown as { _data?: { uncompressedSize?: number } })
    ._data?.uncompressedSize;
  return Number.isFinite(size) && size! >= 0 ? size! : null;
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
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(bytes); }
  catch { throw new Error("ZIPファイルを展開できませんでした。"); }
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
  for (const entry of entries) {
    if (!pathOK(entry.name)) throw new Error("ZIPに安全でないファイルパスがあります。");
    const n = uncompressedSize(entry);
    if (n !== null) {
      if (n > IMPORT_LIMITS.expandedBytes || (size += n) > IMPORT_LIMITS.expandedBytes) {
        throw new Error("ZIP展開後のデータが大きすぎます。");
      }
    }
  }
  const documentEntry = findEditDoc(entries);
  if (!documentEntry) {
    throw new Error("ZIPに_tsumu/doc.jsonがありません。HTML ZIPの取り込みとは別の機能です。");
  }
  const docBytes = await documentEntry.async("uint8array");
  if (docBytes.length > IMPORT_LIMITS.docBytes) throw new Error("doc.jsonが大きすぎます。");
  const doc = validateImportedDoc(await decodePortableDoc(jsonText(docBytes), IMPORT_LIMITS.docBytes));
  const root = documentEntry.name.replace(/_tsumu\/doc\.json$/i, "");
  const parent = documentEntry.name.slice(0, documentEntry.name.lastIndexOf("/") + 1);
  // Only the current editable archive contract is supported. Never infer
  // asset locations from historical public/assets or assets directory layouts.
  const mapEntry = zip.file(parent + "assets.json");
  if (!mapEntry) throw new Error("ZIPに_tsumu/assets.jsonがありません。");
  const metadata = jsonText(await mapEntry.async("uint8array"));
  if (!assertOrdinaryObject(metadata) || metadata.version !== 1 ||
      !assertOrdinaryObject(metadata.assets)) {
    throw new Error("ZIPのアセット対応表が不正です。");
  }
  const mapped = metadata.assets;
  if (Object.keys(mapped).length !== Object.keys(doc.assets).length ||
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
    const n = uncompressedSize(entry);
    if (n !== null && n > IMPORT_LIMITS.assetBytes) {
      warnings.push("サイズが大きいためアセットを取り込めません: " + original.name);
      continue;
    }
    const contents = await entry.async("uint8array");
    if (contents.byteLength > IMPORT_LIMITS.assetBytes) {
      warnings.push("サイズが大きいためアセットを取り込めません: " + original.name);
      continue;
    }
    assets.set(id, contents);
  }
  return { doc, assets, warnings };
}

/** Preserve every asset ID: only its storage location is replaced. */
export async function restoreImportAssets(
  imported: SiteImport,
  progress: (message: string) => void = () => {},
): Promise<{ doc: SiteDoc; warnings: string[]; createdPaths: string[] }> {
  const doc = structuredClone(imported.doc);
  const warnings = [...imported.warnings];
  const createdPaths: string[] = [];
  let number = 0;
  for (const [id, asset] of Object.entries(doc.assets)) {
    number++;
    progress("アセットを復元中… " + number + " / " + Object.keys(doc.assets).length);
    let bytes = imported.assets.get(id);
    if (!bytes && asset.dataUrl) {
      try {
        const blob = await (await fetch(asset.dataUrl)).blob();
        if (blob.size <= IMPORT_LIMITS.assetBytes) bytes = new Uint8Array(await blob.arrayBuffer());
      } catch { /* Warn below if a usable source is unavailable. */ }
    }
    if (bytes && bytes.byteLength <= IMPORT_LIMITS.assetBytes) {
      const mime = asset.mimeType || guessMime(asset.name);
      try {
        const result = await uploadStaticAsset(new File([bytes as Uint8Array<ArrayBuffer>], asset.name, { type: mime }));
        doc.assets[id] = {
          ...asset, ...result, id, name: asset.name,
          width: asset.width > 0 ? asset.width : result.width,
          height: asset.height > 0 ? asset.height : result.height,
          svgFilter: asset.svgFilter ?? result.svgFilter,
          ...(result.path ? { dataUrl: undefined } : { path: undefined }),
        };
        if (result.path) createdPaths.push(result.path);
        continue;
      } catch (e) {
        warnings.push("アセットを保存できませんでした: " + asset.name + " (" + String(e instanceof Error ? e.message : e) + ")");
        if (bytes.byteLength <= IMPORT_LIMITS.localAssetBytes && !asset.dataUrl) {
          const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mime });
          asset.dataUrl = await blobToDataUrl(blob);
        }
      }
    }
    if (asset.dataUrl) {
      delete asset.path;
      continue;
    }
    if (!bytes) warnings.push("アセットを取得できませんでした: " + asset.name);
    // Do not point at an unrelated asset key in the destination installation.
    if (asset.path) delete asset.path;
  }
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
