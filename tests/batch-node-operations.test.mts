import assert from "node:assert/strict";
import { test } from "node:test";
import { validSiteDoc } from "../lib/doc-tree";
import { makeBox } from "../lib/presets";
import { ancestorsOf, useEditor } from "../lib/store";
import type { SiteDoc } from "../lib/types";

const state = () => useEditor.getState();

function fixture(): SiteDoc {
  const children: Record<string, string[]> = {
    left: ["a", "b"], a: [], b: ["nested"], nested: [],
    right: ["c", "d"], c: [], d: [], destination: [], locked: [],
  };
  const doc: SiteDoc = {
    schemaVersion: 1, siteName: "Batch operations", assets: {}, pageOrder: ["p"],
    pages: {
      p: { id: "p", name: "Home", slug: "", title: "", description: "",
        children: ["left", "right", "destination", "locked"] },
    },
    nodes: Object.fromEntries(Object.entries(children).map(([id, children]) =>
      [id, { ...makeBox(), id, name: id, children, ...(id === "locked" ? { locked: true } : {}) }]
    )),
  };
  state().replaceDoc(doc);
  state().setActivePage("p");
  return doc;
}

test("batch moves retain tree order across parents, include descendants once, and undo atomically", () => {
  const before = fixture();
  state().moveNodes(["d", "nested", "a", "b", "locked", "b"], { kind: "node", id: "destination" }, 0);
  const moved = state().doc;
  assert.deepEqual(moved.nodes.destination.children, ["a", "b", "d"]);
  assert.deepEqual(moved.nodes.left.children, []);
  assert.deepEqual(moved.nodes.right.children, ["c"]);
  assert.deepEqual(moved.nodes.b.children, ["nested"]);
  assert.deepEqual(moved.pages.p.children, before.pages.p.children);
  assert.equal(state().past.length, 1);
  assert.ok(validSiteDoc(moved));
  assert.deepEqual(before.nodes.left.children, ["a", "b"]);
  state().undo();
  assert.deepEqual(state().doc, before);
  state().redo();
  assert.deepEqual(state().doc, moved);
});

test("batch moves reject a selected root's descendant as destination without changing history", () => {
  const before = fixture();
  state().moveNodes(["d", "left", "a"], { kind: "node", id: "nested" }, 0);
  assert.equal(state().doc, before);
  assert.equal(state().past.length, 0);
});

test("batch duplicates stay beside each original and clone overlapping or repeated selections once", () => {
  const before = fixture();
  state().duplicateNodes(["d", "nested", "b", "a", "b"]);
  const copied = state().doc;
  const [a, b, d] = state().selectedIds;
  assert.deepEqual(state().selectedIds.map(id => copied.nodes[id].name), ["a", "b", "d"]);
  assert.deepEqual(copied.nodes.left.children, ["a", a, "b", b]);
  assert.deepEqual(copied.nodes.right.children, ["c", "d", d]);
  assert.equal(copied.nodes[b].children.length, 1);
  assert.notEqual(copied.nodes[b].children[0], "nested");
  assert.equal(copied.nodes[copied.nodes[b].children[0]].name, "nested");
  assert.equal(Object.keys(copied.nodes).length, Object.keys(before.nodes).length + 4);
  assert.ok(validSiteDoc(copied));
  state().undo();
  assert.deepEqual(state().doc, before);
  state().redo();
  assert.deepEqual(state().doc, copied);
});

test("batch copy and deletion share nested selection boundaries without losing unrelated nodes", () => {
  const before = fixture();
  state().selectMany(["d", "nested", "b", "a", "b"], "b");
  state().copyNode("b");
  assert.deepEqual(state().clipboard!.rootIds, ["a", "b", "d"]);
  assert.deepEqual(state().clipboard!.nodes.map(node => node.id), ["a", "b", "nested", "d"]);
  state().deleteNodes(["d", "nested", "b", "a", "locked", "b"]);
  assert.deepEqual(state().doc.nodes.left.children, []);
  assert.deepEqual(state().doc.nodes.right.children, ["c"]);
  assert.equal(state().doc.nodes.nested, undefined);
  assert.equal(state().doc.nodes.locked.locked, true);
  assert.ok(validSiteDoc(state().doc));
  state().undo();
  assert.deepEqual(state().doc, before);
});

test("successive moves, duplication and undo always use the current parent relationships", () => {
  const before = fixture();
  state().moveNodes(["a", "b"], { kind: "node", id: "right" }, 1);
  assert.deepEqual(ancestorsOf(state().doc, "nested"), ["right", "b"]);
  state().duplicateNodes(["a", "b"]);
  const [a, b] = state().selectedIds;
  assert.deepEqual(state().doc.nodes.right.children, ["c", "a", a, "b", b, "d"]);
  state().undo();
  state().moveNodes(["a", "b"], { kind: "node", id: "left" }, 0);
  assert.deepEqual(state().doc.nodes.left.children, ["a", "b"]);
  assert.deepEqual(ancestorsOf(state().doc, "nested"), ["left", "b"]);
  assert.deepEqual(state().doc, before);
  assert.ok(validSiteDoc(state().doc));
});
