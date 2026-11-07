import JSZip from "jszip";
import { buildAssetNames } from "./generator/names";
import type { Asset, SiteDoc } from "./types";

export function importWarningsKey(siteId: string): string {
  return "tsumu-import-warnings:" + siteId;
}

export const SOURCE_LIMIT = 5 * 1024 * 1024;
export const DOCUMENT_LIMIT = 3 * 1024 * 1024;
export const ZIP_ENTRY_LIMIT = 350;
export const ZIP_EXPANDED_LIMIT = 32 * 1024 * 1024;
export const ZIP_ASSET_LIMIT = 25 * 1024 * 1024;

const textDecoder = new TextDecoder("utf-8", { fatal: true });
const forbidden = new Set(["__proto__", "prototype", "constructor"]);

function verifyObjectKeys(value: unknown, depth = 0): void {
  if (!value || typeof value !== "object") return;
  if (depth > 80) throw new Error("編集データの階層が深すぎます");
  for (const [key, child] of Object.entries(value)) {
    if (forbidden.has(key)) throw new Error("編集データに使用できない項目が含まれます");
    verifyObjectKeys(child, depth + 1);
  }
}

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/** Validate the complete editable document before it can create a site. */
export function parseRestoredDoc(raw: string): SiteDoc {
  if (new TextEncoder().encode(raw).length > DOCUMENT_LIMIT) {
    throw new Error("doc.jsonが大きすぎます（3MBまで）");
  }
  const parsed: unknown = JSON.parse(raw);
  if (!record(parsed)) throw new Error("doc.jsonの形式が正しくありません");
  verifyObjectKeys(parsed);
  if (!record(parsed.pages) || !record(parsed.nodes) || !record(parsed.assets) ||
      !Array.isArray(parsed.pageOrder) || !parsed.pageOrder.length ||
      parsed.pageOrder.length > 1000 || Object.keys(parsed.nodes).length > 20000 ||
      Object.keys(parsed.assets).length > 2000 || typeof parsed.siteName !== "string" ||
      parsed.siteName.length > 240) {
    throw new Error("Tsumuの編集データとして読み込めません");
  }
  for (const id of parsed.pageOrder) {
    if (typeof id !== "string" || !record(parsed.pages[id]) ||
        !Array.isArray(parsed.pages[id].children) ||
        typeof parsed.pages[id].slug !== "string") {
      throw new Error("ページ情報が壊れています");
    }
  }
  for (const [id, node] of Object.entries(parsed.nodes)) {
    if (!record(node) || node.id !== id || !Array.isArray(node.children) ||
        typeof node.type !== "string" || !record(node.styles)) {
      throw new Error("要素情報が壊れています");
    }
  }
  for (const [id, asset] of Object.entries(parsed.assets)) {
    if (!record(asset) || asset.id !== id || typeof asset.name !== "string") {
      throw new Error("アセット情報が壊れています");
    }
  }
  return parsed as unknown as SiteDoc;
}

const mimeMap: Record<string, string> = {
  svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg",
  jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
  avif: "image/avif", ico: "image/x-icon", mp4: "video/mp4",
  webm: "video/webm", mp3: "audio/mpeg", wav: "audio/wav",
  ogg: "audio/ogg", woff: "font/woff", woff2: "font/woff2",
  ttf: "font/ttf", otf: "font/otf", css: "text/css",
};

function mimeOf(path: string): string {
  return mimeMap[path.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";
}
function safeEntryName(name: string): boolean {
  return name.length < 512 && !name.startsWith("/") && !name.includes("\\") &&
    !name.split("/").some((part) => part === ".." || part === "." || part === "__proto__");
}

function countUncompressed(zip: JSZip): void {
  const entries = Object.values(zip.files).filter((entry) => !entry.dir);
  if (entries.length > ZIP_ENTRY_LIMIT) throw new Error("ZIP内のファイル数が多すぎます（350個まで）");
  let total = 0;
  for (const entry of entries) {
    if (!safeEntryName(entry.name) ||
        (entry as typeof entry & { unsafeOriginalName?: string }).unsafeOriginalName &&
        !safeEntryName((entry as typeof entry & { unsafeOriginalName?: string }).unsafeOriginalName!)) {
      throw new Error("ZIP内に不正なファイル名があります");
    }
    const size = (entry as typeof entry & { _data?: { uncompressedSize?: number } })._data?.uncompressedSize;
    if (typeof size !== "number" || size < 0 || size > ZIP_ASSET_LIMIT) {
      throw new Error("ZIP内に大きすぎるファイルがあります");
    }
    total += size;
    if (total > ZIP_EXPANDED_LIMIT) throw new Error("ZIP展開後のサイズは32MBまでです");
  }
}

/** Detect a self-contained editing archive, including a single top-level ZIP folder. */
export async function readRestorableArchive(bytes: Uint8Array): Promise<{
  doc: SiteDoc; assets: Map<string, Uint8Array>; folder: string;
}> {
  if (bytes.byteLength > SOURCE_LIMIT) throw new Error("ZIPは5MBまでです");
  // Validate entry size metadata before inflating anything (CRC checking
  // during load would decompress all entries before these limits apply).
  const zip = await JSZip.loadAsync(bytes);
  countUncompressed(zip);
  const candidates = Object.values(zip.files).filter((entry) =>
    !entry.dir && /(?:^|\/)(?:_tsumu|_site-data)\/doc\.json$/i.test(entry.name));
  if (candidates.length !== 1) {
    throw new Error("ZIP内に_tsumu/doc.jsonが1つ必要です");
  }
  const docPath = candidates[0].name;
  const folder = docPath.replace(/(?:_tsumu|_site-data)\/doc\.json$/i, "");
  const raw = await candidates[0].async("string");
  const doc = parseRestoredDoc(raw);
  const assets = new Map<string, Uint8Array>();
  const names = buildAssetNames(doc);
  const used = new Set<string>();
  for (const [id, filename] of names) {
    const candidates = [
      folder + "public/assets/" + filename,
      folder + "assets/" + filename,
    ];
    const entry = candidates.map((name) => zip.file(name)).find(Boolean);
    if (!entry) continue;
    const bytes = await entry.async("uint8array");
    if (bytes.byteLength > ZIP_ASSET_LIMIT) throw new Error("アセットが大きすぎます: " + filename);
    if (used.has(entry.name)) throw new Error("アセット名が重複しています");
    used.add(entry.name);
    assets.set(id, bytes);
  }
  return { doc, assets, folder };
}

export async function readRestorableJson(bytes: Uint8Array): Promise<{
  doc: SiteDoc; assets: Map<string, Uint8Array>; folder: string;
}> {
  if (bytes.byteLength > DOCUMENT_LIMIT) throw new Error("doc.jsonは3MBまでです");
  return { doc: parseRestoredDoc(textDecoder.decode(bytes)), assets: new Map(), folder: "" };
}

/**
 * A SiteDoc may still contain direct public image/media URLs when its ZIP is
 * incomplete. Try those URLs through the same guarded relay before reporting
 * the asset as missing; never send credentials from the importing browser.
 */
export async function recoverPublicAssetBytes(
  doc: SiteDoc,
  supplied: Map<string, Uint8Array>,
  download: (url: string) => Promise<Uint8Array>,
): Promise<Map<string, Uint8Array>> {
  const files = new Map(supplied);
  let attempts = 0;
  for (const [id, asset] of Object.entries(doc.assets)) {
    if (files.has(id) || asset.dataUrl || attempts >= 20) continue;
    const refs = Object.values(doc.nodes)
      .flatMap((node) => [node.image, node.media])
      .filter((ref) => ref?.assetId === id)
      .map((ref) => ref!.src);
    const candidate = [asset.path, ...refs]
      .find((url) => typeof url === "string" && /^https?:\/\//i.test(url));
    if (!candidate) continue;
    let url: URL;
    try {
      url = new URL(candidate);
      if (url.username || url.password) continue;
    } catch { continue; }
    attempts++;
    try {
      const bytes = await download(url.href);
      if (bytes.byteLength && bytes.byteLength <= SOURCE_LIMIT) files.set(id, bytes);
    } catch { /* The existing source may still be accessible; otherwise warn. */ }
  }
  return files;
}

export type RestoreSnapshot = Awaited<ReturnType<typeof readRestorableArchive>>;
export type UploadRestored = (file: File) => Promise<Asset>;
export type CheckExisting = (asset: Asset) => Promise<boolean>;

const freshSource = (asset: Asset): string | null =>
  asset.path ? "/api/assets/file?path=" + encodeURIComponent(asset.path) : asset.dataUrl ?? null;

function rewriteReferences(doc: SiteDoc, previous: Asset, current: Asset, filename: string): void {
  const source = freshSource(current);
  if (!source) return;
  const resolvedSource: string = source;
  const storedRefs = Object.values(doc.nodes)
    .flatMap((node) => [node.image, node.media])
    .filter((ref) => ref?.assetId === previous.id)
    .map((ref) => ref!.src);
  const olds = [
    previous.path ? "/api/assets/file?path=" + encodeURIComponent(previous.path) : null,
    previous.path?.startsWith("http") ? previous.path : null,
    previous.dataUrl,
    "/assets/" + filename,
    ...storedRefs,
  ].filter((value): value is string => !!value && value !== source);
  if (!olds.length) return;
  function rewrite(value: unknown, depth = 0): void {
    if (!value || typeof value !== "object" || depth > 50) return;
    for (const [key, item] of Object.entries(value)) {
      if (typeof item === "string") {
        if (olds.some((old) => item.includes(old))) {
          (value as Record<string, unknown>)[key] =
            olds.reduce((text, old) => text.replaceAll(old, resolvedSource), item);
        }
      } else rewrite(item, depth + 1);
    }
  }
  for (const page of Object.values(doc.pages)) rewrite(page);
  for (const node of Object.values(doc.nodes)) rewrite(node);
}

/**
 * All asset work finishes before site creation. Preserve asset IDs: references in
 * pages, nodes, styles and scripts continue to refer to the same asset records.
 */
export async function restoreAssets(
  original: SiteDoc,
  files: Map<string, Uint8Array>,
  upload: UploadRestored,
  checkExisting: CheckExisting = async () => false,
): Promise<{ doc: SiteDoc; warnings: string[] }> {
  const doc = structuredClone(original);
  const names = buildAssetNames(doc);
  const warnings: string[] = [];
  for (const [id, previous] of Object.entries(original.assets)) {
    const data = files.get(id);
    if (!data) {
      const works = previous.path ? await checkExisting(previous).catch(() => false) : false;
      if (works) continue;
      if (previous.dataUrl) {
        // A stale path takes precedence over dataUrl in the renderer. Drop it
        // so the embedded copy is actually used when the old host is unavailable.
        const current = { ...previous };
        delete current.path;
        doc.assets[id] = current;
        rewriteReferences(doc, previous, current, names.get(id) ?? previous.name);
        continue;
      }
      warnings.push("アセットを取得できませんでした: " + previous.name);
      continue;
    }
    try {
      const name = names.get(id) ?? previous.name;
      const copy = new Uint8Array(new ArrayBuffer(data.byteLength));
      copy.set(data);
      const file = new File([copy], name, {
        type: previous.mimeType || mimeOf(name),
      });
      const uploaded = await upload(file);
      const { path: _oldPath, dataUrl: _oldData, ...metadata } = previous;
      const updated: Asset = {
        ...metadata,
        ...(uploaded.path ? { path: uploaded.path } : {}),
        ...(uploaded.dataUrl ? { dataUrl: uploaded.dataUrl } : {}),
        bytes: uploaded.bytes ?? previous.bytes,
        width: uploaded.width || previous.width,
        height: uploaded.height || previous.height,
      };
      doc.assets[id] = updated;
      rewriteReferences(doc, previous, updated, name);
    } catch {
      warnings.push("アセットを保存できませんでした: " + previous.name);
    }
  }
  return { doc, warnings };
}
