import assert from "node:assert/strict";
import { test } from "node:test";
import { useEditor } from "../lib/store";
import { createInitialDoc, makeBox } from "../lib/presets";
import { elements, importCallbacks } from "./helpers/pending-import";
const state = () => useEditor.getState();
function fixture() {
  const doc = createInitialDoc();
  doc.breakpoints = [{ id: "custom", label: "Custom", maxWidth: 800 }];
  doc.nodes.box = { ...makeBox(), id: "box", styles: { custom: { default: { color: "red" } } } };
  doc.pages[doc.pageOrder[0]].children = ["box"];
  state().replaceDoc(doc);
  const ui = importCallbacks("breakpoints");
  const buttons = elements(ui.render()).filter(e => e.type === "button");
  return { ui, remove: () => buttons.find(e => e.props["aria-label"] === "Delete Custom").props.onClick(),
    reset: () => buttons.find(e => elements(e).some(x => x.props?.children?.includes?.("Reset to defaults"))).props.onClick() };
}
for (const action of ["remove", "reset"] as const) for (const change of ["edit", "replace", "unmount", "unchanged"] as const) {
  test(`breakpoint ${action} confirmation handles ${change}`, async () => {
    const f = fixture(); const original = state().doc;
    const pending = f[action]();
    assert.equal(f.ui.confirmations.length, 1);
    if (change === "edit") state().updateDoc(d => { d.nodes.box.styles.custom.default.color = "blue"; });
    if (change === "replace") state().replaceDoc({ ...original, siteName: "Another document" });
    if (change === "unmount") f.ui.unmount();
    const before = state().doc;
    f.ui.confirmations[0].resolve(true); await pending;
    if (change === "unchanged") {
      assert.equal(state().doc.nodes.box.styles.custom, undefined);
      state().undo(); assert.deepEqual(state().doc, original);
    } else assert.equal(state().doc, before);
    f.ui.unmount();
  });
}
