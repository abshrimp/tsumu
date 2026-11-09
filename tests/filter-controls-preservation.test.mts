import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { transformSync } from "esbuild";
function renderEffects(prop: "filter" | "backdropFilter", value: string) {
  const writes: any[] = [];
  const path = resolve("components/style-panel/EffectsSec.tsx");
  const require = createRequire(path);
  const mod = { exports: {} as any };
  const code = transformSync(readFileSync(path, "utf8"), { loader: "tsx", format: "cjs", jsx: "automatic" }).code;
  new Function("require", "module", "exports", code)((id: string) => {
    if (id === "react") return { ...require(id), useState: (v: any) => [v, () => {}] };
    if (id === "../controls") return {
      useInspector: () => ({ get: (p: string) => ({ value: p === prop ? value : undefined }), cleared: () => null,
        set: (v: any) => writes.push(v) }),
      Dropdown: "Dropdown", FillControl: "FillControl", Grp: "Grp", InfoTip: "InfoTip", NumField: "NumField", PropSelect: "PropSelect",
    };
    if (id === "./shared") return { Sec: "Sec", I: 12 };
    return require(id);
  }, mod, mod.exports);
  const flatten = (value: any): any[] => Array.isArray(value) ? value.flatMap(flatten) : value && typeof value === "object" ? [value, ...flatten(value.props?.children)] : [];
  return { fields: flatten(mod.exports.EffectsSec()), writes };
}

test("brightness control preserves other filters, source order, and repeated effects", () => {
  const view = renderEffects("filter", "contrast(200%) brightness(150%) opacity(.5) brightness(120%) drop-shadow(0 0 1rem red)");
  view.fields.find(e => e.type === "NumField" && e.props.value === "150%").props.onChange("180%");
  assert.equal(view.writes.at(-1).filter, "contrast(200%) brightness(180%) opacity(.5) brightness(120%) drop-shadow(0 0 1rem red)");
});
test("backdrop blur control keeps other effects on change and clear", () => {
  const view = renderEffects("backdropFilter", "saturate(2) blur(4px) opacity(.8)");
  const blur = view.fields.find(e => e.type === "NumField" && e.props.value === "4px");
  blur.props.onChange("6px");
  assert.equal(view.writes.at(-1).backdropFilter, "saturate(2) blur(6px) opacity(.8)");
  blur.props.onChange(null);
  assert.equal(view.writes.at(-1).backdropFilter, "saturate(2) opacity(.8)");
});
test("backdrop blur accepts CSS math without crashing or deleting other effects", () => {
  const view = renderEffects("backdropFilter", "blur(4px) saturate(2)");
  view.fields.find(e => e.type === "NumField" && e.props.value === "4px").props.onChange("calc(1rem + 2px)");
  assert.equal(view.writes.at(-1).backdropFilter, "blur(calc(1rem + 2px)) saturate(2)");
});

test("display and editing agree on the first real filter outside comments and nested expressions", () => {
  const source = '/* brightness(2) */ url("brightness(3)") var(--filter, brightness(4)) BRIGHTNESS(150%) brightness(120%)';
  const view = renderEffects("filter", source);
  view.fields.find(e => e.type === "NumField" && e.props.value === "150%").props.onChange("180%");
  assert.equal(view.writes.at(-1).filter, source.replace("BRIGHTNESS(150%)", "brightness(180%)"));
});
test("backdrop display and edit select the same uppercase non-comment blur", () => {
  const source = '/* blur(2px) */ url("blur(3px)") BLUR(4px) saturate(2)';
  const view = renderEffects("backdropFilter", source);
  view.fields.find(e => e.type === "NumField" && e.props.value === "4px").props.onChange("6px");
  assert.equal(view.writes.at(-1).backdropFilter, source.replace("BLUR(4px)", "blur(6px)"));
});
