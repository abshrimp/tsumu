import assert from "node:assert/strict";
import { test } from "node:test";
import { parseGradient } from "../components/style-panel/BackgroundSec";

for (const angle of [-45, 22.5, -0.5, 0, 180, 360]) {
  test(`gradient controls retain ${angle} degree angles and both colors`, () => {
    const c1 = "rgba(12, 34, 56, 0.5)", c2 = "#123456";
    // 角度の NumField と、2つの色の操作部品が書き込む値。
    const value = `linear-gradient(${angle}deg, ${c1} 0%, ${c2} 100%)`;
    const parsed = parseGradient(value);
    assert.deepEqual(parsed, { angle, c1, c2 });
    // 続けて色を編集しても、角度や反対側の色の位置がリセットされてはならない。
    assert.deepEqual(parseGradient(`linear-gradient(${parsed.angle}deg, #abcdef 0%, ${parsed.c2} 100%)`),
      { angle, c1: "#abcdef", c2 });
  });
}

test("gradient controls preserve defaults for unset or unsupported backgrounds", () => {
  for (const value of [undefined, "none", 'url("photo.png")']) {
    assert.deepEqual(parseGradient(value), { angle: 180, c1: "#ffffff", c2: "#e4e4e7" });
  }
});
