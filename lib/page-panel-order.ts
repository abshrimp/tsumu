import type { PageFolder, SiteDoc } from "./types";

/** A folder is a top-level list item. Its pages remain children, not siblings. */
export type PanelItem = { kind: "page" | "folder"; id: string };
export type FolderPlacement =
  | { kind: "page"; id: string; after: boolean }
  | { kind: "folder"; id: string; after: boolean }
  | { kind: "end" };

/** Interleave loose pages and folders without changing the site's publish order. */
export function pagePanelItems(doc: Pick<SiteDoc, "pageOrder" | "pages" | "pageFolders">): PanelItem[] {
  const folders = doc.pageFolders ?? [];
  const folderIds = new Set(folders.map((folder) => folder.id));
  const loose = doc.pageOrder.filter((id) =>
    !!doc.pages[id] && (!doc.pages[id].folderId || !folderIds.has(doc.pages[id].folderId)));
  const looseIds = new Set(loose);
  const before = new Map<string, string[]>();
  const tail: string[] = [];
  for (const folder of folders) {
    const id = folder.beforePageId;
    if (id && looseIds.has(id)) {
      const group = before.get(id) ?? [];
      group.push(folder.id);
      before.set(id, group);
    } else {
      tail.push(folder.id);
    }
  }
  const result: PanelItem[] = [];
  for (const id of loose) {
    for (const folderId of before.get(id) ?? []) result.push({ kind: "folder", id: folderId });
    result.push({ kind: "page", id });
  }
  for (const id of tail) result.push({ kind: "folder", id });
  return result;
}

/**
 * Place a folder between any two top-level items. The next loose page becomes
 * its anchor; folders sharing that anchor are ordered by pageFolders.
 */
export function placePageFolder(doc: SiteDoc, folderId: string, target: FolderPlacement): void {
  if (!(doc.pageFolders ?? []).some((folder) => folder.id === folderId)) return;
  if (target.kind === "folder" && target.id === folderId) return;
  const items = pagePanelItems(doc).filter((item) => item.kind !== "folder" || item.id !== folderId);
  const index = target.kind === "end"
    ? items.length
    : items.findIndex((item) => item.kind === target.kind && item.id === target.id);
  if (index < 0) return;
  items.splice(index + (target.kind !== "end" && target.after ? 1 : 0), 0, { kind: "folder", id: folderId });
  const folders = new Map((doc.pageFolders ?? []).map((folder) => [folder.id, folder]));
  const anchors = new Map<string, string | undefined>();
  let nextLoose: string | undefined;
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item.kind === "page") nextLoose = item.id;
    else anchors.set(item.id, nextLoose);
  }
  doc.pageFolders = items.filter((item) => item.kind === "folder").map(({ id }) => {
    const folder = { ...folders.get(id)! };
    const anchor = anchors.get(id);
    if (anchor) folder.beforePageId = anchor;
    else delete folder.beforePageId;
    return folder;
  });
}

/**
 * Keep folders at their current visible slot when an anchoring page moves or
 * leaves the loose-page list. The nearest surviving loose page is the new anchor.
 */
export function retainPageFolderSlots(doc: SiteDoc, movedPageIds: ReadonlySet<string>): void {
  if (!movedPageIds.size || !doc.pageFolders?.length) return;
  const items = pagePanelItems(doc);
  const nextPage = new Map<string, string | undefined>();
  let next: string | undefined;
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item.kind === "page" && !movedPageIds.has(item.id)) next = item.id;
    if (item.kind === "folder") nextPage.set(item.id, next);
  }
  for (const folder of doc.pageFolders) {
    if (!folder.beforePageId || !movedPageIds.has(folder.beforePageId)) continue;
    const anchor = nextPage.get(folder.id);
    if (anchor) folder.beforePageId = anchor;
    else delete folder.beforePageId;
  }
}
