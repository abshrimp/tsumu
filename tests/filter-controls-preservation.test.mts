import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { transformSync } from "esbuild";
import { editFilterFunction } from "../lib/filter-edit";
import { filterFieldKind, filterFieldOperators, filterFieldSelection } from "../lib/filter-field-options";
import { matchesValueCondition } from "../lib/value-semantics";

const effectsPath = resolve("components/style-panel/EffectsSec.tsx");
const effectsRequire = createRequire(effectsPath);
const effectsCode = transformSync(readFileSync(effectsPath, "utf8"), { loader: "tsx", format: "cjs", jsx: "automatic" }).code;

function renderEffects(prop: "filter" | "backdropFilter", value: string) {
  const writes: any[] = [];
  const mod = { exports: {} as any };
  new Function("require", "module", "exports", effectsCode)((id: string) => {
    if (id === "react") return { ...effectsRequire(id), useState: (v: any) => [v, () => {}] };
    if (id === "../controls") return {
      useInspector: () => ({ get: (p: string) => ({ value: p === prop ? value : undefined }), cleared: () => null,
        set: (v: any) => writes.push(v) }),
      Dropdown: "Dropdown", FillControl: "FillControl", Grp: "Grp", InfoTip: "InfoTip", NumField: "NumField", PropSelect: "PropSelect",
    };
    if (id === "./shared") return { Sec: "Sec", I: 12 };
    return effectsRequire(id);
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

test("filter editing preserves order, repeated functions, and unsupported effects", () => {
  assert.equal(editFilterFunction('contrast(200%) brightness(150%) opacity(.5) brightness(120%) drop-shadow(0 0 1rem red)', 'brightness', 'brightness(180%)'),
    'contrast(200%) brightness(180%) opacity(.5) brightness(120%) drop-shadow(0 0 1rem red)');
});
test("nested and quoted filter text is not treated as a top-level effect", () => {
  const src = 'url("data:image/svg+xml;brightness(20%)") var(--effect, brightness(50%))';
  assert.equal(editFilterFunction(src, 'brightness', 'brightness(200%)'), src + ' brightness(200%)');
});
test("replacing nested math keeps the rest of the filter chain", () => {
  assert.equal(editFilterFunction('blur(calc(1rem + var(--extra))) saturate(2)', 'blur', 'blur(4px)'), 'blur(4px) saturate(2)');
});
test("removing blur preserves other backdrop filters", () => {
  assert.equal(editFilterFunction('saturate(2) blur(4px) opacity(.8)', 'blur', null), 'saturate(2) opacity(.8)');
});
test("adding an effect handles none and CSS wide keyword values", () => {
  for (const raw of [undefined, 'none', 'NONE', 'inherit', 'revert-layer'])
    assert.equal(editFilterFunction(raw, 'blur', 'blur(4px)'), 'blur(4px)');
});
test("matches function names case insensitively and preserves unrelated source", () => {
  assert.equal(editFilterFunction('BLUR(4px) contrast(200%)', 'blur', 'blur(6px)'), 'blur(6px) contrast(200%)');
});
test("comments containing filter names are preserved, not edited", () => {
  assert.equal(editFilterFunction('/* blur(2px) */ contrast(2)', 'blur', 'blur(4px)'), '/* blur(2px) */ contrast(2) blur(4px)');
  assert.equal(editFilterFunction('/* blur(2px) */ blur(3px) contrast(2)', 'blur', 'blur(4px)'), '/* blur(2px) */ blur(4px) contrast(2)');
});

const categories = {
  "出展カテゴリ": ["物販"],
  "投票カテゴリ": ["物販"],
  "大分類": ["かう"],
};

test("filter field type hints retain singleton arrays and distinguish records", () => {
  assert.equal(filterFieldKind(categories), "record");
  assert.equal(filterFieldKind(categories["出展カテゴリ"]), "array");
  assert.equal(filterFieldKind("物販"), "scalar");
  assert.equal(filterFieldKind(undefined), "unknown");
  assert.deepEqual(filterFieldOperators(categories), ["has-key", "empty", "eq"]);
  assert.deepEqual(filterFieldOperators(categories["出展カテゴリ"]), ["contains", "contains-any", "empty", "eq"]);
  assert.equal(filterFieldOperators(undefined), undefined);
});

test("switching filter fields chooses valid predicates and preserves compatible edits", () => {
  const scalar = { field: "title", op: "eq" as const, value: "物販" };
  const record = filterFieldSelection(scalar, "categories", "商品", categories);
  assert.deepEqual(record, { field: "categories", op: "has-key", value: "" });
  const array = filterFieldSelection(record, "categories.出展カテゴリ", categories, categories["出展カテゴリ"]);
  assert.deepEqual(array, { field: "categories.出展カテゴリ", op: "contains", value: "" });
  const sameArray = filterFieldSelection({ ...array, value: "物販" }, "categories.投票カテゴリ", categories["出展カテゴリ"], categories["投票カテゴリ"]);
  assert.deepEqual(sameArray, { field: "categories.投票カテゴリ", op: "contains", value: "物販" });
  const scalarToArray = filterFieldSelection(scalar, "categories.出展カテゴリ", "商品", categories["出展カテゴリ"]);
  assert.equal(scalarToArray.value, "物販");
  assert.equal(scalarToArray.op, "contains");
  assert.deepEqual(filterFieldSelection(scalar, "later", "商品", undefined), { ...scalar, field: "later" });
});

test("record-key and singleton-list membership comparisons use existing shared runtime semantics", () => {
  assert.equal(matchesValueCondition(categories, "has-key", "出展カテゴリ"), true);
  assert.equal(matchesValueCondition(categories, "has-key", "別のカテゴリ"), false);
  assert.equal(matchesValueCondition(categories["出展カテゴリ"], "contains", "物販"), true);
  assert.equal(matchesValueCondition(categories["出展カテゴリ"], "contains", "飲食"), false);
  assert.equal(matchesValueCondition(categories, "empty", ""), false);
  assert.equal(matchesValueCondition({}, "empty", ""), true);
  assert.equal(matchesValueCondition(categories, "eq", JSON.parse(JSON.stringify(categories))), true);
});

test("contains-any matches overlapping list values and rejects disjoint values", () => {
  assert.equal(matchesValueCondition(["物販", "展示"], "contains-any", ["飲食", "展示"]), true);
  assert.equal(matchesValueCondition(["物販", "展示"], "contains-any", ["飲食"]), false);
  assert.equal(matchesValueCondition(["物販", "展示"], "contains-any", "飲食, 物販"), true);
  assert.equal(matchesValueCondition([], "contains-any", ["物販"]), false);
  assert.equal(matchesValueCondition(["物販"], "contains-any", []), false);
  assert.equal(matchesValueCondition([{ id: 1 }], "contains-any", [{ id: "1" }]), true);
});
