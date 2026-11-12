import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { transformSync } from "esbuild";
import { getProp, clearedValue, resolveStyles } from "../lib/style";
import { makeBox } from "../lib/presets";

function render(file: string, name: string, base: Record<string, string>, props = {}, bp = "base", state = "hover") {
  const node = { ...makeBox(), styles: { base: { default: base } } };
  const writes: any[] = [], path = resolve(`components/style-panel/${file}.tsx`), require = createRequire(path);
  const mod = { exports: {} as any }, doc = { nodes: { [node.id]: node }, assets: {}, pages: {}, pageOrder: [] };
  const code = transformSync(readFileSync(path, "utf8"), { loader: "tsx", format: "cjs", jsx: "automatic" }).code;
  new Function("require", "module", "exports", code)((id: string) => {
    if (id === "react") return { ...require(id), useState: (v: any) => [v, () => {}] };
    if (id === "../../lib/store") return { useEditor: (select: any) => select({ doc, breakpoint: bp, styleState: state }) };
    if (id === "../controls") return new Proxy({
      useInspector: () => ({ get: (p: string) => getProp(node, bp, state as any, p), cleared: (p: string) => clearedValue(node, bp, state as any, p), set: (v: any) => writes.push(v) }),
      unitConverter: () => undefined,
    } as any, { get: (o, k) => k in o ? o[k] : k });
    if (id === "./shared") return { Sec: "Sec", I: 12 };
    return require(id);
  }, mod, mod.exports);
  const flatten = (v: any): any[] => Array.isArray(v) ? v.flatMap(flatten) : v && typeof v === "object" ? [v, ...flatten(v.props?.children)] : [];
  const result = () => {
    const patch = Object.fromEntries(Object.entries(writes.at(-1)).filter(([,v]) => v !== null));
    const next = structuredClone(node) as any;
    next.styles[bp] ??= {}; next.styles[bp][state] = patch;
    return resolveStyles(next, bp, state as any);
  };
  return { elements: flatten(mod.exports[name](props)), writes, result };
}
test("hover can choose automatic positioning over absolute positioning", () => {
  const view = render("PositionSec", "PositionSec", { position: "absolute", left: "30px", top: "20px" });
  view.elements.find(e => e.type === "Seg" && e.props.value === "custom").props.onChange("auto");
  assert.equal(view.result().position, "static"); assert.equal(view.result().left, "auto");
});
test("hover fixed size overrides inherited fill instead of keeping flex-grow", () => {
  const view = render("PositionSec", "MainSizeField", { flexGrow: "1", flexBasis: "0%", minWidth: "0" }, { prop: "width", pre: "W", axis: "main" });
  view.elements.find(e => e.type === "NumField").props.onChange("100px");
  assert.equal(view.result().flexGrow, "0"); assert.equal(view.result().flexBasis, "auto"); assert.equal(view.result().width, "100px");
});
for (const mode of ["none", "color"]) test(`hover background can switch from image to ${mode}`, () => {
  const view = render("BackgroundSec", "BackgroundSec", { backgroundImage: 'url("photo.png")', backgroundColor: "red" });
  view.elements.find(e => e.type === "Seg").props.onChange(mode);
  assert.equal(view.result().backgroundImage, "none");
  if (mode === "none") assert.equal(view.result().backgroundColor, "transparent");
});
for (const [bp, state] of [["sm", "default"], ["base", "focus"]]) test(`${bp}/${state} mode switches override inherited background and placement`, () => {
  const bg = render("BackgroundSec", "BackgroundSec", { backgroundImage: 'url("photo.png")', backgroundColor: "red" }, {}, bp, state);
  bg.elements.find(e => e.type === "Seg").props.onChange("none");
  assert.equal(bg.result().backgroundImage, "none"); assert.equal(bg.result().backgroundColor, "transparent");
  const pos = render("PositionSec", "PositionSec", { position: "absolute", top: "20px" }, {}, bp, state);
  pos.elements.find(e => e.type === "Seg" && e.props.value === "custom").props.onChange("auto");
  assert.equal(pos.result().position, "static");
});
test("hover fill toggle explicitly disables inherited flex-grow", () => {
  const view = render("PositionSec", "MainSizeField", { flexGrow: "1", flexBasis: "0%" }, { prop: "width", pre: "W", axis: "main" });
  view.elements.find(e => e.type === "button" && e.props["aria-label"] === "Fill remaining space").props.onClick();
  assert.equal(view.result().flexGrow, "0"); assert.equal(view.result().flexBasis, "auto");
});
test("base background mode deletion and context reset still remove local overrides", () => {
  const view = render("BackgroundSec", "BackgroundSec", { backgroundImage: 'url("photo.png")' }, {}, "base", "default");
  view.elements.find(e => e.type === "Seg").props.onChange("none");
  assert.equal(view.writes.at(-1).backgroundImage, null);
  const hover = render("BackgroundSec", "BackgroundSec", { backgroundImage: 'url("photo.png")' });
  hover.elements.find(e => e.type === "Grp" && e.props.onReset).props.onReset();
  assert.equal(hover.writes.at(-1).backgroundImage, null);
});
for (const mode of ["auto", "custom", "sticky"]) test(`position ${mode} unhides inherited display:none without imposing a display type`, () => {
  const view = render("PositionSec", "PositionSec", { display: "none" });
  view.elements.find(e => e.type === "Seg" && e.props.options.some((o: any) => o.value === "sticky")).props.onChange(mode);
  assert.equal(view.result().display, "revert");
});
test("clearing the hover image picker removes the image; group reset restores inheritance", () => {
  const view = render("BackgroundSec", "BackgroundSec", { backgroundImage: 'url("photo.png")' });
  view.elements.find(e => typeof e.type === "function" && e.type.name === "ImagePicker").props.onChange(null);
  assert.equal(view.writes.at(-1).backgroundImage, "none");
  view.elements.find(e => e.type === "Grp" && e.props.onReset).props.onReset();
  assert.equal(view.writes.at(-1).backgroundImage, null);
});

for (const [choice, expectedHeight, expectedMin] of [
  ["auto", "auto", undefined],
  ["fixed", "300px", undefined],
  ["parent", "100%", undefined],
  ["screen", "auto", "100dvh"],
] as const) {
  test(`height preset ${choice} emits standard CSS properties`, () => {
    const view = render("PositionSec", "HeightModeControl", {}, { axis: "cross" }, "base", "default");
    view.elements.find(e => e.type === "select").props.onChange({ target: { value: choice } });
    const patch = view.writes.at(-1);
    assert.equal(patch.height, choice === "auto" || choice === "screen" ? null : expectedHeight);
    if (expectedMin) assert.equal(patch.minHeight, expectedMin);
  });
}
test("height presets recognize manual values without overwriting them", () => {
  const view = render("PositionSec", "HeightModeControl", { height: "64rem" }, { axis: "cross" }, "base", "default");
  assert.equal(view.elements.find(e => e.type === "select").props.value, "custom");
  assert.equal(view.writes.length, 0);
});
test("fill remaining height is offered only in a vertical flex parent", () => {
  const view = render("PositionSec", "HeightModeControl", {}, { axis: "main" }, "base", "default");
  const selector = view.elements.find(e => e.type === "select");
  assert.ok(view.elements.some(e => e.type === "option" && e.props.value === "fill"));
  selector.props.onChange({ target: { value: "fill" } });
  assert.equal(view.writes.at(-1).flexGrow, "1");
  assert.equal(view.writes.at(-1).flexBasis, "0%");
  assert.equal(view.writes.at(-1).minHeight, "0");
});
test("switching away from screen height clears its minimum", () => {
  const view = render("PositionSec", "HeightModeControl", { minHeight: "100dvh" }, { axis: "cross" }, "base", "hover");
  view.elements.find(e => e.type === "select").props.onChange({ target: { value: "parent" } });
  assert.equal(view.writes.at(-1).minHeight, "auto");
});
