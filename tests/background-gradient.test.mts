import assert from "node:assert/strict";
import { test } from "node:test";
import { parseGradient } from "../components/style-panel/BackgroundSec";

for (const angle of [-45, 22.5, -0.5, 0, 180, 360]) {
  test(`gradient controls retain ${angle} degree angles and both colors`, () => {
    const c1 = "rgba(12, 34, 56, 0.5)", c2 = "#123456";
    // This is the value written by the angle NumField and both color controls.
    const value = `linear-gradient(${angle}deg, ${c1} 0%, ${c2} 100%)`;
    const parsed = parseGradient(value);
    assert.deepEqual(parsed, { angle, c1, c2 });
    // A subsequent color edit must not reset the angle or the opposite stop.
    assert.deepEqual(parseGradient(`linear-gradient(${parsed.angle}deg, #abcdef 0%, ${parsed.c2} 100%)`),
      { angle, c1: "#abcdef", c2 });
  });
}

test("gradient controls preserve defaults for unset or unsupported backgrounds", () => {
  for (const value of [undefined, "none", 'url("photo.png")']) {
    assert.deepEqual(parseGradient(value), { angle: 180, c1: "#ffffff", c2: "#e4e4e7" });
  }
});
