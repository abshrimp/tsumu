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
  return { fields: flatten(target.type(target.props)), writes };
}
test("changing horizontal padding keeps existing top/bottom longhand overrides", () => {
  const view = render("BoxSec", { padding: "10px", paddingTop: "25px", paddingBottom: "30px" });
  view.fields.find(e => e.type === "NumField" && e.props.title === "Left & right").props.onChange("5px");
  assert.deepEqual(view.writes.at(-1), { padding: null, paddingTop: "25px", paddingRight: "5px", paddingBottom: "30px", paddingLeft: "5px" });
});
test("padding shorthand math survives editing another axis", () => {
  const view = render("BoxSec", { padding: "calc(1rem + 2px) 4px" });
  view.fields.find(e => e.type === "NumField" && e.props.title === "Left & right").props.onChange("5px");
  assert.equal(view.writes.at(-1).paddingTop, "calc(1rem + 2px)");
  assert.equal(view.writes.at(-1).paddingBottom, "calc(1rem + 2px)");
});
test("grid gap math is displayed and preserved when editing the other axis", () => {
  const view = render("LayoutSec", { display: "grid", gap: "calc(1rem + 2px) min(3vw, 20px)" });
  const fields = view.fields.filter(e => e.type === "NumField");
  assert.deepEqual(fields.map(e => e.props.value), ["min(3vw, 20px)", "calc(1rem + 2px)"]);
  fields[0].props.onChange("5px");
  assert.equal(view.writes.at(-1).rowGap, "calc(1rem + 2px)");
  assert.equal(view.writes.at(-1).columnGap, "5px");
});
test("shorthand splitter keeps nested, quoted, and commented function tokens intact", () => {
  assert.deepEqual(cssValueParts('calc(1px + var(--x, 2px)) /* gap */ "a b"'), ['calc(1px + var(--x, 2px))', '"a b"']);
  assert.equal(shorthandSide("calc(2px + 1vw) 3px 4px", 3), "3px");
});
