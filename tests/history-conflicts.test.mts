import assert from "node:assert/strict";
import { test } from "node:test";
import { makeBox } from "../lib/presets";
import { useEditor } from "../lib/store";
import type { SiteDoc } from "../lib/types";

function fixture(): SiteDoc {
  return {
    schemaVersion: 1, siteName: "History", pageOrder: ["p"], assets: {}, components: {},
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

for (const path of ["node gesture", "document gesture", "transient checkpoint"] as const) {
  test(`remote updates before the first ${path} change preserve one Undo step and invalidate Redo`, () => {
    state().endGesture();
    const doc = fixture();
    doc.nodes.deleted = { ...makeBox(), id: "deleted" };
    doc.pages.p.children.push("deleted");
    state().replaceDoc(doc);
    state().updatePage("p", { description: "Abandoned edit" });
    state().undo();
    assert.equal(state().future.length, 1);

    let finish = () => {};
    if (path === "transient checkpoint") state().checkpoint();
    else finish = state().beginGesture();
    const remote = structuredClone(state().doc);
    remote.nodes.a.name = "Collaborator rename";
    delete remote.nodes.deleted;
    remote.pages.p.children = ["a"];
    state().applyRemoteDoc(remote);
    // 接続し直した後のスナップショットを含め、同期を何度くり返しても、
    // 時点を使い切ったり、空の履歴の項目を作ったりしてはならない。
    const latest = structuredClone(remote);
    latest.siteName = "Remote site name";
    state().applyRemoteDoc(latest);
    assert.equal(state().past.length, 0);
    assert.equal(state().future.length, 1);

    for (const color of ["blue", "green"]) {
      if (path === "document gesture") {
        state().updateDoc(d => { d.nodes.a.styles.base!.default!.color = color; });
      } else {
        state().setStyleProps("a", { color }, { transient: path === "transient checkpoint" });
      }
    }
    finish();
    assert.equal(state().past.length, 1);
    assert.equal(state().future.length, 0, "new local changes discard the abandoned redo branch");
    const changed = structuredClone(state().doc);
    state().undo();
    assert.deepEqual(state().doc, latest, "undo retains remote properties and node deletion");
    state().redo();
    assert.deepEqual(state().doc, changed);
    assert.equal(state().doc.schemaVersion, 1);
    assert.deepEqual(remote.nodes.a.styles, doc.nodes.a.styles, "rebasing does not mutate input snapshots");
  });
}

test("a remote deletion followed by a no-op gesture preserves the rebased redo branch", () => {
  state().endGesture();
  state().replaceDoc(fixture());
  state().updatePage("p", { description: "Redo me" });
  state().undo();
  const finish = state().beginGesture();
  const remote = structuredClone(state().doc);
  delete remote.nodes.a;
  remote.pages.p.children = [];
  state().applyRemoteDoc(remote);
  state().updateNode("a", { name: "Late edit to deleted node" });
  finish();
  assert.equal(state().past.length, 0);
  assert.equal(state().future.length, 1);
  state().redo();
  assert.deepEqual(state().doc, { ...remote, pages: { p: { ...remote.pages.p, description: "Redo me" } } });
});
