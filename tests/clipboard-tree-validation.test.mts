import assert from "node:assert/strict";
import { test } from "node:test";
import { parseClipPayload, buildClipPayload, type ClipPayload } from "../lib/clip-transfer";
import { makeBox } from "../lib/presets";
import { MAX_NODE_DEPTH } from "../lib/doc-tree";
import { useEditor } from "../lib/store";
import type { SiteDoc } from "../lib/types";

const node = (id: string, children: string[] = []) => ({ ...makeBox(), id, children });
const emptyDoc = (): SiteDoc => ({
  schemaVersion: 1, siteName: "Clipboard", assets: {}, pageOrder: ["p"],
  pages: { p: { id: "p", name: "Home", slug: "", children: [] } }, nodes: {},
});
function payload(): ClipPayload {
  return { v: 1, site: "other", breakpoints: [{ id: "lg", label: "タブレット", maxWidth: 1024 }], nodes: [node("a")], rootIds: ["a"], assets: {}, components: {}, componentNodes: [], customFonts: [] };
}

for (const kind of ["self-cycle", "indirect-cycle", "shared-child", "duplicate-child", "duplicate-root", "nested-root", "too-deep", "component-cycle", "shared-master", "nested-master", "missing-master"] as const) {
  test(`clipboard rejects ${kind} without changing the destination`, () => {
    const p = payload();
    if (kind === "self-cycle") p.nodes[0].children = ["a"];
    if (kind === "indirect-cycle") p.nodes = [node("a", ["b"]), node("b", ["a"])];
    if (kind === "shared-child") { p.nodes = [node("a", ["c"]), node("b", ["c"]), node("c")]; p.rootIds = ["a", "b"]; }
    if (kind === "duplicate-child") p.nodes = [node("a", ["b", "b"]), node("b")];
    if (kind === "duplicate-root") p.rootIds = ["a", "a"];
    if (kind === "nested-root") { p.nodes = [node("a", ["b"]), node("b")]; p.rootIds = ["a", "b"]; }
    if (kind === "too-deep") { p.nodes = Array.from({ length: MAX_NODE_DEPTH + 1 }, (_, i) => node(`n${i}`, i < MAX_NODE_DEPTH ? [`n${i + 1}`] : [])); p.rootIds = ["n0"]; }
    if (kind === "component-cycle") { p.componentNodes = [node("master", ["master"])]; p.components.card = { id: "card", name: "Card", rootId: "master" }; }
    if (kind === "shared-master" || kind === "nested-master") {
      p.componentNodes = [node("master", kind === "nested-master" ? ["child"] : []), node("child")];
      p.components.first = { id: "first", name: "First", rootId: "master" };
      p.components.second = { id: "second", name: "Second", rootId: kind === "shared-master" ? "master" : "child" };
    }
    if (kind === "missing-master") p.components.card = { id: "card", name: "Card", rootId: "missing" };
    useEditor.getState().replaceDoc(emptyDoc());
    const before = useEditor.getState().doc;
    const parsed = parseClipPayload(JSON.stringify(p));
    if (parsed) useEditor.getState().pasteClipboard(parsed);
    assert.equal(parsed, null);
    assert.equal(useEditor.getState().doc, before);
  });
}

test("nested and repeatedly used components retain valid independent master trees", () => {
  const doc = emptyDoc();
  doc.nodes.outer = { ...node("outer"), type: "instance", componentId: "outer" };
  doc.nodes.outerMaster = node("outerMaster", ["inner1", "inner2"]);
  doc.nodes.inner1 = { ...node("inner1"), type: "instance", componentId: "inner" };
  doc.nodes.inner2 = { ...node("inner2"), type: "instance", componentId: "inner" };
  doc.nodes.innerMaster = node("innerMaster", ["leaf"]);
  doc.nodes.leaf = node("leaf");
  doc.components = {
    outer: { id: "outer", name: "Outer", rootId: "outerMaster" },
    inner: { id: "inner", name: "Inner", rootId: "innerMaster" },
  };
  const p = buildClipPayload(doc, { nodes: [doc.nodes.outer], rootIds: ["outer"] });
  assert.deepEqual(parseClipPayload(JSON.stringify(p)), p);
});


test("clipboard accepts the maximum supported tree depth", () => {
  const p = payload();
  p.nodes = Array.from({ length: MAX_NODE_DEPTH }, (_, i) => node(`n${i}`, i < MAX_NODE_DEPTH - 1 ? [`n${i + 1}`] : []));
  p.rootIds = ["n0"];
  assert.deepEqual(parseClipPayload(JSON.stringify(p)), p);
});


test("clipboard requires explicit root IDs and a string source site", () => {
  for (const field of ["rootIds", "site", "breakpoints"] as const) {
    const p = payload() as Partial<ClipPayload>;
    delete p[field];
    assert.equal(parseClipPayload(JSON.stringify(p)), null);
  }
  assert.equal(parseClipPayload(JSON.stringify({ ...payload(), rootIds: [] })), null);
  assert.equal(parseClipPayload(JSON.stringify({ ...payload(), site: 42 })), null);
});
