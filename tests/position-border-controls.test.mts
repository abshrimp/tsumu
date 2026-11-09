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
    if (id === "../../lib/assets") return { assetSrc: () => "" };
    if (id === "../ImagePicker") return { __esModule: true, default: "ImagePicker" };
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

test("switching anchor from an automatic inset selects the requested edge", () => {
  const view = render("PositionSec", "PositionSec", { position: "absolute", left: "auto", right: "auto" }, {}, "base", "default");
  view.elements.find(e => e.type === "Seg" && e.props.value === "left").props.onChange("right");
  assert.equal(view.writes.at(-1).right, "0px");
});
test("setting hover rotation to zero disables the normal rotation", () => {
  const view = render("PositionSec", "PositionSec", { transform: "rotate(20deg)" });
  view.elements.find(e => e.type === "NumField" && e.props.units?.[0] === "deg").props.onChange("0deg");
  assert.equal(view.result().transform, "none");
});
test("setting border width turns an explicitly absent border into a visible line", () => {
  const view = render("BackgroundSec", "BorderSec", { borderStyle: "none", borderWidth: "0px" }, {}, "base", "default");
  view.elements.find(e => e.type === "NumField").props.onChange("2px");
  assert.equal(view.writes.at(-1).borderStyle, "solid");
});
test("resetting rotation preserves other transform components", () => {
  const view = render("PositionSec", "PositionSec", { transform: "rotate(20deg) scale(2)" });
  view.elements.find(e => e.type === "NumField" && e.props.units?.[0] === "deg").props.onChange("0deg");
  assert.equal(view.result().transform, "scale(2)");
});
test("anchor switching preserves a numeric offset", () => {
  const view = render("PositionSec", "PositionSec", { position: "absolute", left: "30%" });
  view.elements.find(e => e.type === "Seg" && e.props.value === "left").props.onChange("right");
  assert.equal(view.writes.at(-1).right, "30%");
  assert.equal(view.writes.at(-1).left, "auto");
});
test("width edits retain existing decorative border style", () => {
  const view = render("BackgroundSec", "BorderSec", { borderStyle: "dashed", borderColor: "red" }, {}, "base", "default");
  view.elements.find(e => e.type === "NumField").props.onChange("2px");
  assert.deepEqual(view.writes.at(-1), { borderWidth: "2px", borderStyle: "dashed", borderColor: "red" });
});
test("clearing the hover rotation field keeps its existing reset-to-inherited semantics", () => {
  const view = render("PositionSec", "PositionSec", { transform: "rotate(20deg)" });
  view.elements.find(e => e.type === "NumField" && e.props.units?.[0] === "deg").props.onChange(null);
  assert.equal(view.writes.at(-1).transform, null);
  assert.equal(view.result().transform, "rotate(20deg)");
});
