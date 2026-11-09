import { validAssetEntry, validDocNodeShape, validNodeForest, validSiteDoc, validStyleDefinitions } from "./doc-tree";
import { isSafeImportedSvg } from "./imported-svg";
import type { SiteDoc } from "./types";

export const IMPORT_LIMITS = {
  zipBytes: 100 * 1024 * 1024,
  docBytes: 12 * 1024 * 1024,
  expandedBytes: 300 * 1024 * 1024,
  assetBytes: 25 * 1024 * 1024,
  entries: 500,
  assets: 250,
  localAssetBytes: 2 * 1024 * 1024,
} as const;

export function isEmbeddedAssetUrl(value: unknown): value is string {
  return typeof value === "string" && /^data:[^,]*,/i.test(value);
}

const suspicious = new Set(["__proto__", "prototype", "constructor"]);

export function isImportObject(input: unknown): input is Record<string, unknown> {
  return !!input && typeof input === "object" && !Array.isArray(input);
}

/** Import-specific SVG checks complement the same node shape accepted by save. */
function validImportedNode(value: unknown): boolean {
  if (!validDocNodeShape(value)) return false;
  const icon = isImportObject(value) ? value.icon : undefined;
  return icon == null || typeof window !== "undefined" ||
    (isImportObject(icon) && isSafeImportedSvg(icon.svg as string));
}

/** Reject malformed archives before writing any site or uploading any asset. */
export function validateImportedDoc(value: unknown): SiteDoc {
  if (!isImportObject(value)) throw new Error("サイトの編集データではありません。");
  const doc = value;
  if (typeof doc.siteName !== "string" || !doc.siteName.trim() ||
      !isImportObject(doc.pages) || !isImportObject(doc.nodes) ||
      !isImportObject(doc.assets) ||
      !Array.isArray(doc.pageOrder) || !doc.pageOrder.length ||
      doc.pageOrder.length > 500 || Object.keys(doc.pages).length > 500 || Object.keys(doc.nodes).length > 25000 ||
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
  if (!validNodeForest(doc.pages, doc.nodes, doc.components)) throw new Error("要素の親子関係が不正です。");
  if (!Object.values(doc.nodes).every(validImportedNode)) {
    throw new Error("要素の設定が不正な編集データです。");
  }
  if (new Set(doc.pageOrder).size !== doc.pageOrder.length) throw new Error("ページの参照が壊れています。");
  for (const id of doc.pageOrder) {
    if (typeof id !== "string" || !isImportObject(doc.pages[id])) {
      throw new Error("ページの参照が壊れています。");
    }
    const page = doc.pages[id];
    if (typeof page.slug !== "string" || typeof page.name !== "string" ||
        typeof page.title !== "string" || typeof page.description !== "string" ||
        (page.bodyStyles != null && !validStyleDefinitions(page.bodyStyles)) ||
        !Array.isArray(page.children)) {
      throw new Error("ページの構造が正しくありません。");
    }
  }
  for (const [id, item] of Object.entries(doc.assets)) {
    if (!isImportObject(item) || !validAssetEntry(id, item) || (item.dataUrl != null && !isEmbeddedAssetUrl(item.dataUrl))) {
      throw new Error("アセットIDと参照情報が正しくありません。");
    }
  }
  // A document accepted by import must also be accepted by persistence when
  // reopened. Check every reference before the import creates a site or assets.
  const assetRefValid = (ref: unknown): boolean =>
    !isImportObject(ref) || ref.assetId === undefined ||
    (typeof ref.assetId === "string" && Object.hasOwn(doc.assets as Record<string, unknown>, ref.assetId));
  for (const node of Object.values(doc.nodes)) {
    if (!isImportObject(node) || !assetRefValid(node.image) || !assetRefValid(node.media) ||
        (isImportObject(node.media) && Array.isArray(node.media.sources) && !node.media.sources.every(assetRefValid))) {
      throw new Error("アセットの参照情報が正しくありません。");
    }
  }
  for (const page of Object.values(doc.pages)) {
    if (!isImportObject(page) || !assetRefValid(page.ogImage)) {
      throw new Error("アセットの参照情報が正しくありません。");
    }
  }
  if (!assetRefValid(doc.favicon) || !assetRefValid(doc.appleTouchIcon) ||
      !assetRefValid(doc.ogImage) ||
      (isImportObject(doc.pwa) && !assetRefValid(doc.pwa.icon))) {
    throw new Error("アセットの参照情報が正しくありません。");
  }
  const folderIds = new Set<string>();
  if (doc.pageFolders != null) {
    if (!Array.isArray(doc.pageFolders)) throw new Error("ページフォルダーが正しくありません。");
    for (const folder of doc.pageFolders) {
      if (!isImportObject(folder) || typeof folder.id !== "string" ||
          !folder.id || suspicious.has(folder.id) || typeof folder.name !== "string" ||
          folderIds.has(folder.id)) throw new Error("ページフォルダーが正しくありません。");
      folderIds.add(folder.id);
    }
  }
  for (const page of Object.values(doc.pages)) {
    if (isImportObject(page) && page.folderId !== undefined &&
        (typeof page.folderId !== "string" || !folderIds.has(page.folderId))) {
      throw new Error("ページフォルダーの参照が正しくありません。");
    }
  }
  // Full saves, cache recovery and imports must agree on structural validity.
  if (!validSiteDoc(doc)) throw new Error("編集データの参照・構造が不正です。");
  return value as unknown as SiteDoc;
}
