import assert from "node:assert/strict";
import { test } from "node:test";
import { makeBox } from "../lib/presets";
import { useEditor } from "../lib/store";
import type { DocNode, SiteDoc } from "../lib/types";

function fixture(): SiteDoc {
  const child: DocNode = {
    ...makeBox(), id: "child", attrId: "target", text: { content: "{target}", heading: 0 },
    link: { kind: "url", url: "#target" },
    scripts: [{ id: "script", trigger: "click", pos: { x: 0, y: 0 }, steps: [
      { id: "step", kind: "open-url", url: "#target" },
    ] }],
  };
  return {
    siteName: "Components", assets: {}, pageOrder: ["p"],
    pages: { p: { id: "p", name: "Home", slug: "", title: "Home", description: "", children: [] } },
    nodes: { root: { ...makeBox(), id: "root", children: ["child"] }, child },
    components: { c: { id: "c", name: "Card", rootId: "root" } },
  };
}

for (const operation of ["duplicate", "paste", "insert"] as const) {
  test(`${operation} while editing an unused component avoids master ID collisions`, () => {
    useEditor.getState().replaceDoc(fixture());
    useEditor.getState().setActivePage("p");
    useEditor.getState().setEditingComponent("c");
    const original = structuredClone(useEditor.getState().doc);
    if (operation === "duplicate") useEditor.getState().duplicateNode("child");
    else if (operation === "paste") {
      useEditor.getState().copyNode("child");
      useEditor.getState().select("root");
      useEditor.getState().pasteClipboard();
    } else {
      const clone = { ...structuredClone(original.nodes.child), id: "new" };
      useEditor.getState().insertNodes([clone], "new", { kind: "node", id: "root" });
    }
    const state = useEditor.getState();
    const clone = state.doc.nodes[state.selection!];
    assert.equal(clone.attrId, "target-2");
    assert.equal(clone.text?.content, "{target-2}");
    assert.equal(clone.link?.url, "#target-2");
    assert.equal(clone.scripts?.[0].steps[0].kind === "open-url" ? clone.scripts[0].steps[0].url : undefined, "#target-2");
    assert.notEqual(clone.scripts?.[0].id, "script");
    assert.deepEqual(state.doc.nodes.child, original.nodes.child);
    useEditor.getState().undo();
    assert.deepEqual(useEditor.getState().doc, original);
    useEditor.getState().redo();
    assert.equal(useEditor.getState().doc.nodes[clone.id].attrId, "target-2");
  });
}

test("detaching a nested instance checks IDs against the edited component", () => {
  const doc = fixture();
  doc.components!.inner = { id: "inner", name: "Inner", rootId: "innerRoot" };
  doc.nodes.innerRoot = { ...makeBox(), id: "innerRoot", attrId: "inner", children: [] };
  doc.nodes.instance = { ...makeBox(), id: "instance", type: "instance", componentId: "inner" };
  doc.nodes.root.children.push("instance");
  stateReset(doc);
  const original = structuredClone(useEditor.getState().doc);
  useEditor.getState().detachInstance("instance");
  const state = useEditor.getState();
  const detached = state.doc.nodes[state.selection!];
  assert.equal(detached.attrId, "inner-2");
  assert.equal(detached.type, "box");
  assert.ok(state.doc.nodes.root.children.includes(detached.id));
  assert.equal(state.doc.nodes.instance, undefined);
  assert.deepEqual(state.doc.nodes.innerRoot, original.nodes.innerRoot);
  useEditor.getState().undo();
  assert.deepEqual(useEditor.getState().doc, original);
  useEditor.getState().redo();
  assert.equal(useEditor.getState().doc.nodes[detached.id].attrId, "inner-2");
});

function stateReset(doc: SiteDoc) {
  useEditor.getState().replaceDoc(doc);
  useEditor.getState().setActivePage("p");
  useEditor.getState().setEditingComponent("c");
}
