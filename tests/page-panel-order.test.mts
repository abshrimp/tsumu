import assert from "node:assert/strict";
import { test } from "node:test";
import { pagePanelItems, placePageFolder, retainPageFolderSlots } from "../lib/page-panel-order";
import { validSiteDoc } from "../lib/doc-tree";
import { mergeDocs } from "../lib/merge";
import { useEditor } from "../lib/store";
import { pageFolderFixture } from "./helpers/page-folder-merge";
import type { SiteDoc } from "../lib/types";

const labels = (doc: SiteDoc) => pagePanelItems(doc).map((item) => item.kind + ":" + item.id);
const example = () => {
  const doc = pageFolderFixture();
  delete doc.pages.p.folderId;
  delete doc.pages.q.folderId;
  doc.pages.r = { ...structuredClone(doc.pages.q), id: "r", name: "R", slug: "r", children: [] };
  doc.pageOrder.push("r");
  return doc;
};

test("a folder can be dragged between two loose pages without changing published page order", () => {
  const doc = example(), pageOrder = [...doc.pageOrder];
  assert.deepEqual(labels(doc), ["page:p", "page:q", "page:r", "folder:first", "folder:second", "folder:third"]);
  placePageFolder(doc, "first", { kind: "page", id: "q", after: false });
  assert.deepEqual(labels(doc), ["page:p", "folder:first", "page:q", "page:r", "folder:second", "folder:third"]);
  assert.equal(doc.pageFolders?.find((f) => f.id === "first")?.beforePageId, "q");
  assert.deepEqual(doc.pageOrder, pageOrder);
  assert.equal(validSiteDoc(doc), true);
});

test("dragging a folder after a page, across other folders and to the end preserves the exact order", () => {
  const doc = example();
  placePageFolder(doc, "first", { kind: "page", id: "q", after: false });
  placePageFolder(doc, "second", { kind: "page", id: "p", after: true });
  assert.deepEqual(labels(doc), ["page:p", "folder:second", "folder:first", "page:q", "page:r", "folder:third"]);
  placePageFolder(doc, "third", { kind: "folder", id: "second", after: true });
  assert.deepEqual(labels(doc), ["page:p", "folder:second", "folder:third", "folder:first", "page:q", "page:r"]);
  placePageFolder(doc, "second", { kind: "end" });
  assert.deepEqual(labels(doc), ["page:p", "folder:third", "folder:first", "page:q", "page:r", "folder:second"]);
  assert.equal(validSiteDoc(doc), true);
});

test("nested children remain in their folder and cannot be used as a top-level drop target", () => {
  const doc = pageFolderFixture();
  placePageFolder(doc, "third", { kind: "page", id: "p", after: false });
  assert.deepEqual(labels(doc), ["folder:first", "folder:second", "folder:third"]);
  assert.equal(doc.pages.p.folderId, "first");
  assert.equal(doc.pages.q.folderId, "second");
  assert.equal(validSiteDoc(doc), true);
});

test("moving or deleting an anchoring page retains the folder slot", () => {
  const doc = example();
  placePageFolder(doc, "first", { kind: "page", id: "q", after: false });
  retainPageFolderSlots(doc, new Set(["q"]));
  doc.pageOrder = ["p", "r"];
  delete doc.pages.q;
  assert.deepEqual(labels(doc), ["page:p", "folder:first", "page:r", "folder:second", "folder:third"]);
  assert.equal(doc.pageFolders?.[0].beforePageId, "r");
  assert.equal(validSiteDoc(doc), true);
});

test("folder drag is one undoable change and survives redo", () => {
  const store = useEditor.getState();
  store.replaceDoc(example());
  const before = structuredClone(useEditor.getState().doc);
  useEditor.getState().moveFolder("second", { kind: "page", id: "q", after: false });
  const after = structuredClone(useEditor.getState().doc);
  assert.deepEqual(labels(after), ["page:p", "folder:second", "page:q", "page:r", "folder:first", "folder:third"]);
  useEditor.getState().undo();
  assert.deepEqual(useEditor.getState().doc, before);
  useEditor.getState().redo();
  assert.deepEqual(useEditor.getState().doc, after);
});

test("folder positioning and an unrelated concurrent rename both survive a merge", () => {
  const base = example();
  const local = structuredClone(base);
  placePageFolder(local, "third", { kind: "page", id: "q", after: false });
  const remote = structuredClone(base);
  remote.pageFolders![0].name = "Renamed";
  const merged = mergeDocs(base, local, remote);
  assert.deepEqual(labels(merged), labels(local));
  assert.equal(merged.pageFolders?.find((f) => f.id === "first")?.name, "Renamed");
  assert.equal(validSiteDoc(merged), true);
});

test("anchors for pages moved inside a folder do not leave dangling references", () => {
  const store = useEditor.getState();
  store.replaceDoc(example());
  useEditor.getState().moveFolder("third", { kind: "page", id: "q", after: false });
  useEditor.getState().movePagesToFolder(["q"], "first");
  const result = useEditor.getState().doc;
  assert.deepEqual(labels(result), ["page:p", "folder:third", "page:r", "folder:first", "folder:second"]);
  assert.equal(result.pageFolders?.find((f) => f.id === "third")?.beforePageId, "r");
  assert.equal(validSiteDoc(result), true);
});
