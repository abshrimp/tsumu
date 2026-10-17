import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeDocs } from "../lib/merge";
import { makeBox } from "../lib/presets";
import { useEditor } from "../lib/store";
import { readLocalStorage } from "../lib/local-storage";
import type { SiteDoc } from "../lib/types";

function fixture(): SiteDoc {
  return {
    siteName: "Test",
    pages: { p: { id: "p", name: "Home", slug: "", title: "Home", description: "", children: ["a", "b"] } },
    pageOrder: ["p"],
    nodes: Object.fromEntries(["a", "b"].map((id) => [id, { ...makeBox(), id }])),
    assets: {},
  };
}

test("concurrent additions to the same page both remain visible", () => {
  const base = fixture();
  const local = structuredClone(base);
  const remote = structuredClone(base);
  local.nodes.l = { ...makeBox(), id: "l" };
  remote.nodes.r = { ...makeBox(), id: "r" };
  local.pages.p.children.splice(1, 0, "l");
  remote.pages.p.children.splice(1, 0, "r");
  const originals = structuredClone([base, local, remote]);
  const merged = mergeDocs(base, local, remote);
  assert.deepEqual(new Set(merged.pages.p.children), new Set(["a", "b", "l", "r"]));
  assert.equal(merged.pages.p.children[0], "a");
  assert.equal(merged.pages.p.children.at(-1), "b");
  assert.deepEqual([base, local, remote], originals);
});

test("editing a container does not discard a remote child insertion", () => {
  const base = fixture();
  const local = structuredClone(base);
  const remote = structuredClone(base);
  local.nodes.a.name = "Renamed";
  remote.nodes.r = { ...makeBox(), id: "r" };
  remote.nodes.a.children.push("r");
  const merged = mergeDocs(base, local, remote);
  assert.equal(merged.nodes.a.name, "Renamed");
  assert.deepEqual(merged.nodes.a.children, ["r"]);
});

test("conflicting moves give each node only one parent", () => {
  const base = fixture();
  base.nodes.c = { ...makeBox(), id: "c" };
  base.pages.p.children.push("c");
  const local = structuredClone(base);
  const remote = structuredClone(base);
  local.pages.p.children = ["a", "b"];
  remote.pages.p.children = ["a", "b"];
  local.nodes.a.children = ["c"];
  remote.nodes.b.children = ["c"];
  const merged = mergeDocs(base, local, remote);
  assert.deepEqual(merged.nodes.a.children, ["c"]);
  assert.deepEqual(merged.nodes.b.children, []);
});

test("opposing concurrent moves cannot create a cycle", () => {
  const base = fixture();
  const local = structuredClone(base);
  const remote = structuredClone(base);
  local.pages.p.children = ["b"];
  local.nodes.b.children = ["a"];
  remote.pages.p.children = ["a"];
  remote.nodes.a.children = ["b"];
  const merged = mergeDocs(base, local, remote);
  assert.deepEqual(merged.pages.p.children, ["b"]);
  assert.deepEqual(merged.nodes.b.children, ["a"]);
  assert.deepEqual(merged.nodes.a.children, []);
});

test("remote deletion is preserved while an unrelated node is edited", () => {
  const base = fixture();
  const local = structuredClone(base);
  const remote = structuredClone(base);
  local.nodes.b.name = "Changed";
  delete remote.nodes.a;
  remote.pages.p.children = ["b"];
  const merged = mergeDocs(base, local, remote);
  assert.deepEqual(merged.pages.p.children, ["b"]);
  assert.equal(merged.nodes.b.name, "Changed");
});

test("undo exits a component that no longer exists and clears text ranges", () => {
  useEditor.getState().replaceDoc(fixture());
  useEditor.getState().createComponent("a");
  const id = Object.keys(useEditor.getState().doc.components!)[0];
  useEditor.getState().setEditingComponent(id);
  useEditor.getState().setTextSel({ nodeId: "a", start: 0, end: 1, text: "a" });
  useEditor.getState().undo();
  assert.equal(useEditor.getState().editingComponentId, null);
  assert.equal(useEditor.getState().textSel, null);
});

test("redo exits a component removed by the restored history", () => {
  useEditor.getState().replaceDoc(fixture());
  useEditor.getState().createComponent("a");
  const id = Object.keys(useEditor.getState().doc.components!)[0];
  useEditor.getState().deleteComponent(id);
  useEditor.getState().undo();
  useEditor.getState().setEditingComponent(id);
  useEditor.getState().redo();
  assert.equal(useEditor.getState().editingComponentId, null);
});

test("blocked browser storage falls back without crashing", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { get localStorage() { throw new Error("Storage blocked"); } },
  });
  try {
    assert.equal(readLocalStorage("panel-l-w"), null);
  } finally {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("merging an unchanged side preserves nested component structure and ordering", () => {
  const base = fixture();
  const remote = structuredClone(base);
  remote.pages.p.children = ["b"];
  remote.nodes.b.children = ["a"];
  remote.nodes.root = { ...makeBox(), id: "root", children: ["child"] };
  remote.nodes.child = { ...makeBox(), id: "child" };
  remote.components = { c: { id: "c", name: "Component", rootId: "root" } };
  assert.deepEqual(mergeDocs(base, base, remote), remote);
});

test("undo after receiving a remote insertion removes only the local insertion", () => {
  const base = fixture();
  useEditor.getState().replaceDoc(base);
  useEditor.getState().insertNodes([{ ...makeBox(), id: "local" }], "local", { kind: "page", id: "p" });
  const remote = structuredClone(base);
  remote.nodes.remote = { ...makeBox(), id: "remote" };
  remote.pages.p.children.push("remote");
  useEditor.getState().applyRemoteDoc(mergeDocs(base, useEditor.getState().doc, remote));
  useEditor.getState().undo();
  assert.deepEqual(useEditor.getState().doc.pages.p.children, ["a", "b", "remote"]);
  assert.equal(useEditor.getState().doc.nodes.local, undefined);
  useEditor.getState().redo();
  assert.deepEqual(new Set(useEditor.getState().doc.pages.p.children), new Set(["a", "b", "local", "remote"]));
});

test("concurrent edits to different properties of the same element both remain", () => {
  const base = fixture();
  base.nodes.a.text = { content: "Hello", heading: 0 };
  const local = structuredClone(base);
  const remote = structuredClone(base);
  local.nodes.a.text!.content = "Hi";
  local.nodes.a.styles.base!.default!.color = "red";
  remote.nodes.a.styles.base!.default!.padding = "8px";
  remote.nodes.a.styles.sm = { default: { fontSize: "12px" } };
  remote.nodes.a.name = "Title";
  const merged = mergeDocs(base, local, remote);
  assert.equal(merged.nodes.a.text?.content, "Hi");
  assert.equal(merged.nodes.a.name, "Title");
  assert.equal(merged.nodes.a.styles.base?.default?.color, "red");
  assert.equal(merged.nodes.a.styles.base?.default?.padding, "8px");
  assert.deepEqual(merged.nodes.a.styles.sm, { default: { fontSize: "12px" } });
  // 同じ項目を両方が変えたときは、保存しようとしている自分を優先する
  remote.nodes.a.styles.base!.default!.color = "blue";
  assert.equal(mergeDocs(base, local, remote).nodes.a.styles.base?.default?.color, "red");
  // 相手が消した項目は消える
  const r2 = structuredClone(base);
  delete r2.nodes.a.styles.base!.default!.gap;
  assert.equal(mergeDocs(base, local, r2).nodes.a.styles.base?.default?.gap, undefined);
});

test("site settings changed on both sides keep each side's fields", () => {
  const base = fixture();
  base.pwa = { enabled: true, name: "App" };
  const local = structuredClone(base);
  const remote = structuredClone(base);
  local.pwa!.themeColor = "#111111";
  remote.pwa!.shortName = "A";
  assert.deepEqual(mergeDocs(base, local, remote).pwa, { enabled: true, name: "App", themeColor: "#111111", shortName: "A" });
});
