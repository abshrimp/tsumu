import { getProp, clearedValue, resolveStyles } from "../lib/style";
import { makeBox } from "../lib/presets";
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { transformSync } from "esbuild";
function renderEffects(node: any, bp = "base", state = "default") {
  const writes: any[] = [];
  const doc = { nodes: { [node.id]: node }, pages: {}, pageOrder: [] };
  const path = resolve("components/style-panel/EffectsSec.tsx");
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
  return { fields: flatten(mod.exports.EffectsSec()), writes };
}




for (const prop of ["filter", "backdropFilter"]) test(`hover can remove the default ${prop} blur`, () => {
  const node = { ...makeBox(), styles: { base: { default: { [prop]: "blur(8px)" } } } };
  const view = renderEffects(node, "base", "hover");
  view.fields.find(e => e.type === "NumField" && e.props.value === "8px").props.onChange("0px");
  assert.deepEqual(view.writes.at(-1), { [prop]: "none" });
});
for (const prop of ["boxShadow", "textShadow"]) test(`hover can delete the default ${prop}`, () => {
  const node = { ...makeBox(), styles: { base: { default: { [prop]: "1px 2px 3px red" } } } };
  const view = renderEffects(node, "base", "hover");
  const card = view.fields.find(e => typeof e.type === "function" && e.props.shadow);
  card.props.onDelete();
  assert.deepEqual(view.writes.at(-1), { [prop]: "none" });
});
test("hover can remove the default transform without resetting to it", () => {
  const node = { ...makeBox(), styles: { base: { default: { transform: "rotate(20deg)" } } } };
  const view = renderEffects(node, "base", "hover");
  view.fields.find(e => typeof e.type === "function" && e.type.name === "TransformCard").props.onDelete();
  assert.equal(view.writes.at(-1).transform, "none");
});
for (const prop of ["filter", "backdropFilter"]) test(`smaller breakpoint can disable inherited ${prop}`, () => {
  const node = { ...makeBox(), styles: { base: { default: { [prop]: "blur(8px)" } } } };
  const view = renderEffects(node, "sm");
  view.fields.find(e => e.type === "NumField" && e.props.value === "8px").props.onChange("0px");
  assert.deepEqual(view.writes.at(-1), { [prop]: "none" });
});
test("turning off one inherited effect preserves other filter functions", () => {
  const node = { ...makeBox(), styles: { base: { default: { filter: "contrast(150%) blur(8px) opacity(.5)" } } } };
  const view = renderEffects(node, "base", "hover");
  view.fields.find(e => e.type === "NumField" && e.props.value === "8px").props.onChange("0px");
  assert.deepEqual(view.writes.at(-1), { filter: "contrast(150%) opacity(.5)" });
});
test("base effect removal still deletes the property instead of forcing none", () => {
  const node = { ...makeBox(), styles: { base: { default: { filter: "blur(8px)" } } } };
  const view = renderEffects(node);
  view.fields.find(e => e.type === "NumField" && e.props.value === "8px").props.onChange("0px");
  assert.deepEqual(view.writes.at(-1), { filter: null });
});
test("right-click reset retains inheritance semantics", () => {
  const node = { ...makeBox(), styles: { base: { default: { backdropFilter: "blur(8px)" }, hover: { backdropFilter: "none" } } } };
  const view = renderEffects(node, "base", "hover");
  view.fields.find(e => e.type === "Grp" && e.props.label === "背景ぼかし").props.onReset();
  assert.deepEqual(view.writes.at(-1), { backdropFilter: null });
});
