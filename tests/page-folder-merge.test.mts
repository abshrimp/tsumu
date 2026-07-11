import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeDocs } from "../lib/merge";
import { useEditor } from "../lib/store";
import { pageFolderFixture, pageFolderBundle } from "./helpers/page-folder-merge";
import type { SiteDoc } from "../lib/types";

const names = (doc: SiteDoc) => Object.fromEntries((doc.pageFolders ?? []).map((folder) => [folder.id, folder.name]));
const order = (doc: SiteDoc) => doc.pageFolders?.map((folder) => folder.id) ?? [];
function edit(base: SiteDoc, fn: () => void): SiteDoc {
  useEditor.getState().replaceDoc(structuredClone(base));
  fn();
  return structuredClone(useEditor.getState().doc);
}

test("concurrent renames of different page folders both survive", () => {
  const base = pageFolderFixture();
  const local = edit(base, () => useEditor.getState().renamePageFolder("first", "Local name"));
  const remote = edit(base, () => useEditor.getState().renamePageFolder("second", "Remote name"));
  const originals = structuredClone([base, local, remote]);
  const merged = mergeDocs(base, local, remote);
  assert.deepEqual(names(merged), { first: "Local name", second: "Remote name", third: "Third" });
  assert.deepEqual(order(merged), order(base));
  assert.deepEqual([base, local, remote], originals);
});

test("concurrent new folders keep their pages attached to visible folders", () => {
  const base = pageFolderFixture();
  let localId = "", remoteId = "";
  const local = edit(base, () => {
    localId = useEditor.getState().addPageFolder();
    useEditor.getState().movePagesToFolder(["p"], localId);
  });
  const remote = edit(base, () => {
    remoteId = useEditor.getState().addPageFolder();
    useEditor.getState().movePagesToFolder(["q"], remoteId);
  });
  const merged = mergeDocs(base, local, remote);
  assert.ok(names(merged)[localId]);
  assert.ok(names(merged)[remoteId]);
  assert.equal(merged.pages.p.folderId, localId);
  assert.equal(merged.pages.q.folderId, remoteId);
  assert.deepEqual(merged.nodes, base.nodes);
  assert.deepEqual(merged.pageOrder, local.pageOrder);
});

for (const localReorder of [false, true]) {
  test(`folder rename and ${localReorder ? "local" : "remote"} reorder remain independent`, () => {
    const base = pageFolderFixture();
    const renamed = edit(base, () => useEditor.getState().renamePageFolder("first", "Renamed"));
    const reordered = edit(base, () => useEditor.getState().moveFolder("third", 0));
    const merged = mergeDocs(base, localReorder ? reordered : renamed, localReorder ? renamed : reordered);
    assert.deepEqual(order(merged), ["third", "first", "second"]);
    assert.equal(names(merged).first, "Renamed");
  });
}

for (const localDelete of [false, true]) {
  test(`deleting a folder does not erase an unrelated ${localDelete ? "remote" : "local"} rename`, () => {
    const base = pageFolderFixture();
    const renamed = edit(base, () => useEditor.getState().renamePageFolder("first", "Renamed"));
    const deleted = edit(base, () => useEditor.getState().deletePageFolder("second"));
    const merged = mergeDocs(base, localDelete ? deleted : renamed, localDelete ? renamed : deleted);
    assert.deepEqual(order(merged), ["first", "third"]);
    assert.equal(names(merged).first, "Renamed");
    assert.equal(merged.pages.q.folderId, undefined);
    assert.deepEqual(merged.nodes, base.nodes);
  });
}

test("same-folder rename conflicts still prefer the local edit", () => {
  const base = pageFolderFixture();
  const local = edit(base, () => useEditor.getState().renamePageFolder("first", "Local"));
  const remote = edit(base, () => useEditor.getState().renamePageFolder("first", "Remote"));
  assert.equal(names(mergeDocs(base, local, remote)).first, "Local");
});

test("same-folder deletion conflicts keep the established local preference", () => {
  const base = pageFolderFixture();
  const renamed = edit(base, () => useEditor.getState().renamePageFolder("first", "Renamed"));
  const deleted = edit(base, () => useEditor.getState().deletePageFolder("first"));
  assert.equal(names(mergeDocs(base, renamed, deleted)).first, "Renamed");
  assert.equal(names(mergeDocs(base, deleted, renamed)).first, undefined);
});

test("an unchanged side preserves absent and empty folder collections", () => {
  const base = pageFolderFixture();
  for (const folders of [undefined, [], [{ id: "new", name: "Only folder" }]]) {
    const remote = structuredClone(base);
    if (folders) remote.pageFolders = folders;
    else delete remote.pageFolders;
    assert.deepEqual(mergeDocs(base, base, remote).pageFolders, folders);
    assert.deepEqual(mergeDocs(base, remote, base).pageFolders, folders);
  }
});

test("concurrent additions are inserted next to their following folder", () => {
  const base = pageFolderFixture();
  const local = structuredClone(base), remote = structuredClone(base);
  local.pageFolders!.splice(1, 0, { id: "local", name: "Local" });
  remote.pageFolders!.splice(2, 0, { id: "remote", name: "Remote" });
  assert.deepEqual(order(mergeDocs(base, local, remote)), ["first", "local", "second", "remote", "third"]);
});

test("Undo and Redo of a local rename retain a different remote folder rename", () => {
  const base = pageFolderFixture();
  const remote = edit(base, () => useEditor.getState().renamePageFolder("second", "Remote name"));
  edit(base, () => useEditor.getState().renamePageFolder("first", "Local name"));
  useEditor.getState().applyRemoteDoc(mergeDocs(base, useEditor.getState().doc, remote));
  useEditor.getState().undo();
  assert.deepEqual(names(useEditor.getState().doc), { first: "First", second: "Remote name", third: "Third" });
  useEditor.getState().redo();
  assert.deepEqual(names(useEditor.getState().doc), { first: "Local name", second: "Remote name", third: "Third" });
});

test("receiving a folder rename after Undo preserves it through Redo", () => {
  const base = pageFolderFixture();
  const remote = edit(base, () => useEditor.getState().renamePageFolder("second", "Remote name"));
  edit(base, () => useEditor.getState().renamePageFolder("first", "Local name"));
  useEditor.getState().undo();
  useEditor.getState().applyRemoteDoc(mergeDocs(base, useEditor.getState().doc, remote));
  useEditor.getState().redo();
  assert.deepEqual(names(useEditor.getState().doc), { first: "Local name", second: "Remote name", third: "Third" });
});

test("Undo of local folder creation keeps the remote folder and page membership", () => {
  const base = pageFolderFixture();
  let remoteId = "";
  const remote = edit(base, () => {
    remoteId = useEditor.getState().addPageFolder();
    useEditor.getState().movePagesToFolder(["q"], remoteId);
  });
  let localId = "";
  edit(base, () => {
    localId = useEditor.getState().addPageFolder();
    useEditor.getState().movePagesToFolder(["p"], localId);
  });
  useEditor.getState().applyRemoteDoc(mergeDocs(base, useEditor.getState().doc, remote));
  useEditor.getState().undo();
  assert.equal(useEditor.getState().doc.pages.p.folderId, "first");
  assert.equal(useEditor.getState().doc.pages.q.folderId, remoteId);
  assert.ok(names(useEditor.getState().doc)[remoteId]);
  useEditor.getState().undo();
  assert.equal(names(useEditor.getState().doc)[localId], undefined);
  assert.ok(names(useEditor.getState().doc)[remoteId]);
  useEditor.getState().redo();
  useEditor.getState().redo();
  assert.equal(useEditor.getState().doc.pages.p.folderId, localId);
  assert.ok(names(useEditor.getState().doc)[remoteId]);
});

for (const localDelete of [false, true]) {
  test(`a ${localDelete ? "local" : "remote"} folder deletion wins over a concurrent page move into it`, () => {
    const base = pageFolderFixture();
    const moved = edit(base, () => useEditor.getState().movePagesToFolder(["p"], "second"));
    const deleted = edit(base, () => useEditor.getState().deletePageFolder("second"));
    const originals = structuredClone([base, moved, deleted]);
    const merged = mergeDocs(base, localDelete ? deleted : moved, localDelete ? moved : deleted);
    assert.equal(names(merged).second, undefined);
    assert.equal(merged.pages.p.folderId, undefined);
    assert.equal(merged.pages.q.folderId, undefined);
    assert.deepEqual(merged.nodes, base.nodes);
    assert.deepEqual([base, moved, deleted], originals);
  });
}

test("concurrent folder reorder conflicts still prefer the local order", () => {
  const base = pageFolderFixture();
  const local = edit(base, () => useEditor.getState().moveFolder("third", 0));
  const remote = edit(base, () => useEditor.getState().moveFolder("second", 0));
  assert.deepEqual(order(mergeDocs(base, local, remote)), order(local));
});

test("Undo and Redo of folder deletion keep a concurrently added folder", () => {
  const base = pageFolderFixture();
  let remoteId = "";
  const remote = edit(base, () => { remoteId = useEditor.getState().addPageFolder(); });
  edit(base, () => useEditor.getState().deletePageFolder("first"));
  useEditor.getState().applyRemoteDoc(mergeDocs(base, useEditor.getState().doc, remote));
  assert.equal(names(useEditor.getState().doc).first, undefined);
  useEditor.getState().undo();
  assert.ok(names(useEditor.getState().doc)[remoteId]);
  assert.equal(names(useEditor.getState().doc).first, "First");
  assert.equal(useEditor.getState().doc.pages.p.folderId, "first");
  useEditor.getState().redo();
  assert.ok(names(useEditor.getState().doc)[remoteId]);
  assert.equal(names(useEditor.getState().doc).first, undefined);
  assert.equal(useEditor.getState().doc.pages.p.folderId, undefined);
});

test("merging documents without folders does not add a folder collection", () => {
  const base = pageFolderFixture();
  delete base.pageFolders;
  for (const page of Object.values(base.pages)) delete page.folderId;
  const local = structuredClone(base), remote = structuredClone(base);
  local.pages.p.name = "Local page";
  remote.pages.q.name = "Remote page";
  const merged = mergeDocs(base, local, remote);
  assert.equal(Object.hasOwn(merged, "pageFolders"), false);
  assert.equal(merged.pages.p.name, "Local page");
  assert.equal(merged.pages.q.name, "Remote page");
});

test("rebasing folder history does not mutate the existing document or history snapshots", () => {
  const base = pageFolderFixture();
  edit(base, () => {
    useEditor.getState().renamePageFolder("first", "Local name");
    useEditor.getState().deletePageFolder("third");
  });
  const current = useEditor.getState().doc;
  const past = [...useEditor.getState().past];
  const remote = structuredClone(base);
  remote.pageFolders![1].name = "Remote name";
  const originals = structuredClone([base, current, ...past, remote]);
  useEditor.getState().applyRemoteDoc(mergeDocs(base, current, remote));
  useEditor.getState().undo();
  useEditor.getState().redo();
  assert.deepEqual([base, current, ...past, remote], originals);
  assert.equal(names(useEditor.getState().doc).second, "Remote name");
  assert.equal(names(useEditor.getState().doc).third, undefined);
});

test("page folder fixture bundles actual PagesTab and mergeDocs", async () => {
  assert.ok((await pageFolderBundle()).length > 1000);
});
