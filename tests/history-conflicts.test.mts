import assert from "node:assert/strict";
import { test } from "node:test";
import { makeBox } from "../lib/presets";
import { useEditor } from "../lib/store";
import type { SiteDoc } from "../lib/types";

function fixture(): SiteDoc {
  return {
    siteName: "History", pageOrder: ["p"], assets: {},
    pages: { p: { id: "p", name: "Home", slug: "", title: "Home", description: "", children: ["a"] } },
    nodes: { a: { ...makeBox(), id: "a", name: "Original", styles: { base: { default: { color: "red" } } } } },
  };
}
const state = () => useEditor.getState();

test("undo preserves remote edits that superseded the same local property", () => {
  state().replaceDoc(fixture());
  state().updateNode("a", { name: "Local" });
  state().setStyleProps("a", { color: "blue" });
  const remote = structuredClone(state().doc);
  remote.nodes.a.name = "Remote";
  state().applyRemoteDoc(remote);
  state().undo();
  assert.equal(state().doc.nodes.a.name, "Remote");
  assert.equal(state().doc.nodes.a.styles.base?.default?.color, "red");
  state().undo();
  assert.equal(state().doc.nodes.a.name, "Remote");
  state().redo();
  assert.equal(state().doc.nodes.a.name, "Remote");
  assert.equal(state().doc.nodes.a.styles.base?.default?.color, "blue");
});

test("redo does not overwrite a remote edit made after undo", () => {
  state().replaceDoc(fixture());
  state().updateNode("a", { name: "Local" });
  state().undo();
  const remote = structuredClone(state().doc);
  remote.nodes.a.name = "Remote";
  state().applyRemoteDoc(remote);
  state().redo();
  assert.equal(state().doc.nodes.a.name, "Remote");
});

test("undo does not resurrect a property removed by another editor", () => {
  state().replaceDoc(fixture());
  state().setStyleProps("a", { color: "blue" });
  const remote = structuredClone(state().doc);
  delete remote.nodes.a.styles.base!.default!.color;
  state().applyRemoteDoc(remote);
  state().undo();
  assert.equal(state().doc.nodes.a.styles.base?.default?.color, undefined);
});

test("undo does not revert another editor's subsequent move", () => {
  const doc = fixture();
  for (const id of ["first", "second"]) doc.nodes[id] = { ...makeBox(), id };
  doc.pages.p.children.push("first", "second");
  state().replaceDoc(doc);
  state().moveNode("a", { kind: "node", id: "first" }, 0);
  const remote = structuredClone(state().doc);
  remote.nodes.first.children = [];
  remote.nodes.second.children = ["a"];
  state().applyRemoteDoc(remote);
  state().undo();
  assert.deepEqual(state().doc.nodes.second.children, ["a"]);
  assert.deepEqual(state().doc.nodes.first.children, []);
  assert.ok(!state().doc.pages.p.children.includes("a"));
});

test("undo does not resurrect nodes removed after a local edit", () => {
  state().replaceDoc(fixture());
  state().updateNode("a", { name: "Local" });
  const remote = structuredClone(state().doc);
  delete remote.nodes.a;
  remote.pages.p.children = [];
  state().applyRemoteDoc(remote);
  state().undo();
  assert.equal(state().doc.nodes.a, undefined);
  assert.deepEqual(state().doc.pages.p.children, []);
});
