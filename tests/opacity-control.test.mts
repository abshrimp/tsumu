import { getProp, clearedValue, resolveStyles } from "../lib/style";
import { makeBox, makeSwitch } from "../lib/presets";
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { transformSync } from "esbuild";
import * as React from "react";
import { parseGradient } from "../components/style-panel/BackgroundSec";
import { parseShadow, serializeShadow } from "../components/style-panel/EffectsSec";

const boxSecPath = resolve("components/style-panel/BoxSec.tsx");
const boxSecRequire = createRequire(boxSecPath);
const boxSecCode = transformSync(readFileSync(boxSecPath, "utf8"), { loader: "tsx", format: "cjs", jsx: "automatic" }).code;

function renderAppearance(node: any, bp = "base", state = "default") {
  const writes: any[] = [];
  const doc = { nodes: { [node.id]: node }, pages: {}, pageOrder: [] };
  const mod = { exports: {} as any };
  new Function("require", "module", "exports", boxSecCode)((id: string) => {
    if (id === "react") return { ...boxSecRequire(id), useState: (v: any) => [v, () => {}] };
    if (id === "../../lib/store") return { useEditor: (select: any) => select({ doc, breakpoint: bp, styleState: state }), findParentOf: () => null, ancestorsOf: () => [] };
    if (id === "../controls") return {
      useInspector: () => ({ get: (p: string) => getProp(node, bp as any, state as any, p), cleared: (p: string) => clearedValue(node, bp as any, state as any, p),
        set: (v: any) => writes.push(v) }),
      Dropdown: "Dropdown", FillControl: "FillControl", Grp: "Grp", InfoTip: "InfoTip", NumField: "NumField", PropSelect: "PropSelect", PropNum: "PropNum", PropSeg: "PropSeg", PropFill: "PropFill", Seg: "Seg",
    };
    if (id === "./PositionSec") return { useHiddenState: () => "" };
    if (id === "./shared") return { Sec: "Sec", I: 12 };
    return boxSecRequire(id);
  }, mod, mod.exports);
  const flatten = (value: any): any[] => Array.isArray(value) ? value.flatMap(flatten) : value && typeof value === "object" ? [value, ...flatten(value.props?.children)] : [];
  return { fields: flatten(mod.exports.AppearanceSec()), writes };
}

for (const value of ["50%", ".5", "0.5"]) test(`opacity display uses CSS numeric semantics: ${value}`, () => {
  const node = { ...makeBox(), styles: { base: { default: { opacity: value } } } };
  const view = renderAppearance(node);
  assert.equal(view.fields.find(e => e.type === "NumField" && e.props.max === 100).props.value, "50%");
});
test("hover can explicitly become fully opaque despite a translucent default", () => {
  const node = { ...makeBox(), styles: { base: { default: { opacity: ".5" } } } };
  const view = renderAppearance(node, "base", "hover");
  view.fields.find(e => e.type === "NumField" && e.props.max === 100).props.onChange("100%");
  const patch = Object.fromEntries(Object.entries(view.writes.at(-1)).filter(([, v]) => v !== null));
  const next = { ...node, styles: { base: { ...node.styles.base, hover: patch } } };
  assert.equal(resolveStyles(next as any, "base", "hover").opacity, "1");
});
for (const [value, expected] of [["12.5%", "12.5%"], ["1.25e-1", "12.5%"], ["150%", "100%"], ["-0.1", "0%"]]) test(`opacity ${value} displays ${expected}`, () => {
  const node = { ...makeBox(), styles: { base: { default: { opacity: value } } } };
  assert.equal(renderAppearance(node).fields.find(e => e.type === "NumField" && e.props.max === 100).props.value, expected);
});
test("fully opaque base value remains removable without forcing an unnecessary override", () => {
  const node = { ...makeBox(), styles: { base: { default: { opacity: ".5" } } } };
  const view = renderAppearance(node);
  view.fields.find(e => e.type === "NumField" && e.props.max === 100).props.onChange("100%");
  assert.deepEqual(view.writes.at(-1), { opacity: null });
});
test("smaller breakpoint can explicitly become fully opaque", () => {
  const node = { ...makeBox(), styles: { base: { default: { opacity: "50%" } } } };
  const view = renderAppearance(node, "sm");
  view.fields.find(e => e.type === "NumField" && e.props.max === 100).props.onChange("100%");
  assert.deepEqual(view.writes.at(-1), { opacity: "1" });
});

for (const angle of [-45, 22.5, -0.5, 0, 180, 360]) {
  test(`gradient controls retain ${angle} degree angles and both colors`, () => {
    const c1 = "rgba(12, 34, 56, 0.5)", c2 = "#123456";
    const value = `linear-gradient(${angle}deg, ${c1} 0%, ${c2} 100%)`;
    const parsed = parseGradient(value);
    assert.deepEqual(parsed, { angle, c1, c2 });
    assert.deepEqual(parseGradient(`linear-gradient(${parsed.angle}deg, #abcdef 0%, ${parsed.c2} 100%)`),
      { angle, c1: "#abcdef", c2 });
  });
}
test("gradient controls preserve defaults for unset or unsupported backgrounds", () => {
  for (const value of [undefined, "none", 'url("photo.png")']) {
    assert.deepEqual(parseGradient(value), { angle: 180, c1: "#ffffff", c2: "#e4e4e7" });
  }
});

test("the built-in switch shadow survives an opacity/color-only edit", () => {
  const preset = makeSwitch();
  const shadows = Object.values(preset.nodes).map(n => n.styles.base?.default?.boxShadow).filter(Boolean) as string[];
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

{
  let values: Record<string, string> = {}, zWrites: Record<string, string | null>[] = [];
  const posRequire = createRequire(resolve("components/style-panel/PositionSec.tsx"));
  const posMod = { exports: {} as any };
  const posSource = transformSync(readFileSync("components/style-panel/PositionSec.tsx", "utf8") + "\nexport { ZIndexControl };", { loader: "tsx", jsx: "automatic", format: "cjs" }).code;
  new Function("require", "module", "exports", posSource)((id: string) => {
    if (id === "../controls") return { ...posRequire(id), useInspector: () => ({ get: (prop: string) => ({ value: values[prop] }), set: (props: any) => zWrites.push(props) }) };
    return posRequire(id);
  }, posMod, posMod.exports);
  for (const position of [undefined, "static", "relative", "absolute", "fixed", "sticky"]) {
    test(`front/back controls respect ${position ?? "unset"} positioning`, () => {
      values = position ? { position, zIndex: "3" } : { zIndex: "3" }; zWrites = [];
      const tree = posMod.exports.ZIndexControl();
      const buttons = React.Children.toArray(tree.props.children).filter((el: any) => el.type === "button") as any[];
      buttons[0].props.onClick(); buttons[1].props.onClick();
      const patch = position === undefined || position === "static" ? { position: "relative" } : {};
      assert.deepEqual(zWrites, [{ zIndex: "2", ...patch }, { zIndex: "4", ...patch }]);
    });
  }
}
