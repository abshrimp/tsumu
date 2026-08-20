import assert from "node:assert/strict";
import { test } from "node:test";
import { componentsReachable, useEditor } from "../lib/store";
import { validateDocValue } from "../lib/doc-storage";
import { makeBox } from "../lib/presets";
import type { SiteDoc } from "../lib/types";

const node = (id: string, children: string[] = []) => ({ ...makeBox(), id, children });
const instance = (id: string, componentId: string) => ({ ...node(id), type: "instance" as const, componentId });
function fixture(): SiteDoc {
  return {
    schemaVersion: 1, siteName: "Component moves",
    assets: {}, pageOrder: ["p"],
    pages: { p: { id: "p", name: "Home", title: "Home", description: "", slug: "",
      children: ["outside", "ordinary"] } },
    nodes: {
      a: node("a", ["ab"]),
      b: node("b"),
      ab: instance("ab", "B"),
      outside: instance("outside", "A"),
      ordinary: node("ordinary"),
    },
    components: {
      A: { id: "A", name: "A", rootId: "a" },
      B: { id: "B", name: "B", rootId: "b" },
    },
  };
}

test("moving an existing component instance into a dependent master cannot create a cycle", () => {
  const original = fixture();
  assert.equal(validateDocValue(original), null);
  useEditor.getState().replaceDoc(original);
  const before = useEditor.getState();
  useEditor.getState().moveNode("outside", { kind: "node", id: "b" }, 0);
  assert.equal(useEditor.getState().doc, original, "the invalid drag must not change the document");
  assert.deepEqual(useEditor.getState().past, before.past);
  assert.deepEqual(useEditor.getState().future, before.future);
});

test("inserting an instance that recursively references the destination master is rejected", () => {
  const original = fixture();
  useEditor.getState().replaceDoc(original);
  const added = instance("new-instance", "A");
  useEditor.getState().insertNodes([added], added.id, { kind: "node", id: "b" });
  assert.equal(useEditor.getState().doc, original);
  assert.ok(!useEditor.getState().doc.nodes[added.id]);
});

test("noncyclic moves and inserts remain undoable", () => {
  const original = fixture();
  useEditor.getState().replaceDoc(original);
  useEditor.getState().moveNode("ordinary", { kind: "node", id: "b" }, 0);
  assert.equal(validateDocValue(useEditor.getState().doc), null);
  assert.deepEqual(useEditor.getState().doc.nodes.b.children, ["ordinary"]);
  const next = instance("new-independent", "B");
  useEditor.getState().insertNodes([next], next.id, { kind: "page", id: "p" });
  assert.equal(validateDocValue(useEditor.getState().doc), null);
  useEditor.getState().undo();
  assert.equal(useEditor.getState().doc.nodes[next.id], undefined);
});

test("long acyclic component chains are traversed iteratively", () => {
  const doc = fixture();
  doc.components = {};
  doc.nodes = {};
  for (let i = 0; i < 10000; i++) {
    const rootId = "root-" + i;
    doc.nodes[rootId] = node(rootId, i < 9999 ? ["use-" + i] : []);
    if (i < 9999) doc.nodes["use-" + i] = instance("use-" + i, "comp-" + (i + 1));
    doc.components["comp-" + i] = { id: "comp-" + i, name: "Component", rootId };
  }
  assert.equal(componentsReachable(doc, ["comp-0"]).size, 10000);
});

test("inserting an instance with no definition cannot corrupt an ordinary page", () => {
  const original = fixture();
  useEditor.getState().replaceDoc(original);
  const invalid = instance("missing-definition", "missing-component");
  useEditor.getState().insertNodes([invalid], invalid.id, { kind: "page", id: "p" });
  assert.equal(useEditor.getState().doc, original);
  assert.ok(!useEditor.getState().doc.nodes[invalid.id]);
});
