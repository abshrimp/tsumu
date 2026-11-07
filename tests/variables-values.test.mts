import { describe, before, test } from "node:test";
import assert from "node:assert/strict";
import { systemTimeValues, systemVariable, SYSTEM_TIME_VARIABLE_NAMES, SYSTEM_BROWSER_VARIABLE_NAMES, SYSTEM_RANDOM_VARIABLE_NAMES } from "../lib/system-time";
import { interpolate, lookupVar, VARS_RUNTIME, varText, isVarListShortcut, KEEP_ESCAPES, interpolateJson, interpolateUrl } from "../lib/vars";
import * as dataHelpers from "../lib/data";
import { varGroupsAt as varGroupsAt_2, varNamesAt as varNamesAt_2, obfuscateVarNames, pagePlan, previewDataVars as previewDataVars_2, compareValues, flattenFields, pageVariableIndex, setVarSource } from "../lib/data";
import { createInitialDoc, makeText as makeText_2 } from "../lib/presets";
import { matchesValueCondition, parseValueLiteral } from "../lib/value-semantics";
import { PAGE_STEP_RUNNER_SOURCE, runPurePageSteps } from "../lib/page-load-steps";
import { evaluateValueRecipe } from "../lib/script-model/recipe-runtime";
import { generateProject as generateProject_2 } from "../lib/generator";
import { validDocumentScripts } from "../lib/document-validation";
import { type ScriptStep } from "../lib/types";
import { nativeDataModule } from "../lib/generator/native-data";
import { defaultTransform, type ValueTransform } from "../lib/script-model/compose";
import { runInNewContext } from "node:vm";
import { transformSync } from "./helpers/bundle";
import ts from "@typescript/typescript6";
import { SCRIPT_RUNTIME as SCRIPT_RUNTIME_2 } from "../lib/script-runtime";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import * as React_2 from "react";
import * as React_3 from "react";
import { useEditor } from "../lib/store";
import { varExplorerDoc } from "./helpers/var-explorer";
import { canPickVariable, localVariableNames, variableChoiceSamples, singleValueReference } from "../lib/variable-choice";
import { scriptDataPickerDoc as scriptDataPickerDoc_2 } from "./helpers/script-data-picker";
import * as contexts from "../components/script-editor/context";
import { PAGE_DATA_RUNTIME } from "../lib/generator/browser-data";

describe("system-time", () => {
test("system time variables provide local time, UTC ISO, Unix seconds and components", () => {
  const at = new Date("2026-11-16T03:04:05.123Z");
  const values = systemTimeValues(at);
  assert.equal(values.iso, "2026-11-16T03:04:05.123Z");
  assert.equal(values.unix, Math.floor(at.getTime() / 1000));
  assert.equal(values.timestamp, at.getTime());
  assert.match(values.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(values.time, /^\d{2}:\d{2}:\d{2}$/);
  assert.equal(systemVariable("system.iso", at), values.iso);
  assert.deepEqual(systemVariable("system", at), values);
  assert.equal(systemVariable("system.missing", at), undefined);
});

test("time is resolved at use time instead of being stored in the document", () => {
  const before = Date.now();
  const stamp = lookupVar({}, "system.timestamp");
  assert.equal(typeof stamp, "number");
  assert.ok((stamp as number) >= before && (stamp as number) <= Date.now());
  assert.match(interpolate("{system.date} {system.time}", {}), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  assert.equal(lookupVar({ system: { date: "overridden" } }, "system.date") === "overridden", false);
});

test("random values have documented types, boundaries, and are generated per read", () => {
  const previous = Math.random;
  try {
    Math.random = () => 0;
    assert.equal(systemVariable("system.random"), 0);
    assert.equal(systemVariable("system.randomInt"), 1);
    assert.equal(systemVariable("system.randomBoolean"), true);
    Math.random = () => 0.999999999;
    assert.ok((systemVariable("system.random") as number) < 1);
    assert.equal(systemVariable("system.randomInt"), 100);
    assert.equal(systemVariable("system.randomBoolean"), false);
    Math.random = () => 0.4;
    assert.equal(lookupVar({}, "system.randomInt"), 41);
  } finally {
    Math.random = previous;
  }
  const uuid = systemVariable("system.uuid");
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    assert.match(uuid as string, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  } else assert.equal(uuid, undefined);
});

test("advanced picker contains all built-ins, without mixing them into normal suggestions", () => {
  const doc = createInitialDoc();
  const pageId = doc.pageOrder[0];
  const groups = varGroupsAt_2(doc, pageId, "");
  const builtin = groups.filter((group) => group.key === "system");
  assert.equal(builtin.length, 3);
  assert.ok(builtin.every((group) => group.advanced === true));
  const fields = new Set(builtin.flatMap((group) => Object.keys(group.vars)));
  for (const name of [
    ...SYSTEM_TIME_VARIABLE_NAMES, ...SYSTEM_BROWSER_VARIABLE_NAMES, ...SYSTEM_RANDOM_VARIABLE_NAMES,
  ]) assert.ok(fields.has(name), name);
  assert.ok(!varNamesAt_2(doc, pageId, "").some((name) => name.startsWith("system.")));
});

test("browser-only variables are undefined without a DOM, but timezone is available", () => {
  assert.equal(typeof systemVariable("system.browser.timeZone"), "string");
  assert.equal(systemVariable("system.page.url"), undefined);
  assert.equal(systemVariable("system.viewport.width"), undefined);
});
});

describe("value-list-unification", () => {
const run = (steps: ScriptStep[], vars: Record<string, unknown>) =>
  runPurePageSteps(steps, vars, lookupVar, interpolate, evaluateValueRecipe);

test("list contains searches values, while has-key only checks own keys", () => {
  const dictionary = { apple: 100, banana: "200", orange: { price: 300 } };
  assert.equal(matchesValueCondition(dictionary, "contains", 100), true);
  assert.equal(matchesValueCondition(dictionary, "contains", "100"), true);
  assert.equal(matchesValueCondition(dictionary, "contains", "apple"), false);
  assert.equal(matchesValueCondition(dictionary, "has-key", "apple"), true);
  assert.equal(matchesValueCondition(dictionary, "has-key", "100"), false);
  assert.equal(matchesValueCondition(dictionary, "has-key", "constructor"), false);
  assert.equal(matchesValueCondition(dictionary, "contains", { price: 300 }), true);
  const list = ["a", "b", "c"];
  assert.equal(matchesValueCondition(list, "contains", "b"), true);
  assert.equal(matchesValueCondition(list, "contains", "0"), false);
  assert.equal(matchesValueCondition(list, "has-key", "0"), true);
  assert.equal(matchesValueCondition(list, "has-key", "3"), false);
  assert.equal(matchesValueCondition(list, "has-key", "length"), false);
});

test("value checks equate exact scalar text while retaining other type boundaries", () => {
  assert.equal(matchesValueCondition(100, "eq", "100"), true);
  assert.equal(matchesValueCondition(true, "eq", "true"), true);
  assert.equal(matchesValueCondition("false", "eq", false), true);
  assert.equal(matchesValueCondition(100, "eq", "0100"), false);
  assert.equal(matchesValueCondition(100, "eq", "1e2"), false);
  assert.equal(matchesValueCondition(false, "eq", 0), false);
  assert.equal(matchesValueCondition(0, "eq", false), false);
  assert.equal(matchesValueCondition(null, "eq", ""), false);
  assert.equal(matchesValueCondition(undefined, "eq", ""), false);
  assert.equal(matchesValueCondition(100, "in", "0100, 100"), true);
  assert.equal(matchesValueCondition(100, "in", "0100, 1e2"), false);
  assert.equal(matchesValueCondition({ x: 1, ok: true }, "eq", { x: "1", ok: "true" }), true);
  assert.equal(matchesValueCondition([1, false, null], "contains", "1"), true);
  assert.equal(matchesValueCondition("12", "gt", 2), true);
  assert.equal(matchesValueCondition(true, "gt", 0), false);
  assert.equal(matchesValueCondition(null, "empty", ""), true);
  assert.equal(matchesValueCondition(false, "empty", ""), false);
  assert.equal(matchesValueCondition([], "empty", ""), true);
  assert.equal(matchesValueCondition({}, "empty", ""), true);
  assert.equal(matchesValueCondition({ "0": "a" }, "eq", ["a"]), true);
  assert.equal(matchesValueCondition({ a: 1, b: 2 }, "eq", { b: 2, a: 1 }), true);
});

test("literal input preserves JSON shape and leading zeros", () => {
  for (const [source, expected] of [
    ["12", 12], ["true", true], ["null", null], ['"0012"', "0012"],
    ["0012", "0012"], ["[1,2]", [1, 2]], ['{"a":1}', { a: 1 }],
    ["hello", "hello"],
  ] as const) assert.deepEqual(parseValueLiteral(source), expected);
});

test("dictionary loops expose key/value/index and support keyed output writes", () => {
  const vars: Record<string, unknown> = { prices: { apple: 100, banana: 200 } };
  const steps: ScriptStep[] = [
    { id: "init", kind: "set-var", into: "result", value: "{}" },
    { id: "each", kind: "for-each", array: "prices", then: [
      { id: "write", kind: "set-list-item", list: "result", key: "{ループ.キー}", value: "{ループ.値}" },
    ] },
  ];
  assert.equal(run(steps, vars), true);
  assert.deepEqual(JSON.parse(JSON.stringify(vars.result)), { apple: 100, banana: 200 });
  assert.deepEqual(vars.prices, { apple: 100, banana: 200 });
});

test("list loops process nested and null values", () => {
  const vars: Record<string, unknown> = { source: [null, [1, 2], { ok: true }] };
  const steps: ScriptStep[] = [
    { id: "init", kind: "set-var", into: "result", value: "[]" },
    { id: "each", kind: "for-each", array: "source", then: [
      { id: "write", kind: "set-list-item", list: "result", key: "", value: "{ループ.値}" },
    ] },
  ];
  assert.equal(run(steps, vars), true);
  assert.deepEqual(vars.result, [null, [1, 2], { ok: true }]);
});

test("removing by value deletes every equal entry and preserves the original list", () => {
  const initial = [1, "1", true, null, { deep: [1, null] }, { deep: ["1", null] }, "keep"];
  const vars: Record<string, unknown> = { items: initial };
  assert.equal(run([
    { id: "remove-one", kind: "remove-list-item", list: "items", mode: "value", value: "1" },
    { id: "remove-object", kind: "remove-list-item", list: "items", mode: "value", value: '{"deep":[1,null]}' },
    { id: "remove-null", kind: "remove-list-item", list: "items", mode: "value", value: "null" },
  ], vars), true);
  assert.deepEqual(vars.items, [true, "keep"]);
  assert.deepEqual(initial, [1, "1", true, null, { deep: [1, null] }, { deep: ["1", null] }, "keep"]);
});

test("removing by position uses zero-based indices and closes array gaps", () => {
  const original = ["a", "b", "c", "d"];
  const vars: Record<string, unknown> = { source: { rows: original }, index: 1 };
  assert.equal(run([
    { id: "by-position", kind: "remove-list-item", list: "source.rows", mode: "key", value: "{index}" },
  ], vars), true);
  assert.deepEqual(vars.source, { rows: ["a", "c", "d"] });
  assert.deepEqual(original, ["a", "b", "c", "d"]);
  const saved = JSON.stringify(vars.source);
  for (const key of ["-1", "10", "1.5", '"01"', "{missing}"]) {
    assert.equal(run([{ id: "bad", kind: "remove-list-item", list: "source.rows", mode: "key", value: key }], vars), true);
    assert.equal(JSON.stringify(vars.source), saved, "invalid positions must be no-ops");
  }
});

test("page-load list edits write back to the list selected through a last-item reference", () => {
  const vars = { data: [{ rows: ["first"] }, { rows: ["A", "B"] }] };
  assert.equal(run([
    { id: "remove", kind: "remove-list-item", list: "data.-1.rows", mode: "key", value: "0" },
    { id: "append", kind: "set-list-item", list: "data.-1.rows", key: "", value: "C" },
  ], vars), true);
  assert.deepEqual(vars.data, [{ rows: ["first"] }, { rows: ["B", "C"] }]);
});

test("dictionary removal accepts own keys or matching values without prototype traversal", () => {
  const initial = JSON.parse('{"__proto__":7,"constructor":8,"a":2,"b":"2","c":null}');
  const vars: Record<string, unknown> = { entries: initial };
  assert.equal(run([
    { id: "by-value", kind: "remove-list-item", list: "entries", mode: "value", value: "2" },
    { id: "by-key", kind: "remove-list-item", list: "entries", mode: "key", value: "__proto__" },
    { id: "by-null", kind: "remove-list-item", list: "entries", mode: "value", value: "null" },
  ], vars), true);
  assert.deepEqual(JSON.parse(JSON.stringify(vars.entries)), { constructor: 8 });
  assert.equal(Object.getPrototypeOf(vars.entries), null);
  assert.equal(Object.hasOwn(initial, "__proto__"), true);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
  assert.equal(run([{ id: "inherited", kind: "remove-list-item", list: "entries", mode: "key", value: "toString" }], vars), true);
  assert.deepEqual(JSON.parse(JSON.stringify(vars.entries)), { constructor: 8 });
});

test("removal works in the serialized page runner and is allowed in page-load scripts", () => {
  const steps: ScriptStep[] = [
    { id: "seed", kind: "set-var", into: "items", value: '["x","y","x"]' },
    { id: "remove", kind: "remove-list-item", list: "items", mode: "value", value: '"x"' },
  ];
  const emitted = new Function("const __name = fn => fn; return " + PAGE_STEP_RUNNER_SOURCE)() as typeof runPurePageSteps;
  for (const runner of [runPurePageSteps, emitted]) {
    const vars: Record<string, unknown> = {};
    assert.equal(runner(steps, vars, lookupVar, interpolate, evaluateValueRecipe), true);
    assert.deepEqual(vars.items, ["y"]);
  }
  const doc = createInitialDoc();
  const pageId = doc.pageOrder[0];
  doc.pages[pageId].pageScripts = [
    { id: "load", trigger: "load", steps },
  ];
  assert.ok(pagePlan(doc, pageId).serverIds.has("remove"));
  const generated = generateProject_2(doc).files["app/page.tsx"];
  assert.match(generated, /__runPurePageSteps/);
  assert.match(generated, /remove-list-item/);
});

test("list removal validates its method instead of accepting unknown step shapes", () => {
  const step = { id: "remove", kind: "remove-list-item", list: "items", mode: "value", value: "10" };
  const asScripts = (item: object) => [
    { id: "script", trigger: "click", steps: [item] },
  ];
  assert.equal(validDocumentScripts(asScripts(step)), true);
  assert.equal(validDocumentScripts(asScripts({ ...step, mode: "unknown" })), false);
  assert.equal(validDocumentScripts(asScripts({ ...step, value: 10 })), false);
});

test("break exits only the closest loop and continues subsequent steps", () => {
  const vars: Record<string, unknown> = { source: [5, 10, 15] };
  const steps: ScriptStep[] = [
    { id: "init", kind: "set-var", into: "found", value: "[]" },
    { id: "loop", kind: "for-each", array: "source", then: [
      { id: "if", kind: "if", cond: { subject: "var", target: "", left: "{ループ.値}", op: "gte", value: "10" }, then: [
        { id: "push", kind: "set-list-item", list: "found", key: "", value: "{ループ.値}" },
        { id: "break", kind: "break-loop" },
      ] },
    ] },
    { id: "after", kind: "set-var", into: "after", value: "true" },
  ];
  assert.equal(run(steps, vars), true);
  assert.deepEqual(vars.found, [10]);
  assert.equal(vars.after, true);
});

test("repeat loop captures its iteration index and can be broken", () => {
  const vars: Record<string, unknown> = {};
  const steps: ScriptStep[] = [
    { id: "init", kind: "set-var", into: "indices", value: "[]" },
    { id: "outer", kind: "repeat", times: 3, then: [
      { id: "inner", kind: "repeat", times: 10, then: [
        { id: "add", kind: "set-list-item", list: "indices", key: "", value: "{ループ.外側.順番}" },
        { id: "break", kind: "break-loop" },
      ] },
    ] },
  ];
  assert.equal(run(steps, vars), true);
  assert.deepEqual(vars.indices, [0, 1, 2]);
});

test("break outside of a loop cannot silently affect page-data evaluation", () => {
  const vars: Record<string, unknown> = {};
  assert.equal(run([{ id: "break", kind: "break-loop" }], vars), false);
  assert.deepEqual(vars, {});
});

test("keyed array writes cannot create holes or mutate original data", () => {
  const source = [1, 2];
  const vars: Record<string, unknown> = { source };
  assert.equal(run([{ id: "write", kind: "set-list-item", list: "source", key: "2", value: "3" }], vars), true);
  assert.deepEqual(vars.source, [1, 2, 3]);
  assert.deepEqual(source, [1, 2]);
  assert.equal(run([{ id: "bad", kind: "set-list-item", list: "source", key: "1000000", value: "4" }], vars), true);
  assert.deepEqual(vars.source, [1, 2, 3]);
});

test("nested loops read list values from the enclosing item without dropping their keys", () => {
  const vars: Record<string, unknown> = {
    catalogue: {
      fruit: { tags: ["red", "sweet"] },
      vegetable: { tags: ["green"] },
    },
  };
  const steps: ScriptStep[] = [
    { id: "init", kind: "set-var", into: "colours", value: "[]" },
    { id: "outer", kind: "for-each", array: "catalogue", then: [
      { id: "inner", kind: "for-each", array: "ループ.値.tags", then: [
        { id: "add", kind: "set-list-item", list: "colours", key: "", value: "{ループ.値}" },
      ] },
    ] },
  ];
  assert.equal(run(steps, vars), true);
  assert.deepEqual(vars.colours, ["red", "sweet", "green"]);
});

test("export obfuscation preserves list targets and loop variable references", () => {
  const doc = createInitialDoc();
  const page = doc.pages[doc.pageOrder[0]];
  page.pageScripts = [{ id: "source", trigger: "load", steps: [
    { id: "numbers", kind: "set-var", value: "[1,2]", into: "numbers" },
    { id: "result", kind: "set-var", value: "[]", into: "result" },
    { id: "each", kind: "for-each", array: "numbers", then: [
      { id: "add", kind: "set-list-item", list: "result", key: "", value: "{ループ.値}" },
    ] },
  ] }];
  const exported = obfuscateVarNames(doc);
  const [numbers, result, each] = exported.pages[page.id].pageScripts![0].steps;
  assert.equal(numbers.kind, "set-var");
  assert.equal(result.kind, "set-var");
  assert.equal(each.kind, "for-each");
  if (numbers.kind !== "set-var" || result.kind !== "set-var" || each.kind !== "for-each")
    throw new Error("Unexpected script shape");
  assert.equal(each.array, numbers.into);
  const write = each.then[0];
  assert.equal(write.kind, "set-list-item");
  if (write.kind !== "set-list-item") throw new Error("Expected list item write");
  assert.equal(write.list, result.into);
  assert.equal(write.value, "{ループ.値}");
  assert.notEqual(result.into, "result");
});

test("native exported list rendering accepts dictionary keys and preserves nested values", async () => {
  const uri = "data:text/javascript;base64," + Buffer.from(nativeDataModule()).toString("base64");
  const { listItemsWithOps } = await import(uri);
  const result = listItemsWithOps(undefined, {
    rows: { apple: { title: "Apple" }, banana: 2, empty: null, nested: [1, 2] },
  }, "rows", 0);
  assert.deepEqual(result, [
    { title: "Apple" }, { "値": 2 }, { "値": null }, { "値": [1, 2] },
  ]);
  assert.deepEqual(listItemsWithOps(undefined, { rows: ["a", "b"] }, "rows", 1), [{ "値": "a" }]);
});

test("at the size limit dictionaries still allow updates to existing keys", () => {
  const list = Object.fromEntries(Array.from({ length: 10000 }, (_, i) => [String(i), i]));
  const vars = { list };
  const set = (key: string) => run([{ id: "write", kind: "set-list-item", list: "list", key, value: "true" }], vars);
  assert.equal(set("0"), true);
  assert.equal(vars.list["0"], true);
  assert.equal(set("extra"), true);
  assert.equal(Object.hasOwn(vars.list, "extra"), false);
  assert.equal(list["0"], 0);
});

test("page scripts reject list values that would expand exponentially when published", () => {
  const vars: Record<string, unknown> = {};
  const steps: ScriptStep[] = [
    { id: "seed", kind: "set-var", into: "value", value: "{}" },
    { id: "double", kind: "repeat", times: 28, then: [
      { id: "old", kind: "set-var", into: "old", value: "{value}" },
      { id: "new", kind: "set-var", into: "value", value: "{}" },
      { id: "left", kind: "set-list-item", list: "value", key: "a", value: "{old}" },
      { id: "right", kind: "set-list-item", list: "value", key: "b", value: "{old}" },
    ] },
  ];
  // 悪意のある結果を、テストの中で決して直列化しない。
  assert.equal(run(steps, vars), false);
  assert.deepEqual(Object.keys(vars), []);
  const emitted = new Function("const __name = fn => fn; return " + PAGE_STEP_RUNNER_SOURCE)() as typeof runPurePageSteps;
  assert.equal(emitted(steps, vars, lookupVar, interpolate, evaluateValueRecipe), false);
  assert.deepEqual(Object.keys(vars), []);
});

test("page script writes update nested data and preserve existing literal dotted keys", () => {
  const before = { enabled: false };
  const vars: Record<string, unknown> = { settings: before, "literal.key": 0 };
  assert.equal(run([
    { id: "set", kind: "set-var", into: "settings.enabled", value: "true" },
    { id: "literal", kind: "set-var", into: "literal.key", value: "1" },
  ], vars), true);
  assert.deepEqual(vars.settings, { enabled: true });
  assert.equal(before.enabled, false);
  assert.equal(Object.hasOwn(vars, "settings.enabled"), false);
  assert.equal(vars["literal.key"], 1);
});

test("preview removes from the latest fetched list and preserves sibling fields on nested writes", async () => {
  const { SCRIPT_RUNTIME } = await import("../lib/script-runtime");
  const { listRuntimeDom } = await import("./helpers/list-runtime-dom");
  const state = { data: { rows: ["sample"], title: "Sample" } };
  const action = [{ trigger: "click", steps: [
    { kind: "remove-list-item", mode: "key", list: "data.rows", value: "0" },
  ] }];
  const dom = listRuntimeDom(`<button id="act" data-scripts='${JSON.stringify(action)}'>Remove</button>`,
    `(${SCRIPT_RUNTIME})({ ...env, getPageData: () => state }).install(document)`, { state });
  state.data = { rows: ["full one", "full two", "full three"], title: "Current" };
  await dom.click("act");
  assert.deepEqual(JSON.parse(JSON.stringify(dom.vars.data)), { rows: ["full two", "full three"], title: "Current" });
  await dom.click("act");
  assert.deepEqual(JSON.parse(JSON.stringify(dom.vars.data)), { rows: ["full three"], title: "Current" });
  assert.deepEqual(state.data.rows, ["full one", "full two", "full three"]);
});

test("preview terminates and chains copies into nested variable paths", () => {
  const doc = createInitialDoc();
  const page = doc.pages[doc.pageOrder[0]];
  page.pageScripts = [
    { id: "load", trigger: "load", steps: [
      { id: "seed", kind: "fetch", as: "source", url: "https://example.test/source",
        preview: { sample: { title: "ready" } } },
      { id: "protected", kind: "fetch", as: "preserve", url: "https://example.test/preserve",
        preview: { sample: { title: "original" } } },
    ] },
    { id: "click", trigger: "click", steps: [
      // Deliberately out of order: the first copy needs a second pass.
      { id: "second", kind: "set-var", into: "record.label", value: "{record.title}" },
      { id: "first", kind: "set-var", into: "record.title", value: "{source.title}" },
      { id: "keep", kind: "set-var", into: "preserve.title", value: "{source.title}" },
      { id: "end", kind: "set-var", into: "result", value: "{record.label}" },
    ] },
  ];
  const preview = previewDataVars_2(doc, page.id);
  assert.deepEqual(preview.record, { title: "ready", label: "ready" });
  assert.equal(preview.result, "ready");
  assert.deepEqual(preview.preserve, { title: "original" });
});
});

describe("value-recipe-ops", () => {
const run = (input: unknown, steps: readonly ValueTransform[]) => evaluateValueRecipe(input, steps);
const val = (value: unknown) => ({ kind: "value", value });

test("every transform kind has a stable, serializable default", () => {
  const kinds: Record<ValueTransform["kind"], true> = {
    field: true, fallback: true, math: true, split: true, replace: true, join: true,
    length: true, sort: true, stringify: true, parse: true,
  };
  for (const kind of Object.keys(kinds) as ValueTransform["kind"][]) {
    const transform = defaultTransform(kind);
    assert.equal(transform.kind, kind);
    assert.doesNotThrow(() => JSON.parse(JSON.stringify(transform)));
  }
});



test("numeric operations accept number-like input, reject invalid coercions, and bound division", () => {
  assert.deepEqual(run(12, [
    { kind: "math", operation: "add", operandType: "number", operand: 8 },
    { kind: "math", operation: "divide", operandType: "number", operand: 4 },
  ]), val(5));
  assert.deepEqual(run("12", [{ kind: "math", operation: "add", operandType: "number", operand: 1 }]), val(13));
  assert.deepEqual(run(true, [{ kind: "math", operation: "add", operandType: "number", operand: 1 }]),
    { kind: "error", code: "type-mismatch" });
  assert.deepEqual(run("abc", [{ kind: "math", operation: "add", operandType: "number", operand: 1 }]),
    { kind: "error", code: "type-mismatch" });
  assert.deepEqual(run(12, [{ kind: "math", operation: "divide", operandType: "number", operand: 0 }]),
    { kind: "error", code: "division-by-zero" });
  assert.deepEqual(run(1e308, [{ kind: "math", operation: "multiply", operandType: "number", operand: 10 }]),
    { kind: "error", code: "limit-exceeded" });
  assert.deepEqual(run(8, [{ kind: "math", operation: "remainder", operandType: "number", operand: 3 }]), val(2));
  assert.deepEqual(run(8, [{ kind: "math", operation: "subtract", operandType: "number", operand: 3 }]), val(5));
});



test("math transforms require an explicit operand type", () => {
  const malformed = { kind: "math", operation: "add", operand: 1 } as ValueTransform;
  assert.deepEqual(run(5, [malformed]), { kind: "error", code: "invalid-recipe" });
  assert.equal(validDocumentScripts([{ id: "s", trigger: "load",    steps: [{ id: "op", kind: "transform", source: "value", into: "value", transform: malformed }] }]), false);
  assert.deepEqual(run(5, [{ kind: "math", operation: "add", operandType: "number", operand: 1 }]), val(6));
});

test("fallback transforms require an explicit missing or nullish policy", () => {
  const malformed = { kind: "fallback", text: "replacement" } as ValueTransform;
  assert.deepEqual(run(undefined, [malformed]), { kind: "error", code: "invalid-recipe" });
  assert.equal(validDocumentScripts([{ id: "s", trigger: "load",    steps: [{ id: "op", kind: "transform", source: "value", into: "value", transform: malformed }] }]), false);
  assert.deepEqual(run(undefined, [{ kind: "fallback", when: "missing", text: "replacement" }]), val("replacement"));
});

test("split, join and replace coerce scalars without coercing lists", () => {
  const items = run(" blue, , red, green ", [{ kind: "split", separator: "," }]);
  assert.deepEqual(items, val(["blue", "red", "green"]));
  assert.deepEqual(run((items as {kind:"value";value:unknown}).value, [{ kind: "join", separator: "/" }]), val("blue/red/green"));
  assert.deepEqual(run([0, false, "a", "", null], [{ kind: "join", separator: "-" }]), val("0-false-a"));
  assert.deepEqual(run([{ name: "A" }], [{ kind: "join", separator: "," }]), { kind: "error", code: "type-mismatch" });
  assert.deepEqual(run("banana", [{ kind: "replace", find: "na", replacement: "X", regex: false }]), val("baXX"));
  assert.deepEqual(run(12345, [{ kind: "split", separator: "3" }]), val(["12", "45"]));
  assert.deepEqual(run(true, [{ kind: "split", separator: "r" }]), val(["t", "ue"]));
  assert.deepEqual(run(12345, [{ kind: "replace", find: "3", replacement: "X", regex: false }]), val("12X45"));
  assert.deepEqual(run(true, [{ kind: "replace", find: "r", replacement: "R", regex: false }]), val("tRue"));
  assert.deepEqual(run(false, [{ kind: "replace", find: "", replacement: "X", regex: false }]), val("false"));
  for (const value of [null, [], { a: 1 }]) {
    assert.deepEqual(run(value, [{ kind: "split", separator: "," }]), { kind: "error", code: "type-mismatch" });
    assert.deepEqual(run(value, [{ kind: "replace", find: "a", replacement: "b", regex: false }]),
      { kind: "error", code: "type-mismatch" });
  }
  assert.deepEqual(run("ab12 cd34", [{ kind: "replace", find: "([a-z]+)(\\d+)", replacement: "$2:$1", regex: true }]), val("12:ab 34:cd"));
  assert.deepEqual(run("a", [{ kind: "replace", find: "(", replacement: "", regex: true }]), { kind: "error", code: "invalid-regex" });
});


test("list paths support direct dotted keys, nested keys, and final array positions", () => {
  const value = {
    meta: { city: "Kyoto", scores: [3, 7] },
    "meta.city": "literal key wins",
    empty: { value: undefined },
  };
  assert.deepEqual(run(value, [{ kind: "field", key: "meta.city" }]), val("literal key wins"));
  assert.deepEqual(run(value, [{ kind: "field", key: "meta.scores.-1" }]), val(7));
  assert.deepEqual(run(value, [{ kind: "field", key: "meta.scores.3" }]), { kind: "missing" });
  assert.deepEqual(run(value, [{ kind: "field", key: "empty.value" }]), { kind: "missing" });
  assert.deepEqual(run(["red", "blue"], [{ kind: "field", key: "1" }]), val("blue"));
  assert.deepEqual(evaluateValueRecipe(undefined, [
    { kind: "fallback", when: "missing", text: "{meta.scores.-1}" },
  ], value), val(7));
});

test("fallback has one operation with missing-only or missing-or-null semantics", () => {
  assert.deepEqual(run(undefined, [{ kind: "fallback", when: "missing", text: "fallback" }]), val("fallback"));
  assert.deepEqual(run(null, [{ kind: "fallback", when: "missing", text: "fallback" }]), val(null));
  assert.deepEqual(run(null, [{ kind: "fallback", text: "fallback", when: "nullish" }]), val("fallback"));
  assert.deepEqual(run(false, [{ kind: "fallback", text: "fallback", when: "nullish" }]), val(false));
  assert.deepEqual(run(0, [{ kind: "fallback", text: "fallback", when: "nullish" }]), val(0));
  assert.deepEqual(evaluateValueRecipe(undefined, [
    { kind: "fallback", when: "missing", text: "Hello {name}" },
  ], { name: "A" }), val("Hello A"));
  assert.deepEqual(evaluateValueRecipe(undefined, [
    { kind: "fallback", when: "missing", text: "{record}" },
  ], { record: { count: 3 } }), val({ count: 3 }));
});

test("text, JSON and list conversion keep original typed data", () => {
  assert.deepEqual(run(123, [{ kind: "stringify" }]), val("123"));
  assert.deepEqual(run({ "0": "a" }, [{ kind: "stringify" }]), val('{"0":"a"}'));
  assert.deepEqual(run('{"0":"a"}', [{ kind: "parse" }]), val({ "0": "a" }));
  assert.deepEqual(run([1, 2], [{ kind: "length" }]), val(2));
  assert.deepEqual(run({ a: 1, b: 2 }, [{ kind: "length" }]), val(2));
});


test("value sort uses natural ordering consistent with displayed list sort", () => {
  const items = [
    { id: "10", label: "item 10" },
    { id: "2", label: "item 2" },
    { id: "1", label: "item 1" },
    { id: "2", label: "item 2 again" },
  ];
  assert.deepEqual(run(items, [{ kind: "sort", field: "id", direction: "asc" }]),
    val([items[2], items[1], items[3], items[0]]));
  assert.deepEqual(run(items, [{ kind: "sort", field: "id", direction: "desc" }]),
    val([items[0], items[1], items[3], items[2]]));
  assert.deepEqual(run(["10", "2", "1"], [{ kind: "sort", field: "", direction: "asc" }]),
    val(["1", "2", "10"]));
  assert.deepEqual(run([10, 2, 1], [{ kind: "sort", field: "", direction: "asc" }]),
    val([1, 2, 10]));
});

test("dictionary sorting preserves named keys as ordered key-value rows", () => {
  const source = {
    apple: { price: 10 }, banana: { price: 30 }, orange: { price: 20 },
  };
  const output = evaluateValueRecipe(source, [{ kind: "sort", field: "price", direction: "desc" }]);
  assert.deepEqual(output, val([
    { "キー": "banana", "値": source.banana },
    { "キー": "orange", "値": source.orange },
    { "キー": "apple", "値": source.apple },
  ]));
  assert.deepEqual(evaluateValueRecipe({ apple: 12, banana: 3 }, [
    { kind: "sort", field: "", direction: "asc" },
  ]), val([
    { "キー": "banana", "値": 3 },
    { "キー": "apple", "値": 12 },
  ]));
  assert.deepEqual(Object.keys(source), ["apple", "banana", "orange"]);
});

test("runtime source serialization works with the generated helper shim", () => {
  const source = evaluateValueRecipe.toString();
  const pure = new Function("const __name = (fn) => fn; return (" + source + ")")() as typeof evaluateValueRecipe;
  assert.deepEqual(pure([3, 1, 2], [{ kind: "sort", field: "", direction: "asc" }]), val([1, 2, 3]));
  assert.deepEqual(pure(5, [{ kind: "math", operation: "divide", operandType: "number", operand: 2 }]), val(2.5));
});

test("math operands can resolve nested variables and safely parse numeric form strings", () => {
  assert.deepEqual(evaluateValueRecipe("12.5", [
    { kind: "math", operation: "multiply", operandType: "variable", operand: "settings.taxRate" },
  ], { settings: { taxRate: "1.1" } }), val(13.750000000000002));
  assert.deepEqual(evaluateValueRecipe(12, [
    { kind: "math", operation: "divide", operandType: "variable", operand: "rate" },
  ], { rate: "0" }), { kind: "error", code: "division-by-zero" });
  assert.deepEqual(evaluateValueRecipe(12, [
    { kind: "math", operation: "add", operandType: "variable", operand: "bad" },
  ], { bad: "twelve" }), { kind: "error", code: "type-mismatch" });
  assert.deepEqual(evaluateValueRecipe(12, [
    { kind: "math", operation: "add", operandType: "variable", operand: "missing" },
  ], {}), { kind: "error", code: "type-mismatch" });
  assert.deepEqual(evaluateValueRecipe(12, [
    { kind: "math", operation: "add", operandType: "number", operand: 3 },
  ]), val(15)); // 既定の被演算子は、数値として解釈する。
});


test("string replacements refuse expansion beyond 100KB without allocating huge output", () => {
  const result = evaluateValueRecipe("a".repeat(10000), [{
    kind: "replace", find: "a", replacement: "x".repeat(10000), regex: false,
  }]);
  assert.deepEqual(result, { kind: "error", code: "limit-exceeded" });
  assert.deepEqual(evaluateValueRecipe("abracadabra", [{
    kind: "replace", find: "a", replacement: "XY", regex: false,
  }]), val("XYbrXYcXYdXYbrXY"));
});

test("dynamic regex replacements reject catastrophic patterns and ambiguous quantifiers", () => {
  // この入力に (a+)+$ で単純に置換すると、指数的なバックトラックが起きる。
  const input = "a".repeat(28) + "!";
  for (const pattern of ["(a+)+$", "((a+))+$", "((a|aa))+$", "(a|aa)+$", "a+a+$", ".*.*$", "([ab]+)([abc]+)$"]) {
    const result = evaluateValueRecipe(input, [{
      kind: "replace", find: pattern, replacement: "x", regex: true,
    }]);
    assert.deepEqual(result, { kind: "error", code: "invalid-regex" }, pattern);
  }
  assert.deepEqual(evaluateValueRecipe("abc123", [{
    kind: "replace", find: "([a-z]+)(\\d+)", replacement: "$2:$1", regex: true,
  }]), val("123:abc"));
});

test("regex text and replacement expansions have bounded execution and output", () => {
  const repeat = (text: string, find: string, replacement: string) =>
    evaluateValueRecipe(text, [{
      kind: "replace", find, replacement, regex: true,
    }]);
  assert.deepEqual(repeat("a".repeat(1000), "a", "x".repeat(1000)),
    { kind: "error", code: "limit-exceeded" });
  assert.deepEqual(repeat("a".repeat(1000), "a", "$'"),
    { kind: "error", code: "limit-exceeded" });
  assert.deepEqual(repeat("a".repeat(3000), "a", "x"),
    { kind: "error", code: "invalid-regex" });
  assert.deepEqual(repeat("abc123", "[a-z]+", "x"), val("x123"));
  assert.deepEqual(repeat("abc", "(a)", "$1$1"), val("aabc"));
});

test("serialized recipe runtime also rejects pathological regex and expansion", () => {
  const embedded = new Function("const __name = (fn) => fn; return (" +
    evaluateValueRecipe.toString() + ")")() as typeof evaluateValueRecipe;
  assert.deepEqual(embedded("a".repeat(28) + "!", [{
    kind: "replace", find: "(a+)+$", replacement: "x", regex: true,
  }]), { kind: "error", code: "invalid-regex" });
  assert.deepEqual(embedded("a".repeat(2000), [{
    kind: "replace", find: "a", replacement: "x".repeat(1000), regex: false,
  }]), { kind: "error", code: "limit-exceeded" });
});


test("equivalent escaped literals cannot bypass the overlap check on repeated regex atoms", () => {
  const find = "^j*\\x6a*\\x6A*x$";
  assert.deepEqual(evaluateValueRecipe("j".repeat(40) + "!", [{
    kind: "replace", find, replacement: "x", regex: true,
  }]), { kind: "error", code: "invalid-regex" });
});

test("join enforces the output budget before inspecting the rest of the list", () => {
  const parts = ["x".repeat(100_001), "unread"];
  Object.defineProperty(parts, 1, { get() { throw new Error("should already have stopped"); } });
  assert.deepEqual(evaluateValueRecipe(parts, [{ kind: "join", separator: "," }]),
    { kind: "error", code: "limit-exceeded" });
});
});

describe("value-recipe-regex-work", () => {
// 書き出したページに出力するものと同じ、自己完結した評価器を動かす。置き換えるのは、
// この評価器の中のコンストラクターだけ。処理量の上限を試す準備は、どれもコンパイルしない。
const withConstructor = new Function("RegExp",
  "const __name = (fn) => fn; return (" + evaluateValueRecipe.toString() + ");");

function checkBudget(source: string, find: string, expectedPattern: string | null,
  variables: Record<string, unknown> = {}) {
  const compiled: [string, string][] = [];
  const evaluate = withConstructor(function (pattern: string, flags: string) {
    compiled.push([pattern, flags]);
    return /\uFFFF/g; // 固定の番兵は、ASCII のどの準備にも一致しない。
  }) as typeof evaluateValueRecipe;
  const result = evaluate(source, [{ kind: "replace", find, replacement: "", regex: true }], variables);
  assert.deepEqual(compiled, expectedPattern === null ? [] : [[expectedPattern, "g"]]);
  assert.deepEqual(result, expectedPattern === null
    ? { kind: "error", code: "invalid-regex" }
    : { kind: "value", value: source });
}

test("independent choices in four code fields can use exactly 256 paths", () => {
  const code = "(?:N|S|E|W)(?:1|2|3|4)(?:a|b|c|d)(?:!|@|#|%)";
  checkBudget("N1a!", code, code);
  checkBudget("N1a!X", code + "(?:X|Y)", null);
});

test("fixed group expansion counts its two group boundaries", () => {
  // 3文字と2つの境界で、固定の1回のくり返しあたり5単位かかる。
  const field = "(?:abc){819}X";
  checkBudget("!", field, field); // 819 × 5 + 1 = 4096
  checkBudget("!", field + "Y", null);
});

test("the work for a fixed suffix depends on the source length", () => {
  // 探索を始める位置が n 通りあるとき、この前置部分と 64 単位の後ろの部分で、65n² かかる。
  const field = "x+y{64}";
  checkBudget("-".repeat(507), field, field);
  checkBudget("-".repeat(508), field, null);
  checkBudget("-".repeat(508), "x+y", "x+y");
});

test("leaving a capture counts once per inner choice", () => {
  const field = "([A-Z]+)::";
  checkBudget("-".repeat(2046), field, field);
  checkBudget("-".repeat(2047), field, null);
  checkBudget("-".repeat(2047), "[A-Z]+::", "[A-Z]+::");
});

test("resolved pattern variables pass through the same budget before construction", () => {
  const field = "x+y{64}";
  checkBudget("-".repeat(507), "{format}", field, { format: field });
  checkBudget("-".repeat(508), "{format}", null, { format: field });
});

test("ordinary global replacements preserve capture order and unmatched text", () => {
  const result = evaluateValueRecipe("AB-07, CD-12.", [{
    kind: "replace", find: "{format}", regex: true, replacement: "$2/$1",
  }], { format: "([A-Z]{2})-([0-9]{2})" });
  assert.deepEqual(result, { kind: "value", value: "07/AB, 12/CD." });
});
});

describe("value-text-depth", () => {
function exportsOf(source: string) {
  const module = { exports: {} as any };
  runInNewContext(transformSync(source, { loader: "ts", format: "cjs" }).code, { module });
  return module.exports;
}
const generated = exportsOf(VARS_RUNTIME);
const native = exportsOf(nativeDataModule());
const deep = JSON.parse("[".repeat(20_000) + '"value"' + "]".repeat(20_000));

test("generated variable helpers typecheck with strict TypeScript", () => {
  const file = "/generated-value-text-vars.ts";
  const options = { strict: true, noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022 };
  const host = ts.createCompilerHost(options);
  const original = host.getSourceFile;
  host.getSourceFile = (name, language, onError, createNew) => name === file
    ? ts.createSourceFile(name, VARS_RUNTIME, language, true)
    : original(name, language, onError, createNew);
  const program = ts.createProgram([file], options, host);
  assert.deepEqual(ts.getPreEmitDiagnostics(program).map((diagnostic) =>
    ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")), []);
});

test("small, deeply nested fetched JSON remains renderable in editor and generated modules", () => {
  assert.equal(varText(deep), "value");
  assert.equal(interpolate("Result: {value}", { value: deep }), "Result: value");
  assert.equal(generated.varText(deep), "value");
  assert.equal(native.resolveText("Result: {value}", { value: deep }), "Result: value");
  assert.equal(compareValues(deep, "value"), 0);
});

test("list formatting preserves empty values, nested separators and repeated shared subtrees", () => {
  const shared = ["a", null, ["b", "", {}, false, 0]];
  const value = [shared, [], shared];
  const expected = "a, b, false, 0, a, b, false, 0";
  for (const render of [varText, generated.varText, (value: unknown) => native.resolveText("{value}", { value })]) {
    assert.equal(render(value), expected);
    assert.equal(render([, null, [undefined, []], "", {}]), "");
  }
  assert.equal(compareValues(value, "a,,b,,[object Object],false,0,,a,,b,,[object Object],false,0"), 0);
});

test("cyclic arrays stop at the active branch while preserving later values", () => {
  const cycle: unknown[] = ["before"];
  cycle.push(cycle, "after");
  for (const render of [varText, generated.varText, (value: unknown) => native.resolveText("{value}", { value })]) {
    assert.equal(render(cycle), "before, after");
  }
  assert.equal(compareValues(cycle, "before,,after"), 0);
});

test("shared list expansion cannot grow formatted text beyond the JSON data budget", () => {
  const shared = "x".repeat(3 * 1024 * 1024);
  for (const render of [varText, generated.varText, (value: unknown) => native.resolveText("{value}", { value })]) {
    assert.equal(render([shared, shared]), "");
    assert.equal(render([shared]), shared, "an ordinary bounded value remains intact");
  }
  assert.equal(compareValues([shared, shared], ""), 0);
});

test("sparse lists have a traversal budget instead of allocating their entire length", () => {
  assert.equal(varText(new Array(0xffffffff)), "");
});

test("DOM runtime initializes live text from deeply nested server values", () => {
  const output = {
    firstChild: { nodeType: 3, nodeValue: "" },
    getAttribute: () => "Result: {value}",
    closest: () => null,
  };
  const root = {
    querySelector: () => null,
    querySelectorAll: (selector: string) => selector === "[data-live]" ? [output] : [],
    addEventListener() {}, removeEventListener() {},
  };
  const dispose = runInNewContext(`(${SCRIPT_RUNTIME_2})({}).install(document, { value });`, {
    document: root, value: deep, CSS: { escape: (value: string) => value },
    MutationObserver: class { observe() {} disconnect() {} },
    requestAnimationFrame() {},
  });
  assert.equal(output.firstChild.nodeValue, "Result: value");
  dispose();
});
});

describe("var-explorer", () => {
  before(() => {
    useEditor.setState({
      breakpoint: "base", customWidth: null, styleState: "default", mode: "design",
      pageTheme: "light", selection: null, selectedIds: [], editingComponentId: null, scriptEditor: null,
    });
  });
const state = () => useEditor.getState();
const snapshot = () => structuredClone({ doc: state().doc, past: state().past, future: state().future });
function nodes(tree: any): any[] {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}

// 実際のソースのフックとイベントを実行する。DOM のキーボードの伝播とフォーカスは、e2e で確かめる。
function mount() {
  state().replaceDoc(varExplorerDoc()); state().setActivePage("p");
  const root = { slots: [] as any[], effects: [] as (() => void)[], changed: false };
  let current = root;
  let cursor = 0;
  const hooks = {
    ...React_2,
    useState(initial: any) {
      const i = cursor++, instance = current;
      if (!(i in instance.slots)) instance.slots[i] = typeof initial === "function" ? initial() : initial;
      return [instance.slots[i], (next: any) => {
        const value = typeof next === "function" ? next(instance.slots[i]) : next;
        if (!Object.is(value, instance.slots[i])) { instance.slots[i] = value; instance.changed = true; }
      }];
    },
    useRef(initial: any) { return current.slots[cursor++] ??= { current: initial }; },
    useMemo(fn: () => any, deps: any[]) {
      const i = cursor++, previous = current.slots[i];
      if (!previous || deps.some((v, n) => !Object.is(v, previous.deps[n]))) current.slots[i] = { deps, value: fn() };
      return current.slots[i].value;
    },
    useEffect(fn: () => void, deps: any[]) {
      const i = cursor++, previous = current.slots[i];
      if (!previous || deps.some((v, n) => !Object.is(v, previous[n]))) {
        current.slots[i] = deps; current.effects.push(fn);
      }
    },
  };
  const require = createRequire(resolve("components/VarExplorer.tsx"));
  const mod = { exports: {} as any };
  const code = transformSync(readFileSync("components/VarExplorer.tsx", "utf8"), { loader: "tsx", jsx: "automatic", format: "cjs" }).code;
  new Function("require", "module", "exports", "document", code)((id: string) =>
    id === "react" ? hooks : id === "react-dom" ? { createPortal: (tree: any) => tree } :
    id === "../lib/store" ? { useEditor: (select: any) => select(state()) } : require(id),
  mod, mod.exports, { body: {} });
  const picks: string[] = [];
  const props = { nodeId: "target", onClose() {}, onPick(name: string) {
    picks.push(name); state().updateNode("target", { field: { kind: "input", defaultValue: `{${name}}` } });
  } };
  function draw(instance: typeof root, component: any, props: any) {
    let tree: any;
    do {
      current = instance; cursor = 0; instance.changed = false;
      tree = component(props); instance.effects.splice(0).forEach(fn => fn());
    } while (instance.changed);
    return tree;
  }
  const render = () => draw(root, mod.exports.default, props);
  const input = () => nodes(render()).find(n => n.type === "input").props;
  const rows = () => nodes(render()).filter(n => n.props?.className?.startsWith("vx-row"));
  const key = (key: string, extra: any = {}) => input().onKeyDown({ key, preventDefault() {}, ...extra });
  const query = (value: string) => { input().onChange({ target: { value } }); render(); };
  const toggle = () => { nodes(render()).find(n => n.type === "button" && "aria-pressed" in n.props).props.onClick(); render(); };
  return { picks, render, rows, key, query, toggle,
    selected: () => rows().find(n => n.props.className.includes("is-key"))?.props.children[0].props.children,
    row() {
      const element = nodes(render()).find(n => n.type?.name === "Row" && n.props.path === "product");
      const instance = { slots: [] as any[], effects: [] as (() => void)[], changed: false };
      return () => draw(instance, element.type, element.props);
    },
  };
}

test("hiding advanced search results keeps a highlighted, valid keyboard choice and one undo step", () => {
  const h = mount(); h.toggle(); h.query("search");
  assert.equal(h.rows().length, 3);
  h.key("ArrowDown"); h.key("ArrowDown");
  assert.match(h.selected(), /disabled/);
  const before = snapshot(); h.toggle();
  assert.equal(h.rows().length, 1); assert.equal(h.selected(), "search");
  assert.deepEqual(snapshot(), before, "browsing does not change the document or history");
  h.key("Enter"); assert.deepEqual(h.picks, ["search"]);
  assert.equal(state().doc.nodes.target.field?.defaultValue, "{search}");
  assert.equal(state().past.length, before.past.length + 1);
  assert.deepEqual(state().doc.nodes.other, before.doc.nodes.other);
  const after = structuredClone(state().doc);
  state().undo(); assert.deepEqual(state().doc, before.doc);
  state().redo(); assert.deepEqual(state().doc, after);
});

test("live document updates can shrink or empty a search without stale keyboard selection", () => {
  const h = mount(); h.toggle(); h.query("search"); h.key("ArrowUp");
  assert.match(h.selected(), /disabled/);
  state().updateNode("search", { field: undefined, type: "box", text: { content: "Search" } });
  assert.equal(h.rows().length, 1); assert.equal(h.selected(), "search");
  h.key("ArrowUp"); assert.equal(h.selected(), "search");
  h.key("ArrowDown"); h.key("Enter"); assert.deepEqual(h.picks, ["search"]);
  state().deleteNodes(["search"]);
  const before = snapshot(); h.key("Enter"); h.key("ArrowDown");
  assert.equal(h.rows().length, 0); assert.deepEqual(snapshot(), before);
});

test("query changes, wrapping, mouse choice and IME Enter still select only the intended variable", () => {
  const h = mount(); h.toggle(); h.query("search");
  h.key("ArrowUp"); assert.match(h.selected(), /disabled/);
  h.key("ArrowDown"); assert.equal(h.selected(), "search");
  h.query("product"); assert.equal(h.selected(), "product");
  h.key("Enter", { nativeEvent: { isComposing: true } });
  h.key("Enter", { nativeEvent: { keyCode: 229 } });
  assert.deepEqual(h.picks, []);
  const last = h.rows().at(-1)!; last.props.onMouseEnter();
  const selected = h.selected(); h.key("Enter");
  assert.equal(h.picks[0], "product.details.label"); assert.match(selected, /label/);
  h.rows()[0].props.onClick(); assert.deepEqual(h.picks, ["product.details.label", "product"]);
});

test("nested expand-button keys do not select the parent, while row keys and clicks still work", () => {
  const h = mount(); const draw = h.row();
  const row = () => nodes(draw()).find(n => n.props?.className === "vx-row").props;
  const parent = {}, button = {};
  const key = (key: string, target = parent, extra: any = {}) => row().onKeyDown({ key, target, currentTarget: parent, ...extra });
  const before = snapshot();
  key("Enter", button); key("ArrowRight", button);
  assert.deepEqual(h.picks, []); assert.deepEqual(snapshot(), before);
  key("ArrowRight"); assert.equal(nodes(draw()).find(n => n.type === "button").props["aria-expanded"], true);
  key("ArrowLeft"); assert.equal(nodes(draw()).find(n => n.type === "button").props["aria-expanded"], false);
  nodes(draw()).find(n => n.type === "button").props.onClick({ stopPropagation() {} });
  assert.equal(nodes(draw()).find(n => n.type === "button").props["aria-expanded"], true);
  key("Enter", parent, { nativeEvent: { isComposing: true } }); assert.deepEqual(h.picks, []);
  key("Enter"); row().onClick(); assert.deepEqual(h.picks, ["product", "product"]);
});
});

describe("variable-choice", () => {
for (const v of [undefined, null, false, true, 0, "001", [], ["red"], {}, { title: "Nested" }]) {
  test(`raw value picker retains ${JSON.stringify(v)}`, () => assert.equal(canPickVariable(v, "value"), true));
}
test("text keeps boolean, primitive arrays and unknowns but not object insertion", () => {
  for (const v of [undefined, null, false, 0, "", [], ["red", false, null]]) assert.equal(canPickVariable(v, "text"), true);
  for (const v of [{}, { name: "A" }, [{ name: "A" }]]) assert.equal(canPickVariable(v, "text"), false);
});
test("numeric choices retain unknowns and numeric text without accepting objects or booleans", () => {
  for (const v of [undefined, null, 0, -2.5, "001", "1,234", " -2 "]) assert.equal(canPickVariable(v, "number"), true);
  for (const v of [false, true, "", "red", {}, [], [1, 2], Infinity, NaN]) assert.equal(canPickVariable(v, "number"), false);
});
test("reference view preserves the exact meaning of entered variable expressions", () => {
  for (const value of ["{data}", " { data.name } ", "Hello {data}", "\\{data}", "001", "false", "", "{a}{b}"]) {
    assert.equal(singleValueReference(value), setVarSource({ id: "s", kind: "set-var", value, into: "out" }));
  }
});

test("JSON roundtrip preserves typed samples, expressions and generated project", async () => {
  const { scriptDataPickerDoc } = await import("./helpers/script-data-picker");
  const { generateProject } = await import("../lib/generator");
  const doc = scriptDataPickerDoc();
  const before = JSON.stringify(doc);
  const project = generateProject(doc);
  assert.equal(JSON.stringify(doc), before);
  const saved = JSON.parse(before);
  assert.deepEqual(generateProject(saved), project);
  assert.equal(saved.pages.p.pageScripts[0].steps[0].preview.sample.available, false);
  assert.equal(saved.pages.p.pageScripts[0].steps[0].preview.sample.empty, null);
  assert.equal(saved.pages.p.pageScripts[0].steps[0].preview.sample.code, "001");
});


test("local leaf paths expose roots and shadow all page-level dotted samples", () => {
  assert.deepEqual(localVariableNames(["details.id", "details.tags.0", "empty"]), ["details", "details.id", "details.tags", "details.tags.0", "empty"]);
  const samples = variableChoiceSamples([{ vars: { details: { id: "PAGE" }, "details.id": "PAGE-DOTTED", "details.other": "OTHER", keep: false } }], ["details.id"]);
  assert.equal(samples.details, undefined);
  assert.equal(samples["details.id"], undefined);
  assert.equal(Object.hasOwn(samples, "details.other"), false);
  assert.equal(samples.keep, false);
});

test("nearer groups own their entire root even if a leaf is missing", () => {
  assert.deepEqual(variableChoiceSamples([
    { vars: { price: false, details: {} } },
    { vars: { price: 99, details: { id: "PAGE" }, "details.id": "PAGE-DOTTED", keep: 1 } },
  ]), { price: false, details: {}, keep: 1 });
});

test("real raw chip uses node samples and treats loop roots as runtime values", async () => {
  const React = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { Ctx, ScriptNodeCtx, LoopCtx } = await import("../components/script-editor/context");
  const { loadNestedUi } = await import("./helpers/client-nested-lists");
  const { scriptDataPickerDoc } = await import("./helpers/script-data-picker");
  const { makeBox, makeText } = await import("../lib/presets");
  const { previewDataVars, varGroupsAt } = await import("../lib/data");
  const doc = scriptDataPickerDoc();
  (doc.pages.p.pageScripts![0].steps[0] as any).preview.sample.rows = [{ price: false, details: { id: "LOCAL" } }];
  doc.pages.p.pageScripts![0].steps.push({ id: "global-price", kind: "set-var", value: "{data.price}", into: "price" });
  doc.nodes.list = { ...makeBox(), id: "list", type: "list", list: { from: "data.rows" }, children: ["button"] };
  doc.nodes.button = { ...makeText("Button"), id: "button" };
  doc.pages.p.children = ["list"];
  assert.equal(variableChoiceSamples(varGroupsAt(doc, "p", "button")).price, false);
  const { ValueIn } = loadNestedUi("components/script-editor/inputs.tsx");
  const render = (value: string, loops: any[] = []) => renderToStaticMarkup(React.createElement(Ctx.Provider, { value: {
    doc, pageId: "p", samples: previewDataVars(doc, "p"), variableIndex: pageVariableIndex(doc, "p"),
  } as any }, React.createElement(ScriptNodeCtx.Provider, { value: "button" }, React.createElement(LoopCtx.Provider, { value: loops }, React.createElement(ValueIn, { value, onCommit() {} })))));
  const nodeChip = render("{price}");
  assert.match(nodeChip, /Value/);
  assert.doesNotMatch(render("Hello {price}"), /se-value-info/, "a mixed template is not labelled as a raw boolean");
  assert.doesNotMatch(render("\\{price}"), /se-value-info/, "an escaped reference remains literal text");
  const loopChip = render("{details}", [{ fields: ["details.id"], samples: { "details.id": "LOCAL" } }]);
  assert.doesNotMatch(loopChip, /実行時|se-value-info|vx-kind/);
  assert.doesNotMatch(loopChip, /LOCAL/);
});



test("script field suggestions show only the first member of nested arrays", () => {
  assert.deepEqual(flattenFields({
    rows: [{ title: "First" }, { title: "Second" }, { title: "Third" }, { title: "Fourth" }],
  }, 4).map(({ field }) => field), ["rows.0.title"]);
});
});

describe("variable-input", () => {
const { scriptInputDoc, varNamesAt, varGroupsAt } = dataHelpers;
const { Ctx, ScriptNodeCtx, ScriptStepCtx, LoopCtx } = contexts;

function candidates(doc = scriptDataPickerDoc_2(), local: string[] = [], valueContext = "value") {
  const require = createRequire(resolve("components/script-editor/inputs.tsx"));
  const mod = { exports: {} as any };
  const hooks = { ...React_3, useMemo: (fn: any) => fn(),
    // 候補のテストでは、有効になった入力欄を再現する（本番の入力欄は、これを遅延して読み込む）。
    useState: () => [true, () => {}],
    useContext: (ctx: any) =>
    ctx === Ctx ? { doc, pageId: "p" } : ctx === ScriptStepCtx ? "value" : ctx === ScriptNodeCtx ? "" :
    ctx === LoopCtx ? [{ fields: local, samples: {} }] : ctx._currentValue };
  new Function("require", "module", "exports", transformSync(readFileSync("components/script-editor/inputs.tsx", "utf8"), {
    loader: "tsx", jsx: "automatic", format: "cjs",
  }).code)((id: string) => id === "react" ? hooks : require(id), mod, mod.exports);
  const text = mod.exports.TextIn({ value: "", onCommit() {}, vars: true, valueContext });
  return text.type(text.props).props;
}

test("real input excludes its new output from both names and Explorer extras without editing the document", () => {
  const doc = scriptDataPickerDoc_2(), before = JSON.stringify(doc);
  assert.ok(varNamesAt(doc, "p", "").includes("chosen"));
  const input = candidates(doc);
  assert.ok(!input.names.includes("chosen")); assert.ok(!input.extraNames.includes("chosen"));
  assert.equal(input.sourceStepId, "value");
  assert.equal(JSON.stringify(doc), before);
  assert.ok(!Object.hasOwn(variableChoiceSamples(varGroupsAt(scriptInputDoc(doc, "value"), "p", "")), "chosen"));
});

test("existing variable updates retain a prior producer and its old sample", () => {
  const doc = scriptDataPickerDoc_2();
  doc.pages.p.pageScripts![0].steps.splice(1, 0, { id: "prior", kind: "set-var", value: "{data.name}", into: "chosen" });
  assert.ok(candidates(doc).names.includes("chosen"));
  assert.equal(variableChoiceSamples(varGroupsAt(scriptInputDoc(doc, "value"), "p", "")).chosen, "Product");
});

test("same-name form and loop bindings remain available to an assignment", () => {
  const doc = scriptDataPickerDoc_2();
  doc.nodes.field = { ...makeText_2(""), id: "field", type: "field", attrId: "chosen", field: { kind: "input" } };
  doc.pages.p.children = ["field"];
  assert.ok(candidates(doc).names.includes("chosen"));
  assert.ok(candidates(scriptDataPickerDoc_2(), ["chosen.detail"]).names.includes("chosen"));
  assert.ok(candidates(scriptDataPickerDoc_2(), ["chosen.detail"]).names.includes("chosen.detail"));
});

test("nested current producers are removed without losing enclosing or other branch bindings", () => {
  const doc = scriptDataPickerDoc_2();
  const step = doc.pages.p.pageScripts![0].steps.splice(1, 1)[0];
  doc.pages.p.pageScripts![0].steps.push({ id: "loop", kind: "repeat", times: 2, then: [
    { id: "prior", kind: "set-var", value: "{data.name}", into: "chosen" }, step,
  ] });
  const candidate = scriptInputDoc(doc, "value");
  assert.ok(varNamesAt(candidate, "p", "").includes("chosen"));
  assert.equal(JSON.stringify(candidate).includes('"id":"value"'), false);
  assert.equal(JSON.stringify(doc).includes('"id":"value"'), true);
});

test("unified value candidates retain object roots while text still excludes them", () => {
  assert.ok(candidates().names.includes("data"));
  assert.ok(!candidates(scriptDataPickerDoc_2(), [], "text").names.includes("data"));
});

function mountInput(eager: boolean) {
  const slots: any[] = []; let cursor = 0;
  const frames: (() => void)[] = [];
  const hooks = { ...React_3, useId() { const i = cursor++; return slots[i] ??= `test-field-${i}`; }, useEffect() {}, useRef(initial: any) { return slots[cursor++] ??= { current: initial }; },
    useState(initial: any) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial;
      return [slots[i], (next: any) => { slots[i] = typeof next === "function" ? next(slots[i]) : next; }]; } };
  const require = createRequire(resolve("components/controls.tsx")); const mod = { exports: {} as any };
  new Function("require", "module", "exports", "window", "requestAnimationFrame", transformSync(readFileSync("components/controls.tsx", "utf8"), {
    loader: "tsx", jsx: "automatic", format: "cjs",
  }).code)((id: string) => id === "react" ? hooks : require(id), mod, mod.exports, { innerWidth: 1000, innerHeight: 800 }, (fn: any) => frames.push(fn));
  const el = { value: "", selectionStart: 0, selectionEnd: 0, focus() {}, setSelectionRange() {}, getBoundingClientRect: () => ({ left: 0, top: 0, bottom: 20, width: 150 }) };
  const render = () => { cursor = 0; return mod.exports.VarInput({ value: "", onCommit() {}, names: ["alpha", "beta"], nodeId: "", eager, valueContext: "value" }).props.children; };
  const input = () => { const props = render()[0].props; props.ref.current = el; return props; };
  const press = (key: string, extra = {}) => input().onKeyDown({ key, ctrlKey: true, metaKey: false, altKey: false,
    preventDefault() {}, nativeEvent: {}, ...extra });
  return { input, press, render, el, flushFrames: () => { while (frames.length) frames.shift()!(); }, menu: () => render().find((v: any) => v?.type?.name === "VarSuggestMenu"),
    explorer: () => render().find((v: any) => v?.type?.name === "VarExplorer") };
}

test("eager focus opens suggestions; Cmd+/ opens a distinct unfiltered explorer instead of reopening the same list", () => {
  const h = mountInput(true); h.input().onFocus(); assert.ok(h.menu());
  assert.equal(h.menu().props.exploreShortcut, true);
  h.press("/", { ctrlKey: false, metaKey: true }); assert.ok(h.explorer()); assert.equal(h.menu(), undefined);
});

test("non-eager Cmd+/ and eager Ctrl+Space keep inline completion and IME opens neither", () => {
  for (const [eager, key] of [[false, "/"], [true, " "]] as const) {
    const h = mountInput(eager); h.press(key); assert.ok(h.menu()); assert.equal(h.explorer(), undefined);
  }
  const h = mountInput(true); h.press("/", { nativeEvent: { isComposing: true, keyCode: 229 } });
  assert.equal(h.menu(), undefined); assert.equal(h.explorer(), undefined);
  for (const key of ["/", " "]) assert.equal(isVarListShortcut({ key, ctrlKey: true, metaKey: false, altKey: false }), true);
});

test("exploring a whole raw reference replaces it, while selecting text replaces only the selection", () => {
  const h = mountInput(true); h.el.value = "{alpha}"; h.el.selectionStart = h.el.selectionEnd = 7;
  h.press("/"); h.explorer().props.onPick("beta"); assert.equal(h.el.value, "{beta}");
  const mixed = mountInput(true); mixed.el.value = "Hello alpha!"; mixed.el.selectionStart = 6; mixed.el.selectionEnd = 11;
  mixed.press("/"); mixed.explorer().props.onPick("beta"); assert.equal(mixed.el.value, "Hello {beta}!");
});


test("inline suggestions replace a whole raw reference instead of appending another reference", () => {
  const h = mountInput(true); h.el.value = "{alpha}"; h.el.selectionStart = h.el.selectionEnd = 7;
  h.input().onFocus(); h.menu().props.onPick("beta"); assert.equal(h.el.value, "{beta}");
  const mixed = mountInput(true); mixed.el.value = "Hello alpha!"; mixed.el.selectionStart = 6; mixed.el.selectionEnd = 11;
  mixed.input().onFocus(); mixed.menu().props.onPick("beta"); assert.equal(mixed.el.value, "Hello {beta}!");
});

test("selecting only the name inside a raw reference still replaces the whole reference", () => {
  for (const explorer of [false, true]) {
    const h = mountInput(true); h.el.value = "{alpha}"; h.el.selectionStart = 1; h.el.selectionEnd = 6;
    if (explorer) { h.press("/"); h.explorer().props.onPick("beta"); }
    else { h.input().onFocus(); h.menu().props.onPick("beta"); }
    assert.equal(h.el.value, "{beta}");
  }
});


test("focus cannot reopen stale suggestions after filling a complete value or blurring", () => {
  for (const value of ["{alpha}", "literal", "\\{alpha}"]) {
    const h = mountInput(true); h.input().onFocus();
    h.el.value = value; h.el.selectionStart = h.el.selectionEnd = value.length;
    h.input().onInput({ nativeEvent: {} }); h.flushFrames();
    assert.equal(h.menu(), undefined);
    h.press("Tab", { ctrlKey: false }); assert.equal(h.el.value, value);
  }
  const h = mountInput(true); h.input().onFocus();
  h.input().onBlur({ target: h.el }); h.flushFrames(); assert.equal(h.menu(), undefined);
});

test("inline value choices include nested arrays and objects without leaking shadowed roots", () => {
  const input = candidates();
  for (const name of ["data.tags", "data.detail", "data.detail.title", "data.rows"]) assert.ok(input.names.includes(name), name);
  const local = candidates(scriptDataPickerDoc_2(), ["data.local"]);
  assert.ok(local.names.includes("data.local"));
  assert.ok(!local.names.includes("data.tags"));
  assert.ok(!local.names.includes("data.detail.title"));
  assert.ok(!candidates(scriptDataPickerDoc_2(), [], "text").names.includes("data.detail"));
});
});

describe("vars-runtime-parity", () => {
const jsonStart = PAGE_DATA_RUNTIME.indexOf("  function jsonBody(");
const jsonEnd = PAGE_DATA_RUNTIME.indexOf("  // Apply the shared", jsonStart);
assert.ok(jsonStart >= 0 && jsonEnd > jsonStart);
const browserJson = runInNewContext(PAGE_DATA_RUNTIME.slice(jsonStart, jsonEnd) + "\njsonBody", { read: lookupVar, text: varText });

const module = { exports: {} as any };
runInNewContext(transformSync(VARS_RUNTIME, { loader: "ts", format: "cjs" }).code, { module });
const generated = module.exports;
const vars = { name: 'A"\\\nB', slug: "日本 /?", list: [1, "two"], obj: { value: 3 } };

test("published JSON bodies preserve escaped literal braces exactly as editor previews", () => {
  const template = JSON.stringify({ literal: "\\{name}", actual: "{name}" });
  const expected = { literal: "{name}", actual: vars.name };
  assert.deepEqual(JSON.parse(interpolateJson(template, vars)), expected);
  assert.deepEqual(JSON.parse(generated.interpolateJson(template, vars)), expected);
  assert.deepEqual(JSON.parse(browserJson(template, vars)), expected);
});

test("JSON runtime parity covers consecutive backslashes, quotes, adjacent and raw tokens", () => {
  for (let count = 0; count <= 8; count++) {
    const prefix = "\\".repeat(count);
    const literalTemplate = JSON.stringify({ text: prefix + "{name}" });
    const expected = count ? "\\".repeat(count - 1) + "{name}" : vars.name;
    for (const replace of [interpolateJson, generated.interpolateJson, browserJson]) {
      assert.equal(JSON.parse(replace(literalTemplate, vars)).text, expected);
    }
    for (const content of [prefix + "{name}", 'quoted"' + prefix + "{name}", prefix + "{missing}{name}", prefix + "{name}\\{list}"]) {
      const template = JSON.stringify({ text: content, next: "{slug}", escapedQuote: '\\"{name}' });
      const preview = interpolateJson(template, vars);
      assert.doesNotThrow(() => JSON.parse(preview), template);
      assert.equal(generated.interpolateJson(template, vars), preview, template);
      assert.equal(browserJson(template, vars), preview, template);
    }
  }
  for (const template of ['{"list":{list},"object":{obj},"missing":{missing}}', '["\\{name}", {list}, "{name}", "[slug]"]', '{"{slug}":"{name}"}']) {
    assert.equal(generated.interpolateJson(template, vars), interpolateJson(template, vars), template);
    assert.doesNotThrow(() => JSON.parse(generated.interpolateJson(template, vars)));
  }
});

test("plain and URL interpolation retain editor/runtime escaping and KEEP_ESCAPES parity", () => {
  for (const keep of [false, true]) {
    const values = { ...vars, [KEEP_ESCAPES]: keep, url: "https://example.com/path" };
    for (const template of ['\\{name}/{name}/[slug]', '\\\\{name}{list}{missing}', '{url}?q={name}', '/{slug}/{obj.value}/{list.-1}', '{obj}/{list}']) {
      assert.equal(generated.interpolate(template, values), interpolate(template, values));
      assert.equal(generated.interpolateUrl(template, values), interpolateUrl(template, values));
    }
  }
});


test("generated-site interpolation resolves built-in timestamps and random values without browser globals", () => {
  for (const lookup of [lookupVar, generated.lookupVar as typeof lookupVar]) {
    const unix = lookup({}, "system.unix");
    const random = lookup({}, "system.random");
    const integer = lookup({}, "system.randomInt");
    assert.equal(typeof unix, "number");
    assert.ok(unix > 1_700_000_000);
    assert.equal(typeof random, "number");
    assert.ok(random >= 0 && random < 1);
    assert.ok(Number.isInteger(integer) && integer >= 1 && integer <= 100);
    assert.equal(typeof lookup({}, "system.randomBoolean"), "boolean");
    assert.equal(lookup({}, "system.page.url"), undefined);
  }
  assert.match(generated.interpolate("{system.date}", {}), /^\d{4}-\d{2}-\d{2}$/);
});
});
