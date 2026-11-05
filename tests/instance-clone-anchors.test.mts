import assert from "node:assert/strict";
import { test } from "node:test";
import { generateProject } from "../lib/generator";
import { pageNodeIds } from "../lib/script";
import { makeBox } from "../lib/presets";
import { useEditor } from "../lib/store";
import type { SiteDoc } from "../lib/types";

function fixture(): SiteDoc {
  return {
    siteName: "Anchors", assets: {}, pageOrder: ["p"],
    pages: { p: { id: "p", name: "Home", slug: "", title: "Home", description: "", children: ["first", "second", "fallback"] } },
    components: { card: { id: "card", name: "Card", rootId: "root" }, inner: { id: "inner", name: "Inner", rootId: "innerRoot" } },
    nodes: {
      first: { ...makeBox(), id: "first", type: "instance", componentId: "card", attrId: "first-card" },
      second: { ...makeBox(), id: "second", type: "instance", componentId: "card", attrId: "second-card" },
      fallback: { ...makeBox(), id: "fallback", type: "instance", componentId: "card" },
      root: { ...makeBox(), id: "root", attrId: "master-card", semantic: "div", children: ["nested"] },
      nested: { ...makeBox(), id: "nested", type: "instance", componentId: "inner", attrId: "nested-card" },
      innerRoot: { ...makeBox(), id: "innerRoot", attrId: "inner-master", semantic: "div" },
    },
  };
}

for (const operation of ["duplicate", "paste"] as const) {
  test(`${operation} reserves attached instance anchors and supports undo/redo`, () => {
    const doc = fixture();
    useEditor.getState().replaceDoc(doc);
    useEditor.getState().setActivePage("p");
    if (operation === "duplicate") useEditor.getState().duplicateNode("first");
    else {
      useEditor.getState().copyNode("first");
      useEditor.getState().select("first");
      useEditor.getState().pasteClipboard();
    }
    const state = useEditor.getState();
    assert.equal(state.doc.nodes[state.selection!].attrId, "first-card-2");
    const copyId = state.selection!;
    state.detachInstance("first");
    useEditor.getState().detachInstance(copyId);
    const detached = useEditor.getState().doc;
    const anchors = detached.pages.p.children.map((id) => detached.nodes[id].attrId);
    assert.equal(anchors.filter((id) => id === "first-card").length, 1);
    assert.equal(anchors.filter((id) => id === "first-card-2").length, 1);
    const page = generateProject(detached).files["app/page.tsx"];
    assert.equal((page.match(/id="first-card"/g) ?? []).length, 1);
    assert.equal((page.match(/id="first-card-2"/g) ?? []).length, 1);
    // 解除を2回戻してから、複製の履歴の境界を確かめる。
    useEditor.getState().undo();
    useEditor.getState().undo();
    const after = structuredClone(useEditor.getState().doc);
    state.undo();
    assert.deepEqual(useEditor.getState().doc, doc);
    useEditor.getState().redo();
    assert.deepEqual(useEditor.getState().doc, after);
  });
}


test("ID collection includes instance placements only when explicitly requested", () => {
  const doc = fixture();
  assert.deepEqual(pageNodeIds(doc, "p"), ["root", "innerRoot"]);
  assert.deepEqual(pageNodeIds(doc, "p", [], true), ["first", "root", "nested", "innerRoot", "second", "fallback"]);
  // 未使用マスターの編集中も、そこにあるインスタンスのIDを予約する。
  doc.pages.p.children = [];
  assert.deepEqual(pageNodeIds(doc, "p", ["root"], true), ["root", "nested", "innerRoot"]);
});
