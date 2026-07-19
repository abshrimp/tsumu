import assert from "node:assert/strict";
import { test } from "node:test";
import { parseShadow, serializeShadow } from "../components/style-panel/EffectsSec";
import { makeSwitch } from "../lib/presets";

test("the built-in switch shadow survives an opacity/color-only edit", () => {
  const preset = makeSwitch();
  const nodes = Object.values(preset.nodes);
  const shadows = nodes.map(n => n.styles.base?.default?.boxShadow).filter(Boolean) as string[];
  assert.equal(shadows.length, 2);
  for (const value of shadows) {
    const parsed = parseShadow(value);
    assert.deepEqual(parsed, { inset: false, x: 0, y: 1, blur: 2, spread: 0, color: "rgba(0, 0, 0, 0.25)" });
    assert.equal(serializeShadow({ ...parsed, color: "#123456" }), "0px 1px 2px 0px #123456");
  }
});
for (const value of ["0 0 red", "red 0px 0", "inset 0 0 0 0 red"]) test(`zero lengths and omitted blur are preserved: ${value}`, () => {
  assert.deepEqual(parseShadow(value), { inset: value.startsWith("inset"), x: 0, y: 0, blur: 0, spread: 0, color: "red" });
});
test("functional color channels are not mistaken for lengths", () => {
  assert.deepEqual(parseShadow("-1px 2px 3px 4px rgb(0 20 30 / 0.5) inset"), {
    inset: true, x: -1, y: 2, blur: 3, spread: 4, color: "rgb(0 20 30 / 0.5)",
  });
});
test("omitted shadow color uses CSS currentColor, without inventing opacity", () => {
  assert.deepEqual(parseShadow("0 1px"), { inset: false, x: 0, y: 1, blur: 0, spread: 0, color: "currentColor" });
});
test("nested color functions remain a single token", () => {
  assert.equal(parseShadow("0 0 2px var(--shadow, rgb(0 0 0))").color, "var(--shadow, rgb(0 0 0))");
});
