import { getProp, clearedValue, resolveStyles } from "../lib/style";
import { makeBox } from "../lib/presets";
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { transformSync } from "esbuild";
function renderAppearance(node: any, bp = "base", state = "default") {
  const writes: any[] = [];
  const doc = { nodes: { [node.id]: node }, pages: {}, pageOrder: [] };
  const path = resolve("components/style-panel/BoxSec.tsx");
  const require = createRequire(path);
  const mod = { exports: {} as any };
  const code = transformSync(readFileSync(path, "utf8"), { loader: "tsx", format: "cjs", jsx: "automatic" }).code;
  new Function("require", "module", "exports", code)((id: string) => {
    if (id === "react") return { ...require(id), useState: (v: any) => [v, () => {}] };
    if (id === "../../lib/store") return { useEditor: (select: any) => select({ doc, breakpoint: bp, styleState: state }), findParentOf: () => null, ancestorsOf: () => [] };
    if (id === "../controls") return {
      useInspector: () => ({ get: (p: string) => getProp(node, bp as any, state as any, p), cleared: (p: string) => clearedValue(node, bp as any, state as any, p),
        set: (v: any) => writes.push(v) }),
      Dropdown: "Dropdown", FillControl: "FillControl", Grp: "Grp", InfoTip: "InfoTip", NumField: "NumField", PropSelect: "PropSelect", PropNum: "PropNum", PropSeg: "PropSeg", PropFill: "PropFill", Seg: "Seg",
    };
    if (id === "./PositionSec") return { useHiddenState: () => "" };
    if (id === "./shared") return { Sec: "Sec", I: 12 };
    return require(id);
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
  const patch = Object.fromEntries(Object.entries(view.writes.at(-1)).filter(([,v]) => v !== null));
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
