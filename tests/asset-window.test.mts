import assert from "node:assert/strict";
import { test } from "node:test";
import { assetWindow } from "../lib/asset-window";

test("large libraries keep only the viewport and three overscan rows mounted", () => {
  for (const count of [101, 500, 5_000, 50_000]) for (const width of [200, 260, 380]) {
    const result = assetWindow(count, width, 600, 0);
    assert.equal(result.indices[0], 0);
    assert.ok(result.indices.length <= 26);
    assert.equal(new Set(result.indices).size, result.indices.length);
    assert.ok(result.indices.every((index) => index >= 0 && index < count));
  }
});

test("scrolling, shrinking a result, and resizing never leave a blank viewport", () => {
  for (const count of [0, 1, 101, 5_000]) for (const top of [-10, 0, 200, 9999999]) {
    const result = assetWindow(count, 260, 600, top);
    if (count) assert.ok(result.indices.length);
    else assert.deepEqual(result.indices, []);
    assert.ok(result.top >= 0);
    assert.ok(result.top <= Math.max(0, result.totalHeight - 600));
    assert.ok(result.indices.every((index) => index < count));
  }
});

test("focused, renamed, and dragged cards stay mounted without mounting intervening rows", () => {
  const result = assetWindow(5_000, 260, 600, 0, [700, 2001, 4999, -1, 5000, 700]);
  assert.ok(result.indices.includes(700));
  assert.ok(result.indices.includes(2001));
  assert.ok(result.indices.includes(4999));
  assert.ok(result.indices.length <= 30);
  assert.deepEqual(result.indices, [...new Set(result.indices)].sort((a, b) => a - b));
});

test("last odd card is reachable and total height matches the two-column card geometry", () => {
  const result = assetWindow(5_001, 274, 600, 99999999);
  assert.equal(result.rowHeight, 140);
  assert.equal(result.totalHeight, 2501 * 140 + 2);
  assert.equal(result.indices.at(-1), 5000);
});
