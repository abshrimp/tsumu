import assert from "node:assert/strict";
import { test } from "node:test";
import { validSiteDoc } from "../lib/doc-tree";
import { createInitialDoc } from "../lib/presets";
import { useEditor } from "../lib/store";
import { applyBreakpoints, BP_INFO, BP_ORDER, normalizeBreakpoints } from "../lib/style";

const unsafeIds = [...new Set(["prototype", ...Object.getOwnPropertyNames(Object.prototype)])];

for (const id of unsafeIds) {
  test(`saved breakpoint IDs cannot address the object prototype: ${id}`, () => {
    const doc = createInitialDoc();
    doc.breakpoints = [{ id, label: "Imported width", maxWidth: 600 }];
    assert.equal(validSiteDoc(doc), false);
    assert.deepEqual(normalizeBreakpoints(doc.breakpoints), []);
  });
}

test("safe custom breakpoint IDs preserve their labels, widths, and style edits", () => {
  const doc = createInitialDoc();
  const breakpoint = { id: "bp_custom-1", label: "Custom width", maxWidth: 600 };
  doc.breakpoints = [breakpoint];
  assert.equal(validSiteDoc(doc), true);
  assert.deepEqual(normalizeBreakpoints(doc.breakpoints), [breakpoint]);
  useEditor.getState().replaceDoc(doc);
  useEditor.getState().setCustomWidth(550);
  const id = Object.keys(doc.nodes)[0];
  useEditor.getState().setStyleProps(id, { color: "red" });
  assert.equal(useEditor.getState().breakpoint, breakpoint.id);
  assert.equal(useEditor.getState().doc.nodes[id].styles[breakpoint.id]?.default?.color, "red");
});

test("resizing an imported document cannot make style editing mutate Object.prototype", () => {
  const originalPrototype = Object.getPrototypeOf(BP_INFO);
  const originalDefault = Object.getOwnPropertyDescriptor(Object.prototype, "default");
  const doc = createInitialDoc();
  doc.breakpoints = [{ id: "__proto__", label: "Imported width", maxWidth: 600 }];
  try {
    // エディタは、取り込みや API の検証を先に通っていない、自身の変更の経路から渡された
    // メモリの中の文書も正規化する。
    useEditor.getState().replaceDoc(doc);
    useEditor.getState().setCustomWidth(550);
    const id = Object.keys(doc.nodes)[0];
    useEditor.getState().setStyleProps(id, { color: "red" });
    assert.equal(Object.hasOwn(Object.prototype, "default"), !!originalDefault,
      "editing an element must never create an inherited style map");
    assert.equal(Object.getPrototypeOf(BP_INFO), originalPrototype);
    assert.deepEqual(BP_ORDER, ["base"]);
    assert.equal(useEditor.getState().breakpoint, "base");
    assert.equal(useEditor.getState().doc.nodes[id].styles.base?.default?.color, "red");
  } finally {
    // 脆弱な状態を基準として確かめる間も、テストのプロセスは壊さない。
    if (originalDefault) Object.defineProperty(Object.prototype, "default", originalDefault);
    else Reflect.deleteProperty(Object.prototype, "default");
    Object.setPrototypeOf(BP_INFO, originalPrototype);
    useEditor.getState().replaceDoc(createInitialDoc());
    applyBreakpoints(undefined);
  }
});
