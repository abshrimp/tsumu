import assert from "node:assert/strict";
import { test } from "node:test";
import { useEditor } from "../lib/store";
import { makeText } from "../lib/presets";
import type { Asset, SiteDoc } from "../lib/types";

const state = () => useEditor.getState();
const asset: Asset = { id: "uploaded", name: "image.png", path: "assets/image.png", width: 1, height: 1 };
function fixture(): SiteDoc {
  return {
    siteName: "Retained upload", assets: {}, pageOrder: ["p"],
    pages: { p: { id: "p", name: "P", slug: "", title: "", description: "", children: ["a"] } },
    nodes: { a: { ...makeText("Original"), id: "a", styles: { base: { default: { color: "red" } } } } },
  };
}
function open() {
  state().endGesture(); state().replaceDoc(fixture()); state().select("a");
  state().setBreakpoint("base"); state().setStyleState("default");
}
function retained(doc: SiteDoc) { return { ...doc, assets: { ...doc.assets, [asset.id]: asset } }; }

test("history revision changes only for effective navigation and document replacement boundaries", () => {
  open();
  let revision = state().historyRevision;
  state().undo(); state().redo(); state().restoreDoc(structuredClone(state().doc));
  assert.equal(state().historyRevision, revision);
  state().updateNode("a", { name: "Local" });
  state().checkpoint(); state().updateDoc(() => {}, { history: false });
  const remote = structuredClone(state().doc); remote.siteName = "Remote";
  state().applyRemoteDoc(remote);
  assert.equal(state().historyRevision, revision, "ordinary and remote edits do not interrupt imports");
  state().undo(); assert.equal(state().historyRevision, ++revision);
  state().undo(); assert.equal(state().historyRevision, revision, "empty Undo does not interrupt");
  state().redo(); assert.equal(state().historyRevision, ++revision);
  state().redo(); assert.equal(state().historyRevision, revision, "empty Redo does not interrupt");
  state().restoreDoc(fixture()); assert.equal(state().historyRevision, ++revision);
  state().replaceDoc(state().doc); assert.equal(state().historyRevision, ++revision, "even identical replacement resets the document session");
  state().resetDoc(); assert.equal(state().historyRevision, ++revision);
});

test("asset retention preserves multiple undo/redo snapshots and current editing UI without a new history entry", () => {
  open();
  const original = structuredClone(state().doc);
  state().updateNode("a", { name: "Renamed" });
  const renamed = structuredClone(state().doc);
  state().setStyleProps("a", { color: "blue" });
  const blue = structuredClone(state().doc);
  state().undo(); state().undo();
  const before = state();
  const textSel = { nodeId: "a", start: 0, end: 2, text: "Or" };
  state().setEditingText("a"); state().setTextSel(textSel);
  const input = structuredClone(asset);
  state().retainUploadedAssets([input]);
  assert.equal(state().historyRevision, before.historyRevision);
  assert.equal(state().past.length, 0); assert.equal(state().future.length, 2);
  assert.equal(state().selection, "a"); assert.deepEqual(state().selectedIds, ["a"]);
  assert.equal(state().editingText, "a"); assert.equal(state().textSel, textSel);
  assert.deepEqual(before.doc, original, "older objects must not be mutated");
  assert.deepEqual(before.future, [renamed, blue]);
  input.name = "caller changed";
  assert.deepEqual(state().doc, retained(original));
  state().redo(); assert.deepEqual(state().doc, retained(renamed));
  state().redo(); assert.deepEqual(state().doc, retained(blue));
  state().undo(); assert.deepEqual(state().doc, retained(renamed));
  state().undo(); assert.deepEqual(state().doc, retained(original));
});

test("retention leaves an unused checkpoint and its redo branch intact until a real transient edit", () => {
  open();
  state().updateNode("a", { name: "Redo name" }); state().undo();
  state().checkpoint();
  state().retainUploadedAssets([asset]);
  assert.equal(state().past.length, 0); assert.equal(state().future.length, 1);
  state().updateDoc(() => {}, { history: false });
  assert.equal(state().past.length, 0); assert.equal(state().future.length, 1);
  state().setStyleProps("a", { color: "green" }, { transient: true });
  assert.equal(state().past.length, 1); assert.equal(state().future.length, 0);
  state().undo(); assert.deepEqual(state().doc, retained(fixture()));
  state().redo(); assert.equal(state().doc.nodes.a.styles.base?.default?.color, "green");
  assert.deepEqual(state().doc.assets.uploaded, asset);
});

test("retention does not consume or split an active gesture, before or after its first edit", () => {
  for (const firstEdit of [false, true]) {
    open(); state().beginGesture();
    if (firstEdit) state().setStyleProps("a", { color: "blue" });
    state().retainUploadedAssets([asset]);
    state().setStyleProps("a", { color: "green" });
    state().setStyleProps("a", { color: "purple" }); state().endGesture();
    assert.equal(state().past.length, 1);
    state().undo(); assert.deepEqual(state().doc, retained(fixture()));
    state().redo(); assert.equal(state().doc.nodes.a.styles.base?.default?.color, "purple");
    assert.deepEqual(state().doc.assets.uploaded, asset);
  }
});

test("retained assets survive redo and undo after remote history rebasing", () => {
  for (const retainFirst of [false, true]) {
    open(); state().updateNode("a", { name: "Local" }); state().undo();
    const revision = state().historyRevision;
    if (retainFirst) state().retainUploadedAssets([asset]);
    const remote = structuredClone(state().doc); remote.nodes.a.styles.base!.default!.color = "green";
    state().applyRemoteDoc(remote);
    if (!retainFirst) state().retainUploadedAssets([asset]);
    assert.equal(state().historyRevision, revision);
    assert.equal(state().future.length, 1);
    state().redo();
    assert.equal(state().doc.nodes.a.name, "Local");
    assert.equal(state().doc.nodes.a.styles.base?.default?.color, "green");
    assert.deepEqual(state().doc.assets.uploaded, asset);
    state().undo();
    assert.equal(state().doc.nodes.a.styles.base?.default?.color, "green");
    assert.deepEqual(state().doc.assets.uploaded, asset);
  }
});

test("retention is idempotent, never overwrites existing assets, and retains each completed file once", () => {
  open();
  state().retainUploadedAssets([asset, { ...asset, name: "duplicate" }]);
  const before = state();
  state().retainUploadedAssets([]);
  state().retainUploadedAssets([{ ...asset, name: "replacement" }]);
  assert.equal(state(), before);
  assert.deepEqual(state().doc.assets.uploaded, asset);
  assert.equal(state().past.length, 0);
});
