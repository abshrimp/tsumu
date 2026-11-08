import assert from "node:assert/strict";
import { test } from "node:test";
import { matchesValueCondition, parseValueLiteral } from "../lib/value-semantics";
import { runPurePageSteps } from "../lib/page-load-steps";
import { evaluateValueRecipe } from "../lib/script-model/recipe-runtime";
import { lookupVar, interpolate } from "../lib/vars";
import type { ScriptStep } from "../lib/types";

const run = (steps: ScriptStep[], vars: Record<string, unknown>) =>
  runPurePageSteps(steps, vars, lookupVar, interpolate, evaluateValueRecipe);

test("list contains searches values, while has-key only checks own keys", () => {
  const dictionary = { apple: 100, banana: "200", orange: { price: 300 } };
  assert.equal(matchesValueCondition(dictionary, "contains", 100), true);
  assert.equal(matchesValueCondition(dictionary, "contains", "100"), false);
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
});

test("value checks keep typed values distinct and lists structurally comparable", () => {
  assert.equal(matchesValueCondition(100, "eq", "100"), false);
  assert.equal(matchesValueCondition(false, "eq", 0), false);
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

test("nested and null list values are no longer skipped by for-each", () => {
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
