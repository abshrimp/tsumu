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
    // FillControl の不透明度の欄は、読み取った RGB と新しいアルファ値を組み合わせる。
    assert.equal(composeColor(parsed.hex, 0.5),
      `rgba(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)}, 0.5)`);
  });
}

test("ordinary hex colors retain their opaque defaults", () => {
  assert.deepEqual(parseColor("#abc"), { hex: "#aabbcc", alpha: 1 });
  assert.deepEqual(parseColor("#123456"), { hex: "#123456", alpha: 1 });
  assert.deepEqual(parseColor("rgba(12, 34, 56, 0.5)"), { hex: "#0c2238", alpha: 0.5 });
});

test("non-hex CSS colors use the browser's canonical color before an opacity edit", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "document");
  const colors = new Map([
    ["red", "#ff0000"], ["transparent", "rgba(0, 0, 0, 0)"],
    ["hsl(120 100% 50% / 0.5)", "rgba(0, 255, 0, 0.5)"],
    ["rgb(100% 0% 0% / 50%)", "rgba(255, 0, 0, 0.5)"],
  ]);
  Object.defineProperty(globalThis, "document", { configurable: true, value: {
    createElement(tag: string) {
      assert.equal(tag, "canvas");
      return { getContext: () => {
        let color = "#000000";
        return { set fillStyle(value: string) { color = colors.get(value) ?? value; }, get fillStyle() { return color; } };
      } };
    },
  } });
  try {
    assert.deepEqual(parseColor("red"), { hex: "#ff0000", alpha: 1 });
    assert.deepEqual(parseColor("transparent"), { hex: "#000000", alpha: 0 });
    assert.deepEqual(parseColor("hsl(120 100% 50% / 0.5)"), { hex: "#00ff00", alpha: 0.5 });
    const color = parseColor("rgb(100% 0% 0% / 50%)");
    assert.equal(composeColor(color.hex, 0.25), "rgba(255, 0, 0, 0.25)");
  } finally {
    if (original) Object.defineProperty(globalThis, "document", original);
    else Reflect.deleteProperty(globalThis, "document");
  }
});
