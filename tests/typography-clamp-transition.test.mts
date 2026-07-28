import { getProp, clearedValue, resolveStyles } from "../lib/style";
import { makeText } from "../lib/presets";
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { transformSync } from "esbuild";
function renderTypography(node: any, bp = "sm", state = "default") {
  const writes: any[] = [];
  const doc = { nodes: { [node.id]: node }, pages: {}, pageOrder: [] };
  const path = resolve("components/style-panel/TypographySec.tsx");
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
    if (id === "./shared") return { Sec: "Sec", I: 12 };
    return require(id);
  }, mod, mod.exports);
  const flatten = (value: any): any[] => Array.isArray(value) ? value.flatMap(flatten) : value && typeof value === "object" ? [value, ...flatten(value.props?.children)] : [];
  return { fields: flatten(mod.exports.TypographySec({ node })), writes };
}


const baseClamp = { WebkitLineClamp: "2", WebkitBoxOrient: "vertical", display: "-webkit-box", overflow: "hidden" };
for (const mode of ["wrap", "nowrap"]) test(`inherited line clamp can switch to ${mode}`, () => {
  const node = { ...makeText(), styles: { base: { default: baseClamp } } };
  const view = renderTypography(node);
  view.fields.find(e => e.type === "Seg" && e.props.value === "clamp").props.onChange(mode);
  const patch = view.writes.at(-1);
  const actual = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== null));
  const next = { ...node, styles: { ...node.styles, sm: { default: actual } } };
  const resolved = resolveStyles(next as any, "sm", "default");
  assert.equal(resolved.WebkitLineClamp, "none");
  assert.notEqual(resolved.display, "-webkit-box");
  assert.notEqual(resolved.overflow, "hidden");
  assert.equal(renderTypography(next).fields.find(e => e.type === "Seg" && e.props.options.some((o: any) => o.value === "clamp")).props.value, mode);
});
test("base clamp to nowrap removes the layout and overflow added by clamping", () => {
  const node = { ...makeText(), styles: { base: { default: baseClamp } } };
  const view = renderTypography(node, "base");
  view.fields.find(e => e.type === "Seg" && e.props.value === "clamp").props.onChange("nowrap");
  assert.equal(view.writes.at(-1).display, null);
  assert.equal(view.writes.at(-1).overflow, null);
});
test("ordinary wrapping changes do not erase unrelated layout and overflow", () => {
  const node = { ...makeText(), styles: { base: { default: { display: "grid", overflow: "auto" } } } };
  for (const mode of ["wrap", "nowrap"]) {
    const view = renderTypography(node, "base");
    view.fields.find(e => e.type === "Seg" && e.props.options.some((o: any) => o.value === "clamp")).props.onChange(mode);
    assert.equal(Object.hasOwn(view.writes.at(-1), "display"), false);
    assert.equal(Object.hasOwn(view.writes.at(-1), "overflow"), false);
  }
});
test("an explicit none clamp is shown as normal wrapping without the line count field", () => {
  const node = { ...makeText(), styles: { base: { default: { WebkitLineClamp: "none" } } } };
  const view = renderTypography(node, "base");
  assert.equal(view.fields.find(e => e.type === "Seg" && e.props.options.some((o: any) => o.value === "clamp")).props.value, "wrap");
  assert.equal(view.fields.some(e => e.props?.prop === "WebkitLineClamp"), false);
});

for (const mode of ["wrap", "nowrap"]) test(`hover can explicitly turn default clamping into ${mode}`, () => {
  const node = { ...makeText(), styles: { base: { default: baseClamp } } };
  const view = renderTypography(node, "base", "hover");
  view.fields.find(e => e.type === "Seg" && e.props.value === "clamp").props.onChange(mode);
  assert.equal(view.writes.at(-1).WebkitLineClamp, "none");
  assert.equal(view.writes.at(-1).overflow, "visible");
});
for (const [prop, value, tip, expected] of [["fontStyle", "italic", "斜体", "normal"], ["textDecoration", "underline", "下線", "none"], ["textDecoration", "line-through", "打ち消し線", "none"]]) test(`hover can toggle off default ${value}`, () => {
  const node = { ...makeText(), styles: { base: { default: { [prop]: value } } } };
  const view = renderTypography(node, "base", "hover");
  view.fields.find(e => e.type === "button" && e.props["data-tip"] === tip).props.onClick();
  assert.equal(view.writes.at(-1)[prop], expected);
});
test("hover wrap explicitly overrides default nowrap", () => {
  const node = { ...makeText(), styles: { base: { default: { whiteSpace: "nowrap" } } } };
  const view = renderTypography(node, "base", "hover");
  view.fields.find(e => e.type === "Seg" && e.props.value === "nowrap").props.onChange("wrap");
  assert.equal(view.writes.at(-1).whiteSpace, "pre-wrap");
});
