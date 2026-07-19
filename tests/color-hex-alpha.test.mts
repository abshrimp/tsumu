import assert from "node:assert/strict";
import { test } from "node:test";
import { parseColor, composeColor } from "../components/controls";

for (const [value, hex, alpha] of [
  ["#1234", "#112233", 68 / 255],
  ["#12345678", "#123456", 120 / 255],
  [" #AbCf ", "#AAbbCC", 1],
  ["#ff880000", "#ff8800", 0],
] as const) {
  test(`opacity edits retain RGB from ${value}`, () => {
    const parsed = parseColor(value);
    assert.deepEqual(parsed, { hex, alpha });
    // FillControl's opacity input composes the new alpha with parsed RGB.
    assert.equal(composeColor(parsed.hex, 0.5),
      `rgba(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)}, 0.5)`);
  });
}

test("ordinary hex colors retain their opaque defaults", () => {
  assert.deepEqual(parseColor("#abc"), { hex: "#aabbcc", alpha: 1 });
  assert.deepEqual(parseColor("#123456"), { hex: "#123456", alpha: 1 });
  assert.deepEqual(parseColor("rgba(12, 34, 56, 0.5)"), { hex: "#0c2238", alpha: 0.5 });
});
