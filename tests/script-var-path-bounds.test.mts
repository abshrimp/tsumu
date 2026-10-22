import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { Script as JsScript } from "node:vm";
import { matchesValueCondition, setVarPath, withinScriptValueLimit } from "../lib/value-semantics";
import { previewDataVars } from "../lib/data";
import { scriptsFile } from "../lib/script-runtime";
import { generateExportProject } from "../lib/export-formats";
import { scriptWorkspaceDoc } from "./helpers/script-workspace";
import type { ScriptStep, SiteDoc } from "../lib/types";

test("nested writes reject sparse array indexes without changing the original variable", () => {
  const original = [{ name: "first" }];
  const vars: Record<string, unknown> = { rows: original };
  for (const invalid of ["rows.3", "rows.1000000", "rows.1000001", "rows.length", "rows.foo", "rows.-1"]) {
    assert.equal(setVarPath(vars, invalid, 7, withinScriptValueLimit), undefined, invalid);
    assert.deepEqual(vars.rows, [{ name: "first" }], invalid);
    assert.equal((vars.rows as unknown[]).length, 1, invalid);
  }
  assert.equal(vars.rows, original, "invalid writes should not replace the source array");
});

test("nested writes still support existing indexes and contiguous append", () => {
  const original = [{ name: "first" }];
  const vars: Record<string, unknown> = { rows: original };
  assert.equal(setVarPath(vars, "rows.0.name", "updated", withinScriptValueLimit), "rows");
  assert.deepEqual(vars.rows, [{ name: "updated" }]);
  assert.equal(original[0].name, "first", "nested path assignment must be copy-on-write");
  assert.equal(setVarPath(vars, "rows.1", { name: "second" }, withinScriptValueLimit), "rows");
  assert.deepEqual(vars.rows, [{ name: "updated" }, { name: "second" }]);
  assert.equal(setVarPath(vars, "rows.2", { name: "third" }, withinScriptValueLimit), "rows");
  assert.equal((vars.rows as unknown[]).length, 3);
});

test("full arrays cannot be extended beyond the script list limit", () => {
  const rows = Array(10000).fill(0);
  const vars: Record<string, unknown> = { rows };
  assert.equal(setVarPath(vars, "rows.10000", 1, withinScriptValueLimit), undefined);
  assert.equal(vars.rows, rows);
  assert.equal(setVarPath(vars, "rows.9999", 1, withinScriptValueLimit), "rows");
  assert.equal((vars.rows as number[])[9999], 1);
});

test("non-finite numbers never silently change into JSON null or compare as valid values", () => {
  for (const bad of [NaN, Infinity, -Infinity]) {
    assert.equal(matchesValueCondition(bad, "eq", bad), false);
    assert.equal(matchesValueCondition([bad], "contains", bad), false);
    assert.equal(withinScriptValueLimit(bad), false);
    assert.equal(withinScriptValueLimit([1, { bad }]), false);
    const vars: Record<string, unknown> = { existing: 42 };
    assert.equal(setVarPath(vars, "existing", bad, withinScriptValueLimit), undefined);
    assert.equal(vars.existing, 42, "invalid writes must not mutate existing variables");
    assert.equal(setVarPath(vars, "nested.bad", bad, withinScriptValueLimit), undefined);
    assert.equal(Object.hasOwn(vars, "nested"), false);
  }
  assert.equal(withinScriptValueLimit(1), true);
  assert.equal(withinScriptValueLimit(null), true);
  assert.equal(withinScriptValueLimit(undefined), true, "undefined represents a missing value");
  assert.equal(withinScriptValueLimit([0, true, false, "text"]), true);
});

test("unsupported scalar kinds are rejected before JSON persistence", () => {
  for (const unsupported of [1n, Symbol("x"), () => 1]) {
    assert.equal(withinScriptValueLimit(unsupported), false);
    assert.equal(withinScriptValueLimit({ unsupported }), false);
  }
});

{
  const locale = readFileSync("lib/locales/ja.ts", "utf8");
  const definition = (key: string, translated: string) =>
    locale.includes(JSON.stringify(key) + ": " + JSON.stringify(translated));

  test("JSON controls call a key an 項目 without changing the storage-key terminology", () => {
    for (const [key, text] of [
      ["Key (blank to append)", "項目（空欄なら末尾）"],
      ["Field name", "項目名"],
      ["Field name to read", "取り出す項目名"],
      ["Set {value} at key {key} of list {list}", "リスト{list}の項目{key}に{value}を入れる"],
      ["List item field", "リスト内の項目名"],
      ["Field name / {variable}", "項目名 / {変数}"],
      ["have an item (comparison)", "項目がある"],
    ]) assert.equal(definition(key, text), true, key);
  });

  test("list labels distinguish array elements from dictionary items", () => {
    assert.equal(definition("List · {length} elements", "リスト・{length}要素"), true);
    assert.equal(definition("List · {length} items", "リスト・{length}項目"), true);
    assert.equal(locale.includes("{ループ.キー}"), true);
  });
}

function previewCopies(copies: [string, string][], initial: Record<string, unknown>) {
  let sourceReads = 0;
  const vars = {
    source: { get value() {
      assert.ok(++sourceReads <= 20, "preview retried the same copy without making progress");
      return 7;
    } },
  };
  const steps: ScriptStep[] = copies.map(([into, src], i) => ({
    id: "copy-" + i, kind: "set-var", into, value: "{" + src + "}",
  }));
  const doc: SiteDoc = {
    siteName: "", pages: { p: {
      id: "p", name: "", title: "", description: "", slug: "", children: [],
      pageScripts: [
        { id: "load", trigger: "load", steps: Object.entries(initial).map(([into, value]) => ({
          id: "init-" + into, kind: "fetch", as: into, method: "GET", url: "/data", preview: { sample: value },
        })) },
        { id: "click", trigger: "click", steps },
      ],
    } }, pageOrder: ["p"], nodes: {}, assets: {},
  };
  return previewDataVars(doc, "p", { vars });
}

test("nested preview copies resolve downstream samples and preserve existing fields", () => {
  const result = previewCopies([
    ["last", "article.title"], ["article.title", "source.value"],
    ["article.flag", "source.value"], ["constructor", "source.value"],
  ], { article: { flag: false } });
  assert.deepEqual(result, { article: { title: 7, flag: false }, last: 7, constructor: 7 });
});

test("unwritable or cyclic preview copies finish without inventing sample values", () => {
  const result = previewCopies([
    ["rows.4", "source.value"], ["loopA", "loopB"], ["loopB", "loopA"],
  ], { rows: [] });
  assert.deepEqual(result, { rows: [] });
});

const featureSteps: ScriptStep[] = [
  { id: "assign", kind: "set-var", into: "x", value: "1" },
  { id: "insert", kind: "set-list-item", list: "items", key: "", value: "1" },
  { id: "delete", kind: "remove-list-item", list: "items", mode: "value", value: "1" },
  { id: "count", kind: "transform", source: "items", into: "count", transform: { kind: "length" } },
];
for (const step of featureSteps) test(`published nested ${step.kind} includes only its required variable operations`, () => {
  const doc: SiteDoc = {
    siteName: "", assets: {}, pageOrder: ["p"], nodes: {}, pages: { p: {
      id: "p", name: "", slug: "", description: "", title: "", children: [], pageScripts: [{
        id: "s", trigger: "click", steps: [{ id: "repeat", kind: "repeat", times: 1, then: [step] }],
      }],
    } },
  };
  const code = scriptsFile(doc);
  assert.doesNotThrow(() => new JsScript(code));
  for (const other of featureSteps) assert.equal(code.includes(`case "${other.kind}":`), step.kind === other.kind);
  assert.equal(code.includes("var evalRecipe ="), step.kind === "transform");
  assert.equal(code.includes("var removeItem ="), step.kind === "remove-list-item");
});

for (const layout of ["single", "stacks"] as const) {
  test(`${layout} script workspace exports 4000 blocks without mutation`, () => {
    const doc = scriptWorkspaceDoc(layout);
    const scripts = doc.pages.p.pageScripts!;
    assert.equal(scripts.length, layout === "single" ? 1 : 160);
    const steps = scripts.flatMap((script) => script.steps);
    assert.equal(steps.length, 4000);
    assert.equal(new Set(steps.map((step) => step.id)).size, 4000);
    assert.deepEqual(scriptWorkspaceDoc(layout), doc, "test fixture must be deterministic");
    const snapshot = JSON.stringify(doc);
    const project = generateExportProject(doc, "nextjs");
    const encoded = project.files["app/page.tsx"].match(/data-scripts=\{("(?:[^"\\]|\\.)*")\}/)?.[1];
    assert.ok(encoded, "export contains the page script payload");
    const exported = JSON.parse(JSON.parse(encoded));
    assert.deepEqual(exported, scripts.map((script) => ({
      trigger: "load", steps: script.steps.map(() => ({ kind: "wait", seconds: 1 })),
    })), "all 4000 operations must be exported, not just an empty page");
    assert.equal(JSON.stringify(doc), snapshot);
  });
}
