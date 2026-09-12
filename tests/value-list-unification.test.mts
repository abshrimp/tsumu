import assert from "node:assert/strict";
import { test } from "node:test";
import { matchesValueCondition, parseValueLiteral } from "../lib/value-semantics";
import { PAGE_STEP_RUNNER_SOURCE, runPurePageSteps } from "../lib/page-load-steps";
import { evaluateValueRecipe } from "../lib/script-model/recipe-runtime";
import { lookupVar, interpolate } from "../lib/vars";
import { obfuscateVarNames, pagePlan, previewDataVars } from "../lib/data";
import { generateProject } from "../lib/generator";
import { validDocumentScripts } from "../lib/document-validation";
import { createInitialDoc } from "../lib/presets";
import type { ScriptStep } from "../lib/types";
import { nativeDataModule } from "../lib/generator/native-data";

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
    { id: "load", trigger: "load", pos: { x: 0, y: 0 }, steps },
  ];
  assert.ok(pagePlan(doc, pageId).serverIds.has("remove"));
  const generated = generateProject(doc).files["app/page.tsx"];
  assert.match(generated, /__runPurePageSteps/);
  assert.match(generated, /remove-list-item/);
});

test("list removal validates its method instead of accepting unknown step shapes", () => {
  const step = { id: "remove", kind: "remove-list-item", list: "items", mode: "value", value: "10" };
  const asScripts = (item: object) => [
    { id: "script", trigger: "click", pos: { x: 0, y: 0 }, steps: [item] },
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
  page.pageScripts = [{ id: "source", trigger: "load", pos: { x: 0, y: 0 }, steps: [
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
  const { listItems } = await import(uri);
  const result = listItems({
    rows: { apple: { title: "Apple" }, banana: 2, empty: null, nested: [1, 2] },
  }, "rows", 0);
  assert.deepEqual(result, [
    { title: "Apple" }, { "値": 2 }, { "値": null }, { "値": [1, 2] },
  ]);
  assert.deepEqual(listItems({ rows: ["a", "b"] }, "rows", 1), [{ "値": "a" }]);
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
    { id: "load", trigger: "load", pos: { x: 0, y: 0 }, steps: [
      { id: "seed", kind: "fetch", as: "source", url: "https://example.test/source",
        preview: { sample: { title: "ready" } } },
      { id: "protected", kind: "fetch", as: "preserve", url: "https://example.test/preserve",
        preview: { sample: { title: "original" } } },
    ] },
    { id: "click", trigger: "click", pos: { x: 0, y: 0 }, steps: [
      // Deliberately out of order: the first copy needs a second pass.
      { id: "second", kind: "set-var", into: "record.label", value: "{record.title}" },
      { id: "first", kind: "set-var", into: "record.title", value: "{source.title}" },
      { id: "keep", kind: "set-var", into: "preserve.title", value: "{source.title}" },
      { id: "end", kind: "set-var", into: "result", value: "{record.label}" },
    ] },
  ];
  const preview = previewDataVars(doc, page.id);
  assert.deepEqual(preview.record, { title: "ready", label: "ready" });
  assert.equal(preview.result, "ready");
  assert.deepEqual(preview.preserve, { title: "original" });
});
