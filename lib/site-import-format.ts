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

const nodeKinds = new Set(["box", "image", "divider", "code", "instance", "icon", "field", "media", "embed", "list"]);
const nodeSemantics = new Set(["auto", "form", "button", "div", "section", "header", "footer",
  "nav", "main", "article", "span", "custom"]);

function validStyles(value: unknown): boolean {
  if (!isImportObject(value)) return false;
  for (const states of Object.values(value)) {
    if (!isImportObject(states)) return false;
    for (const declarations of Object.values(states)) {
      if (!isImportObject(declarations) ||
          !Object.values(declarations).every((item) => typeof item === "string")) return false;
    }
  }
  return true;
}

function validImportedNode(value: unknown): boolean {
  if (!isImportObject(value) || !nodeKinds.has(value.type as string) ||
      typeof value.name !== "string" || !nodeSemantics.has(value.semantic as string) ||
      !validStyles(value.styles)) return false;
  if (value.text != null && (!isImportObject(value.text) ||
      typeof value.text.content !== "string" || typeof value.text.heading !== "number" || !Number.isInteger(value.text.heading) ||
      (value.text.heading as number) < 0 || (value.text.heading as number) > 6)) return false;
  if (value.link != null && (!isImportObject(value.link) ||
      !["url", "page"].includes(value.link.kind as string) ||
      (value.link.url != null && typeof value.link.url !== "string") ||
      (value.link.pageId != null && typeof value.link.pageId !== "string"))) return false;
  if (value.image != null && (!isImportObject(value.image) ||
      typeof value.image.src !== "string" || typeof value.image.alt !== "string" ||
      typeof value.image.width !== "number" || !Number.isFinite(value.image.width) ||
      typeof value.image.height !== "number" || !Number.isFinite(value.image.height))) return false;
  if (value.media != null && (!isImportObject(value.media) ||
      !["audio", "video"].includes(value.media.kind as string) ||
      typeof value.media.src !== "string")) return false;
  if (value.icon != null && (!isImportObject(value.icon) ||
      typeof value.icon.name !== "string" || typeof value.icon.svg !== "string")) return false;
  if (value.code != null && (!isImportObject(value.code) || typeof value.code.html !== "string")) return false;
  if (value.field != null && (!isImportObject(value.field) ||
      !["input", "textarea", "select", "checkbox", "radio", "file", "submit"].includes(value.field.kind as string) ||
      (value.field.options != null && (!Array.isArray(value.field.options) ||
        !value.field.options.every((option: unknown) => typeof option === "string"))))) return false;
  return value.scripts == null || Array.isArray(value.scripts);
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
        (page.bodyStyles != null && !validStyles(page.bodyStyles)) ||
        !Array.isArray(page.children)) {
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
