import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { transformSync } from "esbuild";
import { useEditor } from "../lib/store";
import { applyPageScripts, pageScriptsOf } from "../lib/script";
import { removeKeys } from "../components/script-editor/step-tree";
import type { ScriptEditorLatest } from "../components/ScriptEditor";
import { scriptKeyboardBundle, scriptKeyboardDoc } from "./helpers/script-keyboard";

// 実キー操作フックとストアで確認する。実際の選択欄へのフォーカス・キー伝播はE2Eでも確認する。
function mount(selected = ["step:open"]) {
  useEditor.getState().replaceDoc(scriptKeyboardDoc());
  useEditor.getState().setActivePage("p");
  const win = new EventTarget();
  let popoverOpen = false;
  const cleanups: (() => void)[] = [];
  const latest = { current: {} as ScriptEditorLatest };
  const scripts = () => pageScriptsOf(useEditor.getState().doc, [], "p");
  latest.current = {
    setZoom() {}, stepZoom() {}, scripts: scripts(), focusNodeId: null, peekId: null, onClose() {},
    selectedList: selected,
    commit: (next) => useEditor.getState().updateDoc((doc) => applyPageScripts(doc, "p", [], next)),
    deleteSelected: () => {
      latest.current.commit(removeKeys(scripts(), latest.current.selectedList));
      latest.current.selectedList = [];
    },
    selectAll: () => { latest.current.selectedList = scripts().map((script) => `script:${script.id}`); },
  };
  const module = { exports: {} as any };
  const require = createRequire(resolve("components/script-editor/useScriptEditorKeys.ts"));
  const code = transformSync(readFileSync("components/script-editor/useScriptEditorKeys.ts", "utf8"), { loader: "ts", format: "cjs" }).code;
  new Function("require", "module", "exports", "window", "document", code)(
    (id: string) => id === "react" ? { useEffect: (fn: () => () => void) => cleanups.push(fn()) } :
      id === "../../lib/store" ? { useEditor } : require(id),
    module, module.exports, win, {
      querySelector: (selector: string) =>
        popoverOpen && selector.includes("[data-se-popover]") ? {} : null,
    },
  );
  module.exports.useScriptEditorKeys({
    dragRef: { current: null }, cancelGesture: () => false, latest,
    setPeekId() {}, setSelectedList: (ids: string[]) => { latest.current.selectedList = ids; },
  });
  return {
    latest,
    setPopoverOpen(value: boolean) { popoverOpen = value; },
    key(key: string, tagName = "BODY", ctrlKey = false, shiftKey = false, metaKey = false) {
      const event = Object.assign(new Event("keydown", { cancelable: true }), { key, ctrlKey, shiftKey, metaKey });
      Object.defineProperty(event, "target", { value: { tagName, isContentEditable: tagName === "DIV" } });
      win.dispatchEvent(event);
      return event.defaultPrevented;
    },
    cleanup: () => cleanups.forEach((cleanup) => cleanup()),
  };
}
const snapshot = () => structuredClone({ doc: useEditor.getState().doc, past: useEditor.getState().past, future: useEditor.getState().future });

// NodePicker portals contain tabbable buttons as well as the search input.
// Native-input detection alone must not expose the selected workspace behind them.
for (const key of ["Backspace", "Delete"]) test(`an open picker owns ${key} after focus moves to a button`, () => {
  const f = mount(["script:script"]);
  try {
    f.setPopoverOpen(true);
    const before = snapshot();
    const prevented = f.key(key, "BUTTON");
    assert.deepEqual(snapshot(), before);
    assert.deepEqual(f.latest.current.selectedList, ["script:script"]);
    assert.equal(prevented, false);
    f.setPopoverOpen(false);
    assert.equal(f.key(key, "BUTTON"), true, "workspace shortcuts resume after closing the picker");
    assert.notDeepEqual(snapshot().doc, before.doc);
  } finally { f.cleanup(); }
});

for (const modifier of ["Control", "Meta"]) for (const { key, shift } of [
  { key: "a", shift: false }, { key: "z", shift: false },
  { key: "y", shift: false }, { key: "z", shift: true },
]) test(`an open picker owns ${modifier}+${shift ? "Shift+" : ""}${key} on a button`, () => {
  const f = mount();
  try {
    useEditor.getState().updatePage("p", { title: "Keep this edit" });
    if (key === "y" || shift) useEditor.getState().undo();
    f.setPopoverOpen(true);
    const before = snapshot();
    const prevented = f.key(key, "BUTTON", modifier === "Control", shift, modifier === "Meta");
    assert.deepEqual(snapshot(), before);
    assert.deepEqual(f.latest.current.selectedList, ["step:open"]);
    assert.equal(prevented, false);
  } finally { f.cleanup(); }
});

for (const tag of ["SELECT", "INPUT", "TEXTAREA", "DIV"]) {
  for (const key of ["Backspace", "Delete"]) test(`${tag}: ${key} does not delete the selected script block`, () => {
    const f = mount(), before = snapshot();
    try {
      const prevented = f.key(key, tag);
      assert.deepEqual(snapshot(), before);
      assert.equal(prevented, false);
      assert.deepEqual(f.latest.current.selectedList, ["step:open"]);
    } finally { f.cleanup(); }
  });
}
for (const modifier of ["Control", "Meta"]) for (const { key, shift } of [
  { key: "a", shift: false }, { key: "z", shift: false }, { key: "y", shift: false }, { key: "z", shift: true },
]) test(`a focused SELECT owns ${modifier}+${shift ? "Shift+" : ""}${key}`, () => {
  const f = mount();
  try {
    useEditor.getState().updatePage("p", { title: "Keep this edit" });
    if (key === "y" || shift) useEditor.getState().undo();
    const before = snapshot();
    const prevented = f.key(key, "SELECT", modifier === "Control", shift, modifier === "Meta");
    assert.deepEqual(snapshot(), before);
    assert.deepEqual(f.latest.current.selectedList, ["step:open"]);
    assert.equal(prevented, false);
  } finally { f.cleanup(); }
});
test("a focused SELECT keeps its native arrow and type-ahead keys", () => {
  const f = mount(), before = snapshot();
  try {
    for (const key of ["ArrowUp", "ArrowDown", "Home", "End", "p", "Enter"]) assert.equal(f.key(key, "SELECT"), false);
    assert.deepEqual(snapshot(), before);
  } finally { f.cleanup(); }
});
for (const selected of [["step:open"], ["script:script"]]) test(`${selected[0]}: normal workspace Delete is one reversible change`, () => {
  const f = mount(selected), before = snapshot();
  try {
    assert.equal(f.key("Delete"), true);
    const after = snapshot();
    assert.notDeepEqual(after.doc, before.doc);
    assert.equal(after.past.length, before.past.length + 1);
    assert.equal(f.key("z", "BODY", true), true);
    assert.deepEqual(useEditor.getState().doc, before.doc);
    assert.equal(f.key("y", "BODY", true), true);
    assert.deepEqual(useEditor.getState().doc, after.doc);
  } finally { f.cleanup(); }
});
test("the browser fixture bundles the real script editor and keyboard hook", async () => {
  const bundle = await scriptKeyboardBundle();
  assert.match(bundle, /function ScriptEditorInner/);
  assert.match(bundle, /function useScriptEditorKeys/);
});
