import assert from "node:assert/strict";
import { test } from "node:test";
import { makeBox } from "../lib/presets";
import { useEditor } from "../lib/store";
import type { SiteDoc } from "../lib/types";
const state = () => useEditor.getState();
function open() {
  state().endGesture();
  const doc: SiteDoc = {
    siteName: "Locked nodes", assets: {}, pageOrder: ["p"],
    pages: { p: { id: "p", name: "Home", slug: "", title: "", description: "", children: ["a", "locked", "c"] } },
    nodes: Object.fromEntries(["a", "locked", "c"].map(id => [id, { ...makeBox(), id, name: id, locked: id === "locked" }])),
  };
  state().replaceDoc(doc);
  state().setActivePage("p");
  state().selectMany(["a", "locked"], "a");
  return structuredClone(doc);
}

test("cut copies only the unlocked selected nodes that will be deleted", () => {
  const before = open();
  state().copyNode("a", { unlockedOnly: true });
  state().deleteNodes(state().selectedIds);
  assert.deepEqual(state().clipboard!.rootIds, ["a"]);
  assert.deepEqual(state().doc.pages.p.children, ["locked", "c"]);
  state().undo();
  assert.deepEqual(state().doc, before);
  state().redo();
  state().select(null);
  state().pasteClipboard();
  assert.deepEqual(state().doc.pages.p.children.map(id => state().doc.nodes[id].name), ["locked", "c", "a"]);
});

test("ordinary copy still includes locked selected nodes", () => {
  open();
  state().copyNode("a");
  assert.deepEqual(state().clipboard!.rootIds, ["a", "locked"]);
});

test("an all-locked cut does not overwrite the previous clipboard", () => {
  open();
  state().select("a");
  state().copyNode("a");
  const clipboard = state().clipboard;
  state().select("locked");
  state().copyNode("locked", { unlockedOnly: true });
  assert.equal(state().clipboard, clipboard);
});

test("locked nodes cannot be reordered directly and do not create undo entries", () => {
  const before = open();
  state().moveNode("locked", { kind: "page", id: "p" }, 0);
  assert.deepEqual(state().doc, before);
  assert.equal(state().past.length, 0);
});

test("a mixed move moves only unlocked roots and undo restores the original order", () => {
  const before = open();
  state().moveNodes(["a", "locked"], { kind: "page", id: "p" }, 3);
  assert.deepEqual(state().doc.pages.p.children, ["locked", "c", "a"]);
  assert.equal(state().doc.nodes.locked.locked, true);
  state().undo();
  assert.deepEqual(state().doc, before);
});

test("cut keeps descendants of an unlocked root, matching subtree deletion semantics", () => {
  open();
  state().moveNode("c", { kind: "node", id: "a" }, 0);
  state().updateNode("c", { locked: true });
  state().select("a");
  state().copyNode("a", { unlockedOnly: true });
  assert.deepEqual(state().clipboard!.rootIds, ["a"]);
  assert.deepEqual(state().clipboard!.nodes.map(node => node.id), ["a", "c"]);
  state().deleteNodes(["a"]);
  assert.equal(state().doc.nodes.c, undefined);
});
