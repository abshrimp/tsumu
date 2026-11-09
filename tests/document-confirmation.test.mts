import assert from "node:assert/strict";
import { test } from "node:test";
import { useEditor } from "../lib/store";
import { createInitialDoc, makeBox } from "../lib/presets";
import { elements, importCallbacks } from "./helpers/pending-import";

for (const kind of ["pages", "add", "reset"] as const) {
  for (const change of ["unchanged", "edit", "replace", "undo", "unmount", "decline"] as const) {
    test(`${kind} destructive confirmation: ${change}`, async () => {
      const doc = createInitialDoc();
      const first = doc.pages[doc.pageOrder[0]];
      doc.pages.extra = { ...structuredClone(first), id: "extra", name: "Extra", slug: "extra", children: [] };
      doc.pageOrder.push("extra");
      doc.nodes.master = { ...makeBox(), id: "master" };
      doc.components = { reusable: { id: "reusable", name: "Reusable", rootId: "master" } };
      useEditor.getState().replaceDoc(doc);
      const ui = importCallbacks(kind);
      let closed = false;
      const tree = ui.render({ onClose: () => { closed = true; } });
      const button = elements(tree).find(e => e.type === "button" && (kind === "pages"
        ? e.props.className === "row-act is-danger"
        : kind === "add" ? e.props["data-tip"] === "削除（すべてのインスタンスも削除）"
        : elements(e).some(x => Array.isArray(x.props.children) && x.props.children.includes("初期状態に戻す"))));
      assert.ok(button, kind);
      const pending = button.props.onClick({ stopPropagation() {} });
      assert.equal(ui.confirmations.length, 1);
      if (change === "edit" || change === "undo") useEditor.getState().updateDoc(d => { d.siteName = "New edit"; });
      if (change === "undo") useEditor.getState().undo();
      if (change === "replace") useEditor.getState().replaceDoc(structuredClone(doc));
      if (change === "unmount") ui.unmount();
      const before = useEditor.getState().doc;
      ui.confirmations[0].resolve(change !== "decline");
      await pending;
      if (change === "unchanged") {
        assert.notEqual(useEditor.getState().doc, before);
        if (kind === "reset") assert.equal(closed, true);
        useEditor.getState().undo();
        assert.deepEqual(useEditor.getState().doc, before);
      } else {
        assert.equal(useEditor.getState().doc, before);
        assert.equal(closed, false);
      }
      ui.unmount();
    });
  }
}

for (const route of ["menu", "bulk"] as const) test(`page ${route} deletion cancels after a remote edit`, async () => {
  const doc = createInitialDoc();
  const first = doc.pages[doc.pageOrder[0]];
  doc.pages.extra = { ...structuredClone(first), id: "extra", children: [] };
  doc.pageOrder.push("extra");
  useEditor.getState().replaceDoc(doc);
  const ui = importCallbacks("pages");
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { addEventListener() {}, removeEventListener() {} } });
  try {
    const tree = ui.render();
    const row = elements(tree).find(e => typeof e.props?.onContextMenu === "function");
    if (route === "menu") {
      row.props.onContextMenu({ preventDefault() {}, stopPropagation() {}, clientX: 0, clientY: 0 });
      const menu = elements(ui.render()).find(e => Array.isArray(e.props?.items) && e.props.items.some((item: any) => item.key === "del"));
      menu.props.items.find((item: any) => item.key === "del").onClick();
    } else {
      row.props.onClick({ metaKey: true });
      elements(ui.render()).find(e => e.props?.["aria-label"] === "選んだページを削除").props.onClick();
    }
    assert.equal(ui.confirmations.length, 1);
    useEditor.getState().updateDoc(d => { d.siteName = "Remote edit"; });
    const before = useEditor.getState().doc;
    ui.confirmations[0].resolve(true);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(useEditor.getState().doc, before);
  } finally {
    ui.unmount();
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
