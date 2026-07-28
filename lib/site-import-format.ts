import { validAssetEntry, validNodeForest } from "./doc-tree";
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
  if (new Set(doc.pageOrder).size !== doc.pageOrder.length) throw new Error("ページの参照が壊れています。");
  for (const id of doc.pageOrder) {
    if (typeof id !== "string" || !isImportObject(doc.pages[id])) {
      throw new Error("ページの参照が壊れています。");
    }
    const page = doc.pages[id];
    if (typeof page.slug !== "string" || !Array.isArray(page.children)) {
      throw new Error("ページの構造が正しくありません。");
    }
  }
  for (const [id, item] of Object.entries(doc.assets)) {
    if (!isImportObject(item) || !validAssetEntry(id, item) || (item.dataUrl != null && !isEmbeddedAssetUrl(item.dataUrl))) {
      throw new Error("アセットIDと参照情報が正しくありません。");
    }
  }
  return value as unknown as SiteDoc;
}
