import { tr } from "./i18n";
import { validAssetEntry, validDocNodeShape, validNodeForest, validSiteDoc, validStyleDefinitions } from "./doc-tree";
import { isSafeImportedSvg } from "./imported-svg";
import type { SiteDoc } from "./types";

export const IMPORT_LIMITS = {
  zipBytes: 100 * 1024 * 1024,
  docBytes: 12 * 1024 * 1024,
  expandedBytes: 300 * 1024 * 1024,
  assetBytes: 25 * 1024 * 1024,
  entries: 1500,
  assets: 1000,
  localAssetBytes: 2 * 1024 * 1024,
} as const;

export function isEmbeddedAssetUrl(value: unknown): value is string {
  return typeof value === "string" && /^data:[^,]*,/i.test(value);
}

const suspicious = new Set(["__proto__", "prototype", "constructor"]);

export function isImportObject(input: unknown): input is Record<string, unknown> {
  return !!input && typeof input === "object" && !Array.isArray(input);
}

/** 取り込み専用の SVG の検査で、保存と同じノードの形の検査を補う。 */
function validImportedNode(value: unknown): boolean {
  if (!validDocNodeShape(value)) return false;
  const icon = isImportObject(value) ? value.icon : undefined;
  return icon == null || typeof window !== "undefined" ||
    (isImportObject(icon) && isSafeImportedSvg(icon.svg as string));
}

/** サイトを書き込んだり、アセットをアップロードしたりする前に、不正なアーカイブを拒否する。 */
export function validateImportedDoc(value: unknown): SiteDoc {
  if (!isImportObject(value)) throw new Error(tr("This file does not contain editable site data."));
  const doc = value;
  if (typeof doc.siteName !== "string" || !doc.siteName.trim() ||
      !isImportObject(doc.pages) || !isImportObject(doc.nodes) ||
      !isImportObject(doc.assets) ||
      !Array.isArray(doc.pageOrder) || !doc.pageOrder.length ||
      doc.pageOrder.length > 500 || Object.keys(doc.pages).length > 500 || Object.keys(doc.nodes).length > 25000 ||
      Object.keys(doc.assets).length > IMPORT_LIMITS.assets) {
    throw new Error(tr("Invalid page, element or asset data."));
  }
  let visited = 0;
  function check(value: unknown, depth = 0) {
    if (++visited > 400000 || depth > 80) throw new Error(tr("The document is too complex."));
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) check(item, depth + 1);
      return;
    }
    for (const [key, item] of Object.entries(value)) {
      if (suspicious.has(key)) throw new Error(tr("The document contains invalid property names."));
      check(item, depth + 1);
    }
  }
  check(value);
  if (!validNodeForest(doc.pages, doc.nodes, doc.components)) throw new Error(tr("The element hierarchy is invalid."));
  if (!Object.values(doc.nodes).every(validImportedNode)) {
    throw new Error(tr("The document contains invalid element settings."));
  }
  if (new Set(doc.pageOrder).size !== doc.pageOrder.length) throw new Error(tr("The document contains invalid page references."));
  for (const id of doc.pageOrder) {
    if (typeof id !== "string" || !isImportObject(doc.pages[id])) {
      throw new Error(tr("The document contains invalid page references."));
    }
    const page = doc.pages[id];
    if (typeof page.slug !== "string" || typeof page.name !== "string" ||
        typeof page.title !== "string" || typeof page.description !== "string" ||
        (page.bodyStyles != null && !validStyleDefinitions(page.bodyStyles)) ||
        !Array.isArray(page.children)) {
      throw new Error(tr("The page structure is invalid."));
    }
  }
  for (const [id, item] of Object.entries(doc.assets)) {
    if (!isImportObject(item) || !validAssetEntry(id, item) || (item.dataUrl != null && !isEmbeddedAssetUrl(item.dataUrl))) {
      throw new Error(tr("Asset IDs or references are invalid."));
    }
  }
  // 取り込みで受け付けた文書は、開き直したときに保存でも受け付けられなければならない。
  // 取り込みでサイトやアセットを作る前に、すべての参照を確かめる。
  const assetRefValid = (ref: unknown): boolean =>
    !isImportObject(ref) || ref.assetId === undefined ||
    (typeof ref.assetId === "string" && Object.hasOwn(doc.assets as Record<string, unknown>, ref.assetId));
  for (const node of Object.values(doc.nodes)) {
    if (!isImportObject(node) || !assetRefValid(node.image) || !assetRefValid(node.media) ||
        (isImportObject(node.media) && Array.isArray(node.media.sources) && !node.media.sources.every(assetRefValid))) {
      throw new Error(tr("Asset references are invalid."));
    }
  }
  for (const page of Object.values(doc.pages)) {
    if (!isImportObject(page) || !assetRefValid(page.ogImage) ||
        (isImportObject(page.htmlZip) && (!Array.isArray(page.htmlZip.assetIds) ||
          !page.htmlZip.assetIds.every(id => typeof id === "string" &&
            Object.hasOwn(doc.assets as Record<string, unknown>, id))))) {
      throw new Error(tr("Asset references are invalid."));
    }
  }
  if (!assetRefValid(doc.favicon) || !assetRefValid(doc.appleTouchIcon) ||
      !assetRefValid(doc.ogImage) ||
      (isImportObject(doc.pwa) && !assetRefValid(doc.pwa.icon))) {
    throw new Error(tr("Asset references are invalid."));
  }
  const folderIds = new Set<string>();
  if (doc.pageFolders != null) {
    if (!Array.isArray(doc.pageFolders)) throw new Error(tr("Page folders are invalid."));
    for (const folder of doc.pageFolders) {
      if (!isImportObject(folder) || typeof folder.id !== "string" ||
          !folder.id || suspicious.has(folder.id) || typeof folder.name !== "string" ||
          folderIds.has(folder.id)) throw new Error(tr("Page folders are invalid."));
      folderIds.add(folder.id);
    }
  }
  for (const page of Object.values(doc.pages)) {
    if (isImportObject(page) && page.folderId !== undefined &&
        (typeof page.folderId !== "string" || !folderIds.has(page.folderId))) {
      throw new Error(tr("Page folder references are invalid."));
    }
  }
  // 全体の保存、キャッシュからの復旧、取り込みで、構造が正しいかの判定をそろえる。
  if (!validSiteDoc(doc)) throw new Error(tr("The document structure or references are invalid."));
  return value as unknown as SiteDoc;
}
