import assert from "node:assert/strict";
import { test } from "node:test";
import { validSiteDoc } from "../lib/doc-tree";
import { createInitialDoc } from "../lib/presets";
import { useEditor } from "../lib/store";
import { applyBreakpoints, BP_INFO, BP_ORDER, normalizeBreakpoints } from "../lib/style";

const unsafeIds = ["__proto__", "constructor", "prototype", "toString", "valueOf", "hasOwnProperty"];

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
    // The editor also normalizes in-memory documents supplied by its own
    // mutation paths, even when no import/API validator ran first.
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
    // Preserve the test process even while verifying the vulnerable baseline.
    if (originalDefault) Object.defineProperty(Object.prototype, "default", originalDefault);
    else Reflect.deleteProperty(Object.prototype, "default");
    Object.setPrototypeOf(BP_INFO, originalPrototype);
    useEditor.getState().replaceDoc(createInitialDoc());
    applyBreakpoints(undefined);
  }
});
