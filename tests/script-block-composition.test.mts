import assert from "node:assert/strict";
import { test } from "node:test";
import { transformSync } from "esbuild";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { digPath, compareValues, filterConds, filterItems, matchOp, pageArrays, pagePlan, previewDataVars, renameVarInPage, setVarPath, setVarSource } from "../lib/data";
import { runPurePageSteps } from "../lib/page-load-steps";
import { evaluateValueRecipe } from "../lib/script-model/recipe-runtime";
import { lookupVar, interpolate } from "../lib/vars";
import { generateProject } from "../lib/generator";
import { filterPredicate, listItemsExpr } from "../lib/generator/render-helpers";
import { makeBox } from "../lib/presets";
import { cloneSteps, compileScripts, scriptTargetIds } from "../lib/script";
import { scriptsFile } from "../lib/script-runtime";
import { scriptDataPickerDoc } from "./helpers/script-data-picker";
import { findPaletteItems, PALETTE } from "../components/script-editor/palette";
import { connectNewTransform } from "../components/script-editor/step-tree";
import type { ScriptStep } from "../lib/types";

test("preview data preserves API nulls and prototype-like variable names as ordinary keys", () => {
  const doc = scriptDataPickerDoc();
  const steps = doc.pages.p.pageScripts![0].steps;
  const fetch = steps[0];
  if (fetch.kind !== "fetch") throw new Error("expected fetch step");
  assert.equal(previewDataVars(doc, "p", { live: { [fetch.id]: null } }).data, null,
    "a live null JSON response must not be replaced by the saved sample");
  steps.push({ id: "special", kind: "fetch", url: "https://example.com/data",
    as: "__proto__", sample: { value: "safe" } });
  const vars = previewDataVars(doc, "p");
  assert.equal(Object.getPrototypeOf(vars), Object.prototype);
  assert.equal(Object.prototype.hasOwnProperty.call(vars, "__proto__"), true);
  assert.equal(lookupVar(vars, "__proto__.value"), "safe");
  assert.equal(({} as Record<string, unknown>).value, undefined);
});

test("nested variable assignment never mutates prototypes or reads inherited paths", () => {
  const vars: Record<string, unknown> = {};
  setVarPath(vars, "__proto__", { polluted: true });
  assert.deepEqual(Object.getPrototypeOf(vars), Object.prototype);
  assert.equal(Object.prototype.hasOwnProperty.call(vars, "__proto__"), true);
  assert.equal(lookupVar(vars, "__proto__.polluted"), true);
  setVarPath(vars, "constructor.name", "owned");
  assert.equal(lookupVar(vars, "constructor.name"), "owned");
  setVarPath(vars, "result.__proto__.polluted", "local");
  assert.equal(lookupVar(vars, "result.__proto__.polluted"), "local");
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
  const original = { tags: ["red", "blue"] };
  const nested: Record<string, unknown> = { data: original };
  setVarPath(nested, "data.tags.0", "green");
  assert.equal(lookupVar(nested, "data.tags.0"), "green");
  assert.deepEqual(original.tags, ["red", "blue"], "nested writes must copy source values");
});

test("generated server page variables use a null prototype even for special URL keys", () => {
  const doc = scriptDataPickerDoc();
  const files = generateProject(doc).files;
  const page = files["app/page.tsx"];
  assert.match(page, /const vars: Vars = Object\.create\(null\);/);
  assert.doesNotMatch(page, /const vars: Vars = \{\};/);
  assert.doesNotThrow(() => transformSync(page, { loader: "tsx", jsx: "automatic" }));
  const vars = Object.create(null) as Record<string, unknown>;
  vars["__proto__"] = { safe: true };
  vars["constructor"] = "literal";
  assert.equal(Object.getPrototypeOf(vars), null);
  assert.deepEqual(lookupVar(vars, "__proto__.safe"), true);
  assert.equal(lookupVar(vars, "constructor"), "literal");
});

test("literal JSON in set-var is not misclassified as a full variable reference", () => {
  const json = '{"2026-11-23":"勤労感謝の日"}';
  const set: ScriptStep = { id: "json-value", kind: "set-var", into: "holidayJSON", value: json };
  assert.equal(setVarSource(set), null);
  const compiled = compileScripts({ scripts: [{
    id: "json-script", trigger: "click", pos: { x: 0, y: 0 }, steps: [set],
  }] }, () => "/");
  assert.equal(compiled[0].steps[0].value, json);
  const vars: Record<string, unknown> = {};
  assert.equal(runPurePageSteps([set], vars, lookupVar, interpolate, evaluateValueRecipe), true);
  assert.deepEqual(vars.holidayJSON, { "2026-11-23": "勤労感謝の日" });
  const reference: ScriptStep = { id: "ref", kind: "set-var",
    into: "holidayName", value: "{date}" };
  assert.equal(setVarSource(reference), "date");
  assert.equal(compileScripts({ scripts: [{
    id: "ref-script", trigger: "click", pos: { x: 0, y: 0 }, steps: [reference],
  }] }, () => "/")[0].steps[0].value, "{date}");
});

test("JSON lookup resolves own keys without traversing inherited prototypes", () => {
  const json = JSON.parse('{"2026-11-23":"勤労感謝の日","__proto__":{"polluted":true},"constructor":{"name":"own"}}');
  assert.equal(lookupVar(json, "2026-11-23"), "勤労感謝の日");
  assert.equal(digPath(json, "2026-11-23"), "勤労感謝の日");
  assert.equal(lookupVar(json, "__proto__.polluted"), true);
  assert.equal(digPath(json, "__proto__.polluted"), true);
  assert.equal(lookupVar(json, "constructor.name"), "own");
  assert.equal(lookupVar({}, "constructor"), undefined);
  assert.equal(lookupVar({}, "__proto__.polluted"), undefined);
  assert.equal(digPath({}, "toString"), undefined);
  assert.equal(digPath({}, "__proto__.polluted"), undefined);
  assert.equal(lookupVar({ list: [11, 12] }, "list.-1"), 12);
  assert.equal(lookupVar({ list: [] }, "list.-1"), undefined);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

test("every supported palette action is visible in the editor", () => {
  assert.equal(PALETTE.length, 26);
  assert.equal(findPaletteItems("").length, 26);
  assert.equal(PALETTE.filter(item => item.cat !== "event").length, 20);
  assert.ok(PALETTE.some(item => item.key === "transform"));
  assert.ok(PALETTE.some(item => item.key === "list-display"));
  assert.ok(PALETTE.some(item => item.key === "set-state"));
  assert.ok(PALETTE.some(item => item.key === "break-loop"));
  assert.ok(PALETTE.some(item => item.key === "set-list-item"));
  assert.ok(PALETTE.some(item => item.key === "make-list"));
  assert.ok(findPaletteItems("値を加工").some(item => item.key === "transform"));
});

test("untrusted JSON objects cannot crash preview or emitted filter/sort comparisons", () => {
  const unsafe = JSON.parse('{"toString":"not callable","valueOf":"not callable"}');
  const rows = [{ meta: unsafe, id: "10" }, { meta: "safe", id: "2" }];
  const filter = { kind: "filter" as const, conds: [
    { field: "meta", op: "eq" as const, value: "[object Object]" },
  ] };
  assert.deepEqual(filterItems(rows, [filter]), [], "object values are never equal to display strings");
  assert.doesNotThrow(() => compareValues(unsafe, "safe"));
  assert.equal(compareValues(unsafe, unsafe), 0);
  const predicate = filterPredicate([filter], "vars");
  assert.ok(predicate);
  const evaluate = new Function("item", "vars", "lookupVar", "interpolate", `return (${predicate});`);
  assert.equal(evaluate(rows[0], {}, lookupVar, interpolate), false);
  assert.equal(evaluate(rows[1], {}, lookupVar, interpolate), false);
  const sort = listItemsExpr({ from: "rows" }, "vars", "rows",
    [{ kind: "sort", field: "meta", dir: "asc" }]);
  const rendered = new Function("vars", "toItems", "lookupVar", `return (${sort});`);
  const sorted = rendered({ rows }, (value: unknown) => value, lookupVar);
  assert.deepEqual(sorted, [...rows].sort((a, b) => compareValues(a.meta, b.meta)));
  // Nested array text also matches scalar-filter equality semantics.
  const nested = [{ meta: [[1, 2], [3, 4]] }];
  assert.deepEqual(filterItems(nested, [{ kind: "filter", conds: [
    { field: "meta", op: "eq", value: "1,2,3,4" },
  ] }]), [], "nested lists require structural rather than string equality");
});

test("generated list filters and sorting expressions pass strict TypeScript checking", () => {
  const ops = [
    { kind: "filter" as const, conds: [{ field: "meta", op: "contains" as const, value: "A" }] },
    { kind: "sort" as const, field: "meta", dir: "asc" as const },
  ];
  const expression = listItemsExpr({ from: "rows" }, "vars", "rows", ops);
  const source = `
type Item = Record<string, unknown>;
type Vars = Record<string, unknown>;
declare const vars: Vars;
declare function lookupVar(vars: Vars, key: string): unknown;
declare function interpolate(value: string, vars: Vars): string;
declare function toItems(value: unknown): Item[];
const filtered: Item[] = ${expression};
`;
  // TypeScript 7 uses the native CLI instead of exposing the old JS compiler
  // API. Check the emitted expression through the actual project compiler.
  const folder = mkdtempSync(join(tmpdir(), "tsumu-generated-filter-"));
  try {
    const sourceFile = join(folder, "generated.ts");
    writeFileSync(sourceFile, source, "utf8");
    try {
      execFileSync(resolve(process.cwd(), "node_modules/.bin/tsc"), [
        "--ignoreConfig", "--noEmit", "--strict", "--skipLibCheck", "--target", "es2022",
        "--lib", "es2022", sourceFile,
      ], { cwd: process.cwd(), encoding: "utf8" });
    } catch (cause) {
      const error = cause as { stdout?: string; stderr?: string; message?: string };
      assert.fail("Generated TypeScript failed:\\n" +
        (error.stdout ?? "") + (error.stderr ?? "") + (error.message ?? ""));
    }
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("generated list filter expressions use only own JSON fields", () => {
  const inherited = String(({} as { constructor: unknown }).constructor);
  const filter = { kind: "filter" as const, conds: [
    { field: "constructor", op: "eq" as const, value: inherited },
  ] };
  const expected = filterItems([{}, { constructor: inherited }], [filter]);
  assert.deepEqual(expected, [{ constructor: inherited }]);
  const predicate = filterPredicate([filter], "vars");
  assert.ok(predicate);
  const evaluate = new Function("item", "vars", "lookupVar", "interpolate", `return (${predicate});`);
  assert.equal(evaluate({}, {}, lookupVar, interpolate), false);
  assert.equal(evaluate({ constructor: inherited }, {}, lookupVar, interpolate), true);
});

test("blank list-filter rows do not collapse preceding OR boundaries", () => {
  const step: Extract<ScriptStep, { kind: "list-display" }> = {
    id: "filter-gap", kind: "list-display", mode: "filter", array: "rows",
    field: "name", op: "eq", value: "red", dir: "asc",
    or: [
      { field: "", op: "eq", value: "", and: false },
      { field: "active", op: "eq", value: "yes", and: true },
    ],
  };
  const conditions = filterConds(step);
  assert.equal(conditions.length, 2);
  assert.equal(conditions[1].and, false, "OR survives an unfinished field in the preceding row");
  const items = [
    { name: "red", active: "no" },
    { name: "blue", active: "yes" },
    { name: "blue", active: "no" },
  ];
  const filter = { kind: "filter" as const, conds: conditions };
  assert.deepEqual(filterItems(items, [filter]), items.slice(0, 2));
  const compiled = filterPredicate([filter], "vars");
  assert.ok(compiled);
  const evalFilter = new Function("item", "vars", "lookupVar", "interpolate", `return (${compiled});`);
  assert.deepEqual(items.filter((item) => evalFilter(item, {}, lookupVar, interpolate)), items.slice(0, 2));
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

test("if blocks and display filters agree for missing, null and list-valued fields", () => {
  const items = [
    { name: "A", tags: ["x", "y"] }, { name: "" },
    { id: 3 }, { name: null }, { name: "B" },
  ];
  const criteria = [
    { field: "name", op: "empty" as const, value: "" },
    { field: "name", op: "eq" as const, value: "A", not: true },
    { field: "tags", op: "contains" as const, value: "x" },
  ];
  for (const condition of criteria) {
    const expected = filterItems(items, [{ kind: "filter", conds: [condition] }]);
    const vars: Record<string, unknown> = { items, result: [] };
    const steps: ScriptStep[] = [
      { id: "each", kind: "for-each", array: "items", then: [
        { id: "condition", kind: "if", cond: {
          subject: "var", target: "", left: "{ループ.値." + condition.field + "}",
          op: condition.op, value: condition.value, not: condition.not,
        }, then: [
          { id: "add", kind: "set-list-item", list: "result", key: "", value: "{ループ.値}" },
        ] },
      ] },
    ];
    assert.equal(runPurePageSteps(steps, vars, lookupVar, interpolate, evaluateValueRecipe), true);
    assert.deepEqual(vars.result, expected, JSON.stringify(condition));
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

test("if blocks group AND before OR and work in server-side page-load execution", () => {
  const cases = [
    { first: "yes", second: "no", third: "yes", expected: "accepted" },
    { first: "yes", second: "no", third: "no", expected: "rejected" },
    { first: "no", second: "no", third: "yes", expected: "accepted" },
    { first: "yes", second: "yes", third: "no", expected: "accepted" },
  ];
  for (const input of cases) {
    const vars: Record<string, unknown> = { ...input };
    const steps: ScriptStep[] = [{
      kind: "if", id: "compound-if",
      cond: { subject: "var", target: "", left: "{first}", op: "eq", value: "yes" },
      conditions: [
        { subject: "var", target: "", left: "{second}", op: "eq", value: "yes", and: true },
        { subject: "var", target: "", left: "{third}", op: "eq", value: "no", not: true, and: false },
      ],
      then: [{ kind: "set-var", id: "then", into: "result", value: "accepted" }],
      else: [{ kind: "set-var", id: "else", into: "result", value: "rejected" }],
    }];
    assert.equal(runPurePageSteps(steps, vars, lookupVar, interpolate, evaluateValueRecipe), true);
    assert.equal(vars.result, input.expected);
  }
  const doc = scriptDataPickerDoc();
  doc.pages.p.pageScripts![0].steps.push({
    id: "server-if", kind: "if",
    cond: { subject: "var", target: "", left: "{data.price}", op: "gte", value: "10" },
    conditions: [
      { subject: "var", target: "", left: "{data.name}", op: "eq", value: "Product", and: true },
      { subject: "var", target: "", left: "{data.price}", op: "eq", value: "5", and: false },
    ],
    then: [{ id: "true-result", kind: "set-var", into: "check", value: "yes" }],
    else: [{ id: "false-result", kind: "set-var", into: "check", value: "no" }],
  });
  const plan = pagePlan(doc, "p");
  assert.ok(plan.serverIds.has("server-if"));
  assert.equal(previewDataVars(doc, "p").check, "yes");
  const files = generateProject(doc).files;
  assert.match(files["app/page.tsx"], /"conditions"/);
  assert.doesNotThrow(() => transformSync(files["app/page.tsx"], { loader: "tsx", jsx: "automatic" }));
});

test("cloning and renaming scripts preserve every joined if condition", () => {
  const doc = scriptDataPickerDoc();
  const original: ScriptStep = {
    id: "nested-if", kind: "if",
    cond: { subject: "var", target: "", left: "{old.score}", op: "gte", value: "10" },
    conditions: [
      { subject: "var", target: "", left: "{old.name}", op: "eq", value: "yes", and: true },
      { subject: "value", target: "field-id", op: "eq", value: "{old.expected}", and: false },
    ],
    then: [], else: [],
  };
  doc.pages.p.pageScripts![0].steps.push(original);
  const cloned = cloneSteps([original], () => "new-id")[0];
  assert.ok(cloned.kind === "if");
  if (cloned.kind !== "if" || original.kind !== "if") throw new Error("Expected if step");
  assert.notStrictEqual(cloned.conditions, original.conditions);
  assert.deepEqual(cloned.conditions, original.conditions);
  assert.deepEqual(scriptTargetIds({ attrId: "", scripts: [{
    id: "s", trigger: "click", pos: { x: 0, y: 0 }, steps: [original],
  }] }), ["field-id"]);
  renameVarInPage(doc, "p", "old", "current");
  assert.equal(original.cond.left, "{current.score}");
  assert.equal(original.conditions?.[0].left, "{current.name}");
  assert.equal(original.conditions?.[1].value, "{current.expected}");
  const script = compileScripts({ scripts: [{
    id: "s", trigger: "click", pos: { x: 0, y: 0 }, steps: [original],
  }] }, () => "/")[0];
  const serialized = script.steps[0];
  assert.ok(Array.isArray(serialized.conditions));
  assert.equal((serialized.conditions as Array<{ and: boolean }>)[0].and, true);
  assert.equal((serialized.conditions as Array<{ and: boolean }>)[1].and, false);
});

test("incomplete clauses preserve the original OR groups on the server", () => {
  for (const [left, right, expected] of [
    ["yes", "no", "accepted"],
    ["no", "yes", "accepted"],
    ["no", "no", "rejected"],
  ] as const) {
    const vars: Record<string, unknown> = { left, right };
    const steps: ScriptStep[] = [{
      id: "if-with-incomplete-or", kind: "if",
      cond: { subject: "var", target: "", left: "{left}", op: "eq", value: "yes" },
      conditions: [
        { subject: "var", target: "", left: "", op: "eq", value: "", and: false },
        { subject: "var", target: "", left: "{right}", op: "eq", value: "yes", and: true },
      ],
      then: [{ id: "accepted", kind: "set-var", into: "result", value: "accepted" }],
      else: [{ id: "rejected", kind: "set-var", into: "result", value: "rejected" }],
    }];
    assert.equal(runPurePageSteps(steps, vars, lookupVar, interpolate, evaluateValueRecipe), true);
    assert.equal(vars.result, expected);
  }
});

test("incomplete if clauses are neutral until their comparison source is set", () => {
  for (const { status, and, expected } of [
    { status: "ready", and: true, expected: "yes" },
    { status: "ready", and: false, expected: "yes" },
    { status: "waiting", and: true, expected: "no" },
    { status: "waiting", and: false, expected: "no" },
  ]) {
    const vars: Record<string, unknown> = { status };
    const steps: ScriptStep[] = [{
      id: "test-if", kind: "if",
      cond: { subject: "var", target: "", left: "{status}", op: "eq", value: "ready" },
      conditions: [{ subject: "var", target: "", left: "", op: "eq", value: "", and }],
      then: [{ id: "yes", kind: "set-var", into: "result", value: "yes" }],
      else: [{ id: "no", kind: "set-var", into: "result", value: "no" }],
    }];
    assert.equal(runPurePageSteps(steps, vars, lookupVar, interpolate, evaluateValueRecipe), true);
    assert.equal(vars.result, expected);
  }
  const vars: Record<string, unknown> = {};
  const steps: ScriptStep[] = [{
    id: "blank-if", kind: "if",
    cond: { subject: "var", target: "", left: "", op: "eq", value: "", not: true },
    then: [{ id: "bad", kind: "set-var", into: "result", value: "yes" }],
    else: [{ id: "safe", kind: "set-var", into: "result", value: "no" }],
  }];
  assert.equal(runPurePageSteps(steps, vars, lookupVar, interpolate, evaluateValueRecipe), true);
  assert.equal(vars.result, "no");
});

test("if blocks with browser-only additional clauses do not run during SSR", () => {
  const doc = scriptDataPickerDoc();
  doc.pages.p.pageScripts![0].steps.push(
    { id: "client-status", kind: "store-load", key: "status", into: "status" },
    { id: "client-if", kind: "if",
      cond: { subject: "var", target: "", left: "{data.price}", op: "gte", value: "10" },
      conditions: [
        { subject: "var", target: "", left: "{status}", op: "eq", value: "ready", and: true },
      ],
      then: [{ id: "client-out", kind: "set-var", into: "result", value: "yes" }],
    },
    { id: "element-if", kind: "if",
      cond: { subject: "var", target: "", left: "{data.price}", op: "gte", value: "10" },
      conditions: [{ subject: "visible", target: "box", and: true }],
      then: [{ id: "element-out", kind: "set-var", into: "elementResult", value: "yes" }],
    },
  );
  const plan = pagePlan(doc, "p");
  assert.ok(!plan.serverIds.has("client-if"));
  assert.ok(!plan.serverIds.has("element-if"));
});


test("missing field results clear stale values before the fallback recipe", () => {
  const steps: ScriptStep[] = [
    { id: "previous", kind: "set-var", into: "selected", value: "stale" },
    { id: "missing", kind: "transform", source: "records.0", into: "selected",
      transform: { kind: "field", key: "doesNotExist" } },
    { id: "fallback", kind: "transform", source: "selected", into: "selected",
      transform: { kind: "fallback", text: "no match" } },
  ];
  const vars: Record<string, unknown> = { records: [{ name: "first" }] };
  assert.equal(runPurePageSteps(steps, vars, lookupVar, interpolate, evaluateValueRecipe), true);
  assert.equal(vars.selected, "no match");

  const doc = scriptDataPickerDoc();
  doc.pages.p.pageScripts![0].steps.push(
    { id: "saved", kind: "set-var", into: "selected", value: "stale" },
    { id: "read-missing", kind: "transform", source: "data.rows.0", into: "selected",
      transform: { kind: "field", key: "absent" } },
    { id: "fallback-missing", kind: "transform", source: "selected", into: "selected",
      transform: { kind: "fallback", text: "no match" } },
  );
  assert.equal(previewDataVars(doc, "p").selected, "no match");
  const files = generateProject(doc).files;
  assert.match(files["app/page.tsx"], /result\.kind === "missing"/);
  assert.doesNotThrow(() => transformSync(files["app/page.tsx"], { loader: "tsx", jsx: "automatic" }));
});

test("failed numeric transforms preserve earlier values instead of using fallback", () => {
  const steps: ScriptStep[] = [
    { id: "previous", kind: "set-var", into: "selected", value: "original" },
    { id: "bad", kind: "transform", source: "not-a-number", into: "selected",
      transform: { kind: "math", operation: "add", operand: 1 } },
    { id: "fallback", kind: "transform", source: "selected", into: "selected",
      transform: { kind: "fallback", text: "replacement" } },
  ];
  const vars: Record<string, unknown> = { "not-a-number": "invalid" };
  assert.equal(runPurePageSteps(steps, vars, lookupVar, interpolate, evaluateValueRecipe), true);
  assert.equal(vars.selected, "original");
});
test("dynamic JSON field names retain accurate totals for truncated API samples", () => {
  const doc = scriptDataPickerDoc();
  const steps = doc.pages.p.pageScripts![0].steps;
  const fetch = steps[0];
  if (fetch.kind !== "fetch") throw new Error("Expected fetch step");
  fetch.sample = {
    groups: { a: Array.from({ length: 20 }, (_, i) => i), b: [1, 2] },
  };
  fetch.sampleTotals = { "groups.a": 103 };
  steps.push(
    { id: "dynamic-name", kind: "set-var", value: "a", into: "targetKey" },
    { id: "pick-list", kind: "transform", source: "data.groups", into: "picked",
      transform: { kind: "field", key: "{targetKey}" } },
    { id: "count-picked", kind: "transform", source: "picked", into: "actualCount",
      transform: { kind: "length" } },
  );
  assert.equal(previewDataVars(doc, "p").actualCount, 103,
    "a dynamic key must resolve to its source path before sample count correction");
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


test("holiday dictionary rows are built using keyed writes and a list loop", () => {
  const doc = scriptDataPickerDoc();
  const steps = doc.pages.p.pageScripts![0].steps;
  steps.push(
    { id: "holidays-fetch", kind: "fetch", as: "祝日",
      url: "https://holidays-jp.github.io/api/v1/date.json",
      sample: { "2026-11-03": "文化の日", "2026-11-23": "勤労感謝の日" } },
    { id: "today", kind: "set-var", into: "今日の日付", value: "2026-11-23" },
    { id: "todays-holiday", kind: "transform", source: "祝日", into: "今日の祝日",
      transform: { kind: "field", key: "{今日の日付}" } },
    { id: "make-rows", kind: "set-var", into: "祝日一覧", value: "[]" },
    { id: "each-holiday", kind: "for-each", array: "祝日", then: [
      { id: "make-row", kind: "set-var", into: "祝日行", value: "{}" },
      { id: "key", kind: "set-list-item", list: "祝日行", key: "日付", value: "{ループ.キー}" },
      { id: "value", kind: "set-list-item", list: "祝日行", key: "祝日名", value: "{ループ.値}" },
      { id: "append-row", kind: "set-list-item", list: "祝日一覧", key: "", value: "{祝日行}" },
    ] },
  );
  const preview = previewDataVars(doc, "p");
  assert.equal(preview["今日の祝日"], "勤労感謝の日");
  assert.deepEqual(JSON.parse(JSON.stringify(preview["祝日一覧"])), [
    { "日付": "2026-11-03", "祝日名": "文化の日" },
    { "日付": "2026-11-23", "祝日名": "勤労感謝の日" },
  ]);
  assert.ok(pageArrays(doc, "p").some(({ name }) => name === "祝日一覧"));
  const plan = pagePlan(doc, "p");
  assert.ok(plan.serverIds.has("todays-holiday"));
  assert.ok(plan.serverIds.has("each-holiday"));
  const files = generateProject(doc).files;
  assert.ok(files["app/page.tsx"].includes("for-each"));
  assert.doesNotThrow(() => transformSync(files["app/page.tsx"], { loader: "tsx", jsx: "automatic" }));
});

test("renaming variables updates dynamic keys and values in list writes", () => {
  const doc = scriptDataPickerDoc();
  const steps = doc.pages.p.pageScripts![0].steps;
  steps.push(
    { id: "init-rows", kind: "set-var", into: "rows", value: "{}" },
    { id: "rename-key", kind: "set-list-item", list: "rows",
      key: "{labels.keyName}", value: "{labels.valueName}" },
  );
  renameVarInPage(doc, "p", "labels", "displayLabels");
  const renamed = steps.find((step) => step.id === "rename-key");
  assert.equal(renamed?.kind, "set-list-item");
  if (!renamed || renamed.kind !== "set-list-item") throw new Error("Expected keyed write");
  assert.equal(renamed.key, "{displayLabels.keyName}");
  assert.equal(renamed.value, "{displayLabels.valueName}");
});

test("browser-only list key variables keep their write outside SSR", () => {
  const doc = scriptDataPickerDoc();
  doc.pages.p.pageScripts![0].steps.push(
    { id: "dynamic-column", kind: "store-load", key: "chosen-field", into: "keyName" },
    { id: "init-rows", kind: "set-var", into: "rows", value: "{}" },
    { id: "client-write", kind: "set-list-item", list: "rows", key: "{keyName}", value: "42" },
  );
  const plan = pagePlan(doc, "p");
  assert.ok(!plan.serverIds.has("client-write"));
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


test("if block operands can refer to another variable", () => {
  const doc = scriptDataPickerDoc();
  doc.pages.p.pageScripts![0].steps.push(
    { id: "threshold", kind: "set-var", value: "{data.price}", into: "threshold" },
    { id: "cmp", kind: "if",
      cond: { subject: "var", target: "", left: "{data.price}", op: "gte", value: "{threshold}" },
      then: [{ id: "yes", kind: "set-var", into: "above", value: "true" }],
      else: [{ id: "no", kind: "set-var", into: "above", value: "false" }],
    },
  );
  const result = previewDataVars(doc, "p");
  assert.equal(result.threshold, 12);
  assert.equal(result.above, true);
});

test("server preview calculates with numeric strings and filters lists through loops", () => {
  const doc = scriptDataPickerDoc();
  doc.pages.p.pageScripts![0].steps.push(
    { id: "rate", kind: "set-var", value: "1.5", into: "rate" },
    { id: "calc", kind: "transform", source: "data.price", into: "total",
      transform: { kind: "math", operation: "multiply", operandType: "variable", operand: "rate" } },
    { id: "append", kind: "transform", source: "data.tags", into: "tags",
      transform: { kind: "append", operandType: "text", operand: "green" } },
    { id: "empty-tags", kind: "set-var", value: "[]", into: "filteredTags" },
    { id: "filter-tags", kind: "for-each", array: "tags", then: [
      { id: "keep", kind: "if", cond: {
        subject: "var", target: "", left: "{ループ.値}", op: "eq", value: "red", not: true,
      }, then: [{ id: "add-tag", kind: "set-list-item", list: "filteredTags", key: "", value: "{ループ.値}" }] },
    ] },
  );
  const vars = previewDataVars(doc, "p");
  assert.equal(vars.total, 18);
  assert.deepEqual(vars.filteredTags, ["blue", "green"]);
  const plan = pagePlan(doc, "p");
  assert.ok(plan.serverIds.has("calc"));
  assert.ok(plan.serverIds.has("append"));
  assert.ok(plan.serverIds.has("filter-tags"));
  const generated = generateProject(doc).files["app/page.tsx"];
  assert.match(generated, /"append"/);
  assert.match(generated, /"for-each"/);
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
        cond: { subject: "var", target: "", left: "{enabled}", op: "eq", value: '\"true\"' },
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
