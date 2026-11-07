import assert from "node:assert/strict";
import { test } from "node:test";
import { transformSync } from "esbuild";
import { filterItems, matchOp, pageArrays, pagePlan, previewDataVars, renameVarInPage } from "../lib/data";
import { runPurePageSteps } from "../lib/page-load-steps";
import { evaluateValueRecipe } from "../lib/script-model/recipe-runtime";
import { lookupVar, interpolate } from "../lib/vars";
import { generateProject } from "../lib/generator";
import { filterPredicate } from "../lib/generator/render-helpers";
import { makeBox } from "../lib/presets";
import { compileScripts } from "../lib/script";
import { scriptsFile } from "../lib/script-runtime";
import { scriptDataPickerDoc } from "./helpers/script-data-picker";
import { findPaletteItems, PALETTE } from "../components/script-editor/palette";
import { connectNewTransform } from "../components/script-editor/step-tree";
import type { ScriptStep } from "../lib/types";

test("every supported palette action is visible without hidden compatibility groups", () => {
  assert.equal(PALETTE.length, 23);
  assert.equal(findPaletteItems("").length, 23);
  assert.equal(PALETTE.filter(item => item.cat !== "event").length, 17);
  assert.ok(PALETTE.some(item => item.key === "transform"));
  assert.ok(PALETTE.some(item => item.key === "list-display"));
  assert.ok(PALETTE.some(item => item.key === "set-state"));
  assert.ok(findPaletteItems("値を加工").some(item => item.key === "transform"));
});

test("list filters invert individual conditions without duplicating negative operators", () => {
  const items = [
    { name: "red", active: "yes" },
    { name: "blue", active: "yes" },
    { name: "red-blue", active: "no" },
  ];
  const filter = { kind: "filter" as const, conds: [
    { field: "name", op: "contains" as const, value: "red", not: true },
    { field: "active", op: "eq" as const, value: "no", not: true, and: true },
  ] };
  assert.deepEqual(filterItems(items, [filter]), [items[1]]);
  const expr = filterPredicate([filter], "vars");
  assert.match(expr ?? "", /!\(/);
  assert.match(expr ?? "", /includes/);
  assert.match(expr ?? "", /&&/);
  assert.deepEqual(filterItems(items, [{ kind: "filter",
    conds: [{ field: "active", op: "empty", value: "", not: true }] }]), items);
});

test("transform conditions agree with display-list filters for missing, null and array fields", () => {
  const items = [
    { name: "A", tags: ["x", "y"] }, { name: "" },
    { id: 3 }, { name: null }, { name: "B" },
  ];
  const criteria = [
    { field: "name", op: "empty" as const, value: "" },
    { field: "name", op: "eq" as const, value: "A", not: true },
    { field: "tags", op: "eq" as const, value: "x,y" },
    { field: "name", op: "eq" as const, value: "", not: true },
  ];
  for (const condition of criteria) {
    const expected = filterItems(items, [{ kind: "filter", conds: [condition] }]);
    const actual = evaluateValueRecipe(items, [{
      kind: "filter", field: condition.field, operation: condition.op,
      operand: condition.value, not: condition.not,
    }]);
    assert.deepEqual(actual, { kind: "value", value: expected }, JSON.stringify(condition));
  }
});

test(">= and <= are consistent in list filters and server-side page-load if", () => {
  assert.equal(matchOp("10", "gte", "10"), true);
  assert.equal(matchOp("10", "lte", "10"), true);
  assert.equal(matchOp("9", "gte", "10"), false);
  assert.equal(matchOp("11", "lte", "10"), false);
  const items = [{ score: 9 }, { score: 10 }, { score: 15 }, { score: 20 }, { score: 21 }];
  const ops = [{ kind: "filter" as const, conds: [
    { field: "score", op: "gte" as const, value: "10" },
    { field: "score", op: "lte" as const, value: "20", and: true },
  ] }];
  assert.deepEqual(filterItems(items, ops), items.slice(1, 4));
  const predicate = filterPredicate(ops, "vars");
  assert.match(predicate ?? "", />=/);
  assert.match(predicate ?? "", /<=/);
  const vars: Record<string, unknown> = { score: "10" };
  const steps: ScriptStep[] = [
    { id: "positive", kind: "if", cond: {
      subject: "var", target: "", left: "{score}", op: "gte", value: "10",
    }, then: [{ id: "yes", kind: "set-var", value: "yes", into: "result" }],
       else: [{ id: "no", kind: "set-var", value: "no", into: "result" }] },
    { id: "negative", kind: "if", cond: {
      subject: "var", target: "", left: "{score}", op: "lte", value: "10", not: true,
    }, then: [{ id: "unexpected", kind: "set-var", value: "wrong", into: "result" }] },
  ];
  assert.equal(runPurePageSteps(steps, vars, lookupVar, interpolate, evaluateValueRecipe), true);
  assert.equal(vars.result, "yes");
});

test("three ordinary blocks compose a value in preview and server generated output", () => {
  const doc = scriptDataPickerDoc();
  const steps = doc.pages.p.pageScripts![0].steps;
  const chain: ScriptStep[] = [
    { id: "t1", kind: "transform", source: "data", into: "chosen", transform: { kind: "field", key: "tags" } },
    { id: "t2", kind: "transform", source: "chosen", into: "chosen", transform: { kind: "length" } },
    { id: "t3", kind: "transform", source: "chosen", into: "chosen", transform: { kind: "math", operation: "add", operand: 5 } },
  ];
  steps.splice(1, 1, ...chain);
  const plan = pagePlan(doc, "p");
  for (const block of chain) assert.ok(plan.serverIds.has(block.id));
  assert.equal(previewDataVars(doc, "p").chosen, 7);
  const files = generateProject(doc).files;
  assert.ok(files["lib/value-recipe.ts"]);
  const server = files["app/page.tsx"];
  assert.match(server, /__evalValueRecipe/);
  assert.match(server, /"math"/);
  assert.doesNotThrow(() => transformSync(server, { loader: "tsx", jsx: "automatic" }));
});

test("holiday dictionary transforms are previewable and serializable in generated server output", () => {
  const doc = scriptDataPickerDoc();
  const steps = doc.pages.p.pageScripts![0].steps;
  steps.push(
    { id: "holidays-fetch", kind: "fetch", as: "祝日",
      url: "https://holidays-jp.github.io/api/v1/date.json",
      sample: { "2026-11-03": "文化の日", "2026-11-23": "勤労感謝の日" } },
    { id: "today", kind: "set-var", into: "今日の日付", value: "2026-11-23" },
    { id: "todays-holiday", kind: "transform", source: "祝日", into: "今日の祝日",
      transform: { kind: "field", key: "{今日の日付}" } },
    { id: "holiday-rows", kind: "transform", source: "祝日", into: "祝日一覧",
      transform: { kind: "object-entries", keyField: "日付", valueField: "祝日名" } },
  );
  const preview = previewDataVars(doc, "p");
  assert.equal(preview["今日の祝日"], "勤労感謝の日");
  assert.deepEqual(preview["祝日一覧"], [
    { "日付": "2026-11-03", "祝日名": "文化の日" },
    { "日付": "2026-11-23", "祝日名": "勤労感謝の日" },
  ]);
  assert.ok(pageArrays(doc, "p").some(({ name }) => name === "祝日一覧"));
  const plan = pagePlan(doc, "p");
  assert.ok(plan.serverIds.has("todays-holiday"));
  assert.ok(plan.serverIds.has("holiday-rows"));
  const files = generateProject(doc).files;
  assert.match(files["app/page.tsx"], /"object-entries"/);
  assert.match(files["lib/value-recipe.ts"], /"object-entries"/);
  assert.doesNotThrow(() => transformSync(files["app/page.tsx"], { loader: "tsx", jsx: "automatic" }));
});

test("renaming variables keeps object-entry column templates synchronized", () => {
  const doc = scriptDataPickerDoc();
  const steps = doc.pages.p.pageScripts![0].steps;
  steps.push({ id: "column-rename", kind: "transform", source: "data", into: "rows",
    transform: { kind: "object-entries",
      keyField: "{labels.keyName}", valueField: "{labels.valueName}" } });
  renameVarInPage(doc, "p", "labels", "displayLabels");
  const renamed = steps.find((step) => step.id === "column-rename");
  assert.ok(renamed?.kind === "transform" && renamed.transform.kind === "object-entries");
  if (renamed?.kind !== "transform" || renamed.transform.kind !== "object-entries")
    throw new Error("Expected object entries transform");
  assert.equal(renamed.transform.keyField, "{displayLabels.keyName}");
  assert.equal(renamed.transform.valueField, "{displayLabels.valueName}");
  assert.deepEqual(evaluateValueRecipe({ "2026-11-23": "勤労感謝の日" }, [renamed.transform], {
    displayLabels: { keyName: "日付", valueName: "祝日名" },
  }), { kind: "value", value: [{ "日付": "2026-11-23", "祝日名": "勤労感謝の日" }] });
});

test("browser-only object-entry column names keep the transform out of SSR", () => {
  const doc = scriptDataPickerDoc();
  doc.pages.p.pageScripts![0].steps.push(
    { id: "dynamic-column", kind: "store-load", key: "chosen-field", into: "keyName" },
    { id: "client-entries", kind: "transform", source: "data", into: "rows",
      transform: { kind: "object-entries", keyField: "{keyName}", valueField: "値" } },
  );
  const plan = pagePlan(doc, "p");
  assert.ok(!plan.serverIds.has("client-entries"));
  assert.ok(plan.clientVars.has("rows"));
});

test("server data transforms interpolate strings and source variables without client-only adapters", () => {
  const doc = scriptDataPickerDoc();
  doc.pages.p.pageScripts![0].steps.push(
    { id: "person", kind: "set-var", into: "person", value: "田中" },
    { id: "fallback", kind: "transform", source: "missing", into: "greeting",
      transform: { kind: "fallback", text: "こんにちは、{person}さん" } },
    { id: "dynamic-name", kind: "set-var", into: "lookupField", value: "price" },
    { id: "read-price", kind: "transform", source: "data", into: "cost",
      transform: { kind: "field", key: "{lookupField}" } },
  );
  const plan = pagePlan(doc, "p");
  assert.ok(plan.serverIds.has("fallback"));
  assert.ok(plan.serverIds.has("read-price"));
  const vars = previewDataVars(doc, "p");
  assert.equal(vars.greeting, "こんにちは、田中さん");
  assert.equal(vars.cost, 12);
  const generated = generateProject(doc).files["app/page.tsx"];
  assert.match(generated, /"kind":"fallback"/);
  assert.match(generated, /"key":"\{_\d+\}"/);
  assert.doesNotThrow(() => transformSync(generated, { loader: "tsx", jsx: "automatic" }));
});

test("comparison operands can refer to another variable", () => {
  const doc = scriptDataPickerDoc();
  doc.pages.p.pageScripts![0].steps.push({
    id: "threshold", kind: "set-var", value: "{data.price}", into: "threshold",
  }, {
    id: "cmp", kind: "transform", source: "data.price", into: "above",
    transform: { kind: "compare", operation: "gte", operand: "{threshold}" },
  });
  const result = previewDataVars(doc, "p");
  assert.equal(result.threshold, 12);
  assert.equal(result.above, true);
});

test("server preview can calculate using numeric strings from another variable and edit lists", () => {
  const doc = scriptDataPickerDoc();
  doc.pages.p.pageScripts![0].steps.push(
    { id: "rate", kind: "set-var", value: "1.5", into: "rate" },
    { id: "calc", kind: "transform", source: "data.price", into: "total",
      transform: { kind: "math", operation: "multiply", operandType: "variable", operand: "rate" } },
    { id: "append", kind: "transform", source: "data.tags", into: "tags",
      transform: { kind: "append", operandType: "text", operand: "green" } },
    { id: "remove", kind: "transform", source: "tags", into: "tags",
      transform: { kind: "remove", operandType: "text", operand: "red" } },
  );
  const vars = previewDataVars(doc, "p");
  assert.equal(vars.total, 18);
  assert.deepEqual(vars.tags, ["blue", "green"]);
  const plan = pagePlan(doc, "p");
  assert.ok(plan.serverIds.has("calc"));
  assert.ok(plan.serverIds.has("append"));
  assert.ok(plan.serverIds.has("remove"));
  const generated = generateProject(doc).files["app/page.tsx"];
  assert.match(generated, /"append"/);
  assert.match(generated, /"remove"/);
  assert.doesNotThrow(() => transformSync(generated, { loader: "tsx", jsx: "automatic" }));
});

test("a browser-only operand keeps its arithmetic block in the client runtime", () => {
  const doc = scriptDataPickerDoc();
  doc.pages.p.pageScripts![0].steps.push(
    { id: "browser-rate", kind: "store-load", key: "tax", into: "rate" },
    { id: "dynamic-total", kind: "transform", source: "data.price", into: "total",
      transform: { kind: "math", operation: "multiply", operandType: "variable", operand: "rate" } },
  );
  const plan = pagePlan(doc, "p");
  assert.ok(!plan.serverIds.has("dynamic-total"));
  assert.ok(plan.clientVars.has("total"));
});

test("page-load for-each and if execute on fetched items before rendering, including nested transforms", () => {
  const doc = scriptDataPickerDoc();
  const load = doc.pages.p.pageScripts![0].steps;
  const fetch = load[0];
  if (fetch.kind !== "fetch") throw new Error("Expected fetch fixture");
  fetch.sample = {
    rows: [
      { price: 10, enabled: "true" },
      { price: 7, enabled: "false" },
      { price: 5, enabled: "true" },
    ],
  };
  load.push(
    { id: "zero", kind: "set-var", value: "0", into: "total" },
    { id: "init-number", kind: "transform", source: "total", into: "total",
      transform: { kind: "parse" } },
    { id: "empty", kind: "set-var", value: "[]", into: "prices" },
    { id: "init-list", kind: "transform", source: "prices", into: "prices",
      transform: { kind: "parse" } },
    { id: "each-price", kind: "for-each", array: "data.rows", then: [
      { id: "if-enabled", kind: "if",
        cond: { subject: "var", target: "", left: "{enabled}", op: "eq", value: "true" },
        then: [
          { id: "double", kind: "transform", source: "price", into: "doubled",
            transform: { kind: "math", operation: "multiply", operand: 2 } },
          { id: "sum", kind: "transform", source: "total", into: "total",
            transform: { kind: "math", operation: "add", operandType: "variable", operand: "doubled" } },
          { id: "append", kind: "transform", source: "prices", into: "prices",
            transform: { kind: "append", operandType: "variable", operand: "doubled" } },
        ], else: [
          { id: "excluded", kind: "set-var", value: "excluded", into: "status" },
        ] },
    ] },
  );
  const plan = pagePlan(doc, "p");
  assert.ok(plan.serverIds.has("each-price"));
  assert.ok(!plan.clientVars.has("doubled"));
  const preview = previewDataVars(doc, "p");
  assert.equal(preview.total, 30);
  assert.deepEqual(preview.prices, [20, 10]);
  assert.equal(preview.status, "excluded");
  const project = generateProject(doc).files;
  assert.ok(project["lib/page-load-steps.ts"]);
  assert.ok(project["lib/value-recipe.ts"]);
  assert.match(project["app/page.tsx"], /__runPurePageSteps/);
  assert.match(project["app/page.tsx"], /"for-each"/);
  assert.doesNotThrow(() => transformSync(project["app/page.tsx"], { loader: "tsx", jsx: "automatic" }));
});

test("generated page-load evaluator matches editor behavior without TypeScript dependencies", () => {
  const doc = scriptDataPickerDoc();
  doc.pages.p.pageScripts![0].steps.push(
    { id: "outer", kind: "for-each", array: "data.tags", then: [
      { id: "set-var", kind: "set-var", value: "{値}", into: "last" },
    ] },
  );
  const project = generateProject(doc).files;
  const source = project["lib/page-load-steps.ts"];
  const generated = new Function(
    source.replace("export const runPurePageSteps", "const runPurePageSteps") +
    "\nreturn runPurePageSteps;",
  )() as typeof runPurePageSteps;
  const initial = { data: { tags: ["a", "b", "c"] } };
  const actual = structuredClone(initial) as Record<string, unknown>;
  assert.equal(generated(doc.pages.p.pageScripts![0].steps.slice(-1), actual,
    lookupVar, interpolate, evaluateValueRecipe), true);
  assert.equal(actual.last, "c");
});

test("oversized page-load loops abort without leaving partial variable changes", () => {
  const vars: Record<string, unknown> = { rows: Array(100001).fill(1), output: "unchanged" };
  const loop: ScriptStep = { id: "large", kind: "for-each", array: "rows", then: [
    { id: "write", kind: "set-var", value: "{値}", into: "output" },
  ] };
  assert.equal(runPurePageSteps([loop], vars, lookupVar, interpolate, evaluateValueRecipe), false);
  assert.equal(vars.output, "unchanged");
});

test("page-load repeat count can come from a numeric-string variable", () => {
  const doc = scriptDataPickerDoc();
  doc.pages.p.pageScripts![0].steps.push(
    { id: "count", kind: "set-var", into: "count", value: "3" },
    { id: "initial", kind: "set-var", into: "sum", value: "0" },
    { id: "numeric", kind: "transform", source: "sum", into: "sum", transform: { kind: "parse" } },
    { id: "iterate", kind: "repeat", times: "{count}", then: [
      { id: "increment", kind: "transform", source: "sum", into: "sum",
        transform: { kind: "math", operation: "add", operand: 1 } },
    ] },
  );
  const plan = pagePlan(doc, "p");
  assert.ok(plan.serverIds.has("iterate"));
  assert.equal(previewDataVars(doc, "p").sum, 3);
  const files = generateProject(doc).files;
  assert.match(files["app/page.tsx"], /"times":"\{_\d+\}"/);
  assert.doesNotThrow(() => transformSync(files["app/page.tsx"], { loader: "tsx", jsx: "automatic" }));
});

test("page-load nested browser effects are not mistakenly executed or discarded by SSR", () => {
  const doc = scriptDataPickerDoc();
  doc.pages.p.pageScripts![0].steps.push(
    { id: "not-server", kind: "for-each", array: "data.tags", then: [
      { id: "copy", kind: "copy", value: "{値}" },
    ] },
    { id: "unbounded", kind: "repeat", times: 0, then: [
      { id: "assign", kind: "set-var", into: "never", value: "not server" },
    ] },
  );
  const plan = pagePlan(doc, "p");
  assert.ok(!plan.serverIds.has("not-server"));
  assert.ok(!plan.serverIds.has("unbounded"));
  assert.ok(!plan.serverIds.has("copy"));
});

test("page-load nested loops read the nearest item's fields and preserve the outer result", () => {
  const doc = scriptDataPickerDoc();
  const fetch = doc.pages.p.pageScripts![0].steps[0];
  if (fetch.kind !== "fetch") throw new Error("Expected fetch fixture");
  fetch.sample = {
    rows: [{ key: "outer", nested: [{ key: "a" }, { key: "b" }] }],
  };
  const steps = doc.pages.p.pageScripts![0].steps;
  steps.push(
    { id: "empty", kind: "set-var", value: "[]", into: "collected" },
    { id: "parse", kind: "transform", source: "collected", into: "collected", transform: { kind: "parse" } },
    { id: "each-outer", kind: "for-each", array: "data.rows", then: [
      { id: "each-inner", kind: "for-each", array: "nested", then: [
        { id: "collect", kind: "transform", source: "collected", into: "collected",
          transform: { kind: "append", operandType: "variable", operand: "key" } },
      ] },
    ] },
  );
  assert.ok(pagePlan(doc, "p").serverIds.has("each-outer"));
  assert.deepEqual(previewDataVars(doc, "p").collected, ["a", "b"]);
});

test("a canvas transform chain serializes to the browser runtime without losing step order", () => {
  const doc = scriptDataPickerDoc();
  const node = { ...makeBox(), id: "action", attrId: "action", scripts: [{
    id: "click", trigger: "click" as const, pos: { x: 0, y: 0 }, steps: [
      { id: "input", kind: "set-var" as const, into: "number", value: "4" },
      { id: "parse", kind: "transform" as const, source: "number", into: "number", transform: { kind: "parse" as const } },
      { id: "math", kind: "transform" as const, source: "number", into: "number",
        transform: { kind: "math" as const, operation: "multiply" as const, operand: 3 } },
    ],
  }] };
  doc.nodes.action = node;
  doc.pages.p.children.push("action");
  const steps = compileScripts(node, () => "/")[0].steps;
  assert.deepEqual(steps.map(s => s.kind), ["set-var", "transform", "transform"]);
  assert.equal(steps[2].into, "number");
  assert.doesNotThrow(() => new Function(scriptsFile(doc)));
});

test("newly dropped processing blocks inherit the preceding output without mutation", () => {
  const doc = scriptDataPickerDoc();
  const script = { ...doc.pages.p.pageScripts![0], nodeId: null };
  const incoming: ScriptStep[] = [
    { id: "next", kind: "transform", source: "", into: "", transform: { kind: "length" } },
  ];
  const connected = connectNewTransform([script], { scriptId: script.id, list: "root", index: 2 }, incoming);
  assert.deepEqual(connected, [
    { id: "next", kind: "transform", source: "chosen", into: "chosen", transform: { kind: "length" } },
  ]);
  assert.equal((incoming[0] as Extract<ScriptStep, { kind: "transform" }>).source, "");
});

test("constant load steps are evaluated on the server without leaking unused values to browser scripts", () => {
  const doc = scriptDataPickerDoc();
  doc.pages.p.pageScripts![0].steps.push({
    id: "private", kind: "set-var", value: "UNUSED_PRIVATE_SENTINEL", into: "private",
  });
  const plan = pagePlan(doc, "p");
  assert.ok(plan.serverIds.has("private"));
  assert.equal(previewDataVars(doc, "p").private, "UNUSED_PRIVATE_SENTINEL");
  const files = generateProject(doc).files;
  assert.ok(files["app/page.tsx"].includes("UNUSED_PRIVATE_SENTINEL"));
  assert.doesNotMatch(files["public/scripts.js"] ?? "", /UNUSED_PRIVATE_SENTINEL/);
});

test("fetched sample totals are preserved through aliases in composition without truncating actual data", () => {
  const doc = scriptDataPickerDoc();
  const fetch = doc.pages.p.pageScripts![0].steps[0];
  if (fetch.kind !== "fetch") throw new Error("Expected fetch fixture");
  fetch.sampleTotals = { tags: 52 };
  doc.pages.p.pageScripts![0].steps.push(
    { id: "alias", kind: "set-var", value: "{data.tags}", into: "selectedTags" },
    { id: "len", kind: "transform", source: "selectedTags", into: "total", transform: { kind: "length" } },
  );
  assert.equal(previewDataVars(doc, "p").total, 52);
  assert.equal(previewDataVars(doc, "p", {
    live: { fetch: { tags: ["x", "y", "z"] } },
  }).total, 3);
  assert.equal(previewDataVars(doc, "p", {
    live: { fetch: { tags: ["x", "y"] } },
    liveTotals: { fetch: { tags: 42 } },
  }).total, 42);
});
