import assert from "node:assert/strict";
import { test } from "node:test";
import { parseShadow, serializeShadow } from "../components/style-panel/EffectsSec";

for (const [source, expected] of [
  ["inset .25em -1rem 2vh 0.5vw red", "inset .25em -1rem 2vh 0.5vw blue"],
  ["red 1cm 2mm 3pt 4pc", "1cm 2mm 3pt 4pc blue"],
  ["1dvh 2svw 3cqw 4lh rgb(0 0 0 / .5)", "1dvh 2svw 3cqw 4lh blue"],
  ["calc(1em + 2px) min(1vh, 3px) 2rem black", "calc(1em + 2px) min(1vh, 3px) 2rem 0px blue"],
  ["1e2px 2rem", "1e2px 2rem 0px 0px blue"],
  ["1e-2em 2rem", "1e-2em 2rem 0px 0px blue"],
]) test(`color edit preserves CSS shadow length units: ${source}`, () => {
  const parsed = parseShadow(source);
  assert.equal(serializeShadow({ ...parsed, color: "blue" }), expected);
});

test("editing one shadow dimension preserves the other dimensions", () => {
  const parsed = parseShadow(".5em 1rem 2vh 3vw #123");
  assert.equal(serializeShadow({ ...parsed, x: 4 }), "4px 1rem 2vh 3vw #123");
});

// Exercise the actual cards: parser-only coverage would miss a px suffix added
// by the input field or text-shadow's separate serializer.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { transformSync } from "esbuild";
function renderShadow(prop: "boxShadow" | "textShadow") {
  const writes: any[] = [];
  const path = resolve("components/style-panel/EffectsSec.tsx");
  const require = createRequire(path);
  const mod = { exports: {} as any };
  const code = transformSync(readFileSync(path, "utf8"), { loader: "tsx", format: "cjs", jsx: "automatic" }).code;
  new Function("require", "module", "exports", code)((id: string) => {
    if (id === "react") return { ...require(id), useState: (v: any) => [v, () => {}] };
    if (id === "../controls") return {
      useInspector: () => ({ get: (p: string) => ({ value: p === prop ? ".5em 1rem 2vh red" : undefined }), cleared: () => null,
        set: (v: any) => writes.push(v) }),
      Dropdown: "Dropdown", FillControl: "FillControl", Grp: "Grp", InfoTip: "InfoTip", NumField: "NumField", PropSelect: "PropSelect",
    };
    if (id === "./shared") return { Sec: "Sec", I: 12 };
    return require(id);
  }, mod, mod.exports);
  const flatten = (value: any): any[] => Array.isArray(value) ? value.flatMap(flatten) : value && typeof value === "object" ? [value, ...flatten(value.props?.children)] : [];
  const card = flatten(mod.exports.EffectsSec()).find(e => typeof e.type === "function" && e.props.shadow);
  return { fields: flatten(card.type(card.props)), writes };
}
for (const prop of ["boxShadow", "textShadow"] as const) test(`${prop} controls display and save non-pixel dimensions`, () => {
  const view = renderShadow(prop);
  const x = view.fields.find(e => e.type === "NumField" && e.props.pre === "X");
  assert.equal(x.props.value, ".5em");
  x.props.onChange("2rem");
  assert.equal(view.writes.at(-1)[prop], prop === "boxShadow" ? "2rem 1rem 2vh 0px red" : "2rem 1rem 2vh red");
  view.fields.find(e => e.type === "FillControl").props.onChange("blue");
  assert.equal(view.writes.at(-1)[prop], prop === "boxShadow" ? ".5em 1rem 2vh 0px blue" : ".5em 1rem 2vh blue");
});
