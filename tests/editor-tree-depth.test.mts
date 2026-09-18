import assert from "node:assert/strict";
import { test } from "node:test";
import { makeBox, makeText } from "../lib/presets";
import { useEditor } from "../lib/store";
import { MAX_NODE_DEPTH, maxSubtreeDepth } from "../lib/doc-tree";
import { validateDocValue } from "../lib/doc-storage";
import type { SiteDoc } from "../lib/types";

const state = () => useEditor.getState();
function fixture(depth: number): SiteDoc {
  const nodes: SiteDoc["nodes"] = { host: { ...makeBox(), id: "host" } };
  for (let i = 1; i <= depth; i++) nodes[`n${i}`] = {
    ...makeBox(), id: `n${i}`, children: i < depth ? [`n${i + 1}`] : [],
  };
  return {
    schemaVersion: 1, siteName: "Depth", assets: {}, nodes, pageOrder: ["p"],
    pages: { p: { id: "p", name: "Page", slug: "", title: "", description: "", children: ["host", "n1"] } },
  };
}
const snapshot = () => structuredClone({
  doc: state().doc, past: state().past, future: state().future,
  selection: state().selection, selectedIds: state().selectedIds,
  editingText: state().editingText, textSel: state().textSel,
});
const cases: { name: string; setup?: (doc: SiteDoc, depth: number) => void; select?: (depth: number) => string; run: (depth: number) => unknown }[] = [
  { name: "moving", run: () => state().moveNode("n1", { kind: "node", id: "host" }, 0) },
  { name: "inserting", run: depth => {
    const node = { ...makeBox(), id: "extra" };
    state().insertNodes([node], node.id, { kind: "node", id: `n${depth}` });
  } },
  { name: "inserting a component instance", setup: doc => {
    doc.nodes.master = { ...makeBox(), id: "master" };
    doc.components = { c: { id: "c", name: "Component", rootId: "master" } };
  }, select: depth => `n${depth}`, run: () => state().insertInstance("c") },
  { name: "wrapping in a list", run: () => state().createList("n1") },
  { name: "detaching a component", setup: doc => {
    doc.pages.p.children = ["host"];
    doc.nodes.host.children = ["instance"];
    doc.nodes.instance = { ...makeBox(), id: "instance", type: "instance", componentId: "c" };
    doc.components = { c: { id: "c", name: "Component", rootId: "n1" } };
  }, run: () => state().detachInstance("instance") },
  { name: "splitting text", setup: (doc, depth) => {
    doc.nodes[`n${depth}`] = { ...makeText("abc"), id: `n${depth}` };
  }, run: depth => state().splitTextSpan(`n${depth}`, 1, 2, "b", { color: "red" }) },
];

for (const action of cases) for (const allowed of [false, true]) {
  test(`${action.name}: ${allowed ? "permits exactly" : "rejects exceeding"} MAX_NODE_DEPTH without losing history`, () => {
    const depth = MAX_NODE_DEPTH - (allowed ? 1 : 0);
    const doc = fixture(depth);
    action.setup?.(doc, depth);
    assert.equal(validateDocValue(doc), null);
    state().endGesture();
    state().replaceDoc(doc);
    state().setActivePage("p");
    state().select("host");
    state().updateNode("host", { name: "Temporary" });
    state().undo();
    if (action.select) state().select(action.select(depth));
    const before = snapshot();
    action.run(depth);
    if (!allowed) {
      assert.deepEqual(snapshot(), before, "rejected operations cannot change doc, undo/redo, or selection");
    } else {
      assert.notDeepEqual(state().doc, before.doc);
      assert.equal(validateDocValue(state().doc), null);
      const after = structuredClone(state().doc);
      state().undo();
      assert.deepEqual(state().doc, before.doc);
      state().redo();
      assert.deepEqual(state().doc, after);
    }
  });
}

test("subtree height handles multiple roots, detached trees, missing children and cycles iteratively", () => {
  assert.equal(maxSubtreeDepth({}, []), 0);
  const nodes = { a: { children: ["b"] }, b: { children: ["c"] }, c: { children: [] }, d: { children: [] } };
  assert.equal(maxSubtreeDepth(nodes, ["d", "a"]), 3);
  assert.equal(maxSubtreeDepth(nodes, ["b"]), 2);
  assert.equal(maxSubtreeDepth(nodes, ["missing"]), Infinity);
  assert.equal(maxSubtreeDepth({ a: { children: ["missing"] } }, ["a"]), Infinity);
  assert.equal(maxSubtreeDepth({ a: { children: ["b"] }, b: { children: ["a"] } }, ["a"]), Infinity);
  assert.equal(maxSubtreeDepth(fixture(1000).nodes, ["n1"]), 1000);
});
