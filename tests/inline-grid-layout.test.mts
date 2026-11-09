import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { transformSync } from "esbuild";
import { shorthandSide } from "../components/controls";
import { cssValueParts } from "../lib/css-value-parts";
import { getProp } from "../lib/style";
import { makeBox } from "../lib/presets";
function render(section: "BoxSec" | "LayoutSec", styles: Record<string, string>) {
  const writes: any[] = [];
  const node = { ...makeBox(), styles: { base: { default: styles } } };
  const path = resolve(`components/style-panel/${section}.tsx`);
  const require = createRequire(path);
  const mod = { exports: {} as any };
  const code = transformSync(readFileSync(path, "utf8"), { loader: "tsx", format: "cjs", jsx: "automatic" }).code;
  new Function("require", "module", "exports", code)((id: string) => {
    if (id === "react") return { ...require(id), useState: (v: any) => [v, () => {}] };
    if (id === "../../lib/store") return { useEditor: (select: any) => select({ breakpoint: "base" }) };
    if (id === "../controls") return {
      useInspector: () => ({ get: (p: string) => getProp(node, "base", "default", p), cleared: () => null, set: (v: any) => writes.push(v) }),
      shorthandSide, Grp: "Grp", NumField: "NumField", Seg: "Seg", PropNum: "PropNum", PropSeg: "PropSeg", PropSelect: "PropSelect",
    };
    if (id === "./PositionSec") return { ...require(id), useParentFlexDir: () => null, useHiddenState: () => "" };
    if (id === "./shared") return { Sec: "Sec", I: 12 };
    return require(id);
  }, mod, mod.exports);
  const flatten = (value: any): any[] => Array.isArray(value) ? value.flatMap(flatten) : value && typeof value === "object" ? [value, ...flatten(value.props?.children)] : [];
  const elements = flatten(section === "BoxSec" ? mod.exports.SpacingSec() : mod.exports.LayoutSec());
  const target = elements.find(e => typeof e.type === "function" && (section === "BoxSec" ? e.props.shorthand === "padding" : e.type.name === "GridGap"));
  return { elements, gap: target, writes };
}

test("inline-grid exposes the same grid controls as grid without changing display", () => {
  const view = render("LayoutSec", { display: "inline-grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "10px" });
  assert.ok(view.gap, "grid gap controls must be available");
  const flow = view.elements.find(e => e.type === "Seg");
  assert.equal(flow.props.value, "grid");
  assert.deepEqual(view.writes, []);
  const columns = view.elements.find(e => e.type === "NumField" && e.props.value === "3");
  assert.ok(columns);
  columns.props.onChange("4");
  assert.equal(view.writes.at(-1).gridTemplateColumns, "repeat(4, 1fr)");
  assert.equal(Object.hasOwn(view.writes.at(-1), "display"), false);
});
import { flowMode } from "../components/style-panel/PositionSec";
test("flow mode recognizes inline-grid as grid", () => {
  assert.equal(flowMode("inline-grid", undefined), "grid");
});
