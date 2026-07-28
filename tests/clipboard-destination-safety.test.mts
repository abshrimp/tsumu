import assert from "node:assert/strict";
import { test } from "node:test";
import { buildClipPayload, parseClipPayload, type ClipPayload } from "../lib/clip-transfer";
import { useEditor } from "../lib/store";
import { makeBox } from "../lib/presets";
import { useDialogs } from "../lib/dialog";
import { MAX_NODE_DEPTH } from "../lib/doc-tree";
import { validateDocValue } from "../lib/doc-storage";
import type { SiteDoc } from "../lib/types";

const state = () => useEditor.getState();
const node = (id: string, children: string[] = []) => ({ ...makeBox(), id, children });
const doc = (): SiteDoc => ({
  siteName: "Test", assets: {}, pageOrder: ["p"],
  pages: { p: { id: "p", name: "Home", title: "Home", description: "", slug: "", children: [] } }, nodes: {}, components: {},
});
function open(d: SiteDoc) {
  state().endGesture(); state().replaceDoc(d); state().setActivePage("p"); state().setInsertMode("inside");
  useDialogs.setState({ queue: [] });
}
function source() {
  const d = doc();
  d.nodes = {
    am: node("am", ["bi"]), bi: { ...node("bi"), type: "instance", componentId: "B" },
    bm: node("bm"), ai: { ...node("ai"), type: "instance", componentId: "A" },
  };
  d.pages.p.children = ["ai"];
  d.components = { A: { id: "A", name: "A", rootId: "am" }, B: { id: "B", name: "B", rootId: "bm" } };
  const p = buildClipPayload(d, { nodes: [d.nodes.ai], rootIds: ["ai"] });
  p.assets.incoming = { id: "incoming", name: "image.png", path: "assets/image.png", width: 1, height: 1 };
  p.customFonts = [{ family: "Imported Font", weights: ["400"] }];
  return p;
}
function destination() {
  const d = doc(); d.nodes.bm = node("bm");
  d.components = { B: { id: "B", name: "B", rootId: "bm" } };
  return d;
}

test("cross-site component paste cannot create a cycle through a reused destination master", () => {
  const payload = source();
  assert.ok(parseClipPayload(JSON.stringify(payload)));
  open(destination()); state().setEditingComponent("B"); state().select("bm");
  state().updateNode("bm", { name: "Edited" }); state().undo();
  const before = state(), copied = structuredClone(payload);
  state().pasteClipboard(payload);
  assert.equal(state().doc, before.doc);
  assert.equal(state().past, before.past);
  assert.equal(state().future, before.future);
  assert.equal(state().selection, before.selection);
  assert.equal(state().editingComponentId, "B");
  assert.equal(useDialogs.getState().queue.length, 1);
  assert.deepEqual(payload, copied);
});

test("cycle check uses the existing master's content instead of the source master", () => {
  const d = destination();
  d.nodes.safe = node("safe");
  d.components!.A = { id: "A", name: "Local A", rootId: "safe" };
  open(d); state().setEditingComponent("B"); state().select("bm");
  const original = structuredClone(state().doc);
  state().pasteClipboard(source());
  const result = state().doc;
  assert.equal(useDialogs.getState().queue.length, 0);
  assert.equal(result.nodes.bm.children.length, 1);
  assert.equal(result.nodes[result.nodes.bm.children[0]].componentId, "A");
  assert.deepEqual(result.nodes.safe, original.nodes.safe);
  assert.equal(result.nodes.am, undefined);
  state().undo(); assert.deepEqual(state().doc, original);
  state().redo(); assert.deepEqual(state().doc, result);
});

function deepPayload(depth: number): ClipPayload {
  return { v: 1, site: "other", nodes: Array.from({ length: depth }, (_, i) => node(`n${i}`, i < depth - 1 ? [`n${i + 1}`] : [])),
    rootIds: ["n0"], assets: {}, components: {}, componentNodes: [], customFonts: [] };
}
for (const [depth, allowed] of [[MAX_NODE_DEPTH, false], [MAX_NODE_DEPTH - 1, true]] as const) {
  test(`paste ${depth}-deep tree into a parent ${allowed ? "preserves" : "rejects exceeding"} the depth limit`, () => {
    const d = doc(); d.nodes.parent = node("parent"); d.pages.p.children = ["parent"];
    const payload = deepPayload(depth);
    assert.ok(parseClipPayload(JSON.stringify(payload)));
    open(d); state().select("parent");
    const before = state();
    state().pasteClipboard(payload);
    assert.equal(validateDocValue(state().doc), null);
    if (allowed) {
      assert.equal(state().doc.nodes.parent.children.length, 1);
      state().undo(); assert.deepEqual(state().doc, before.doc);
    } else {
      assert.equal(state().doc, before.doc);
      assert.equal(state().past, before.past);
      assert.equal(state().future, before.future);
      assert.equal(state().selection, before.selection);
      assert.equal(useDialogs.getState().queue.length, 1);
    }
  });
}
