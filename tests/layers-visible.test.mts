import assert from "node:assert/strict";
import { test } from "node:test";
import { layerWindow, LAYER_ROW_HEIGHT, visibleLayerRows } from "../lib/layers-visible";
import { canvasMoveDoc } from "./helpers/canvas-move";

test("visible layers preserve preorder, depth, and page-root semantics", () => {
  const doc = canvasMoveDoc();
  doc.pages.p.children = ["a", "c"];
  doc.nodes.a.children = ["b"];
  const rows = visibleLayerRows(doc, doc.pages.p.children, new Set(), 1, true);
  assert.deepEqual(rows, [
    { id: "a", depth: 1, isTop: true },
    { id: "b", depth: 2, isTop: false },
    { id: "c", depth: 1, isTop: true },
  ]);
  assert.deepEqual(visibleLayerRows(doc, ["a"], new Set(), 0, false), [
    { id: "a", depth: 0, isTop: false },
    { id: "b", depth: 1, isTop: false },
  ]);
  assert.deepEqual(visibleLayerRows(doc, ["a", "c"], new Set(["a"]), 1, true).map((r) => r.id), ["a", "c"]);
});

test("visible layer traversal ignores missing nodes and corrupt cycles", () => {
  const doc = canvasMoveDoc();
  doc.nodes.a.children = ["b", "missing"];
  doc.nodes.b.children = ["a"];
  assert.deepEqual(visibleLayerRows(doc, ["a"], new Set(), 1, true).map((r) => r.id), ["a", "b"]);
});

test("viewport window is bounded and aligned to the fixed row height", () => {
  assert.deepEqual(layerWindow(0, 0, 600), { start: 0, end: 0 });
  assert.deepEqual(layerWindow(10000, 2800, 560), { start: 92, end: 128 });
  assert.deepEqual(layerWindow(10000, 0, 560), { start: 0, end: 28 });
  assert.deepEqual(layerWindow(10000, 9999 * LAYER_ROW_HEIGHT, 560), { start: 9991, end: 10000 });
  assert.deepEqual(layerWindow(10, -100, 560), { start: 0, end: 10 });
});

test("12,000 deeply nested elements traverse without recursion or mounting 12,000 rows", () => {
  const doc = canvasMoveDoc();
  const base = doc.nodes.a;
  const count = 12000;
  doc.nodes = Object.fromEntries(Array.from({ length: count }, (_, i) => {
    const id = `n${i}`;
    return [id, { ...base, id, children: i + 1 < count ? [`n${i + 1}`] : [] }];
  }));
  const rows = visibleLayerRows(doc, ["n0"], new Set(), 0, false);
  assert.equal(rows.length, count);
  assert.equal(rows.at(-1)?.depth, count - 1);
  const range = layerWindow(rows.length, 10000 * LAYER_ROW_HEIGHT, 448);
  assert.ok(range.end - range.start <= 32);
});
