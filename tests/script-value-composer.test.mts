import assert from "node:assert/strict";
import { test } from "node:test";
import { composeValueExpression, defaultTransform, VALUE_TRANSFORM_KINDS } from "../lib/script-model/compose";
import { evaluateExpression } from "../lib/script-model/evaluate";
import { validateExpression } from "../lib/script-model/validate";

test("value operations nest from left to right without extra variable blocks", () => {
  const operations = [
    { kind: "field" as const, key: "items" },
    { kind: "length" as const },
    { kind: "format" as const },
  ];
  const original = structuredClone(operations);
  const expr = composeValueExpression("data", operations);
  assert.equal(validateExpression(expr).ok, true);
  assert.deepEqual(evaluateExpression(expr, { data: { items: ["a", "b", "c"] } }), {
    kind: "value", value: "3",
  });
  assert.deepEqual(operations, original, "building an expression never mutates the recipe");
  assert.deepEqual(defaultTransform("field"), { kind: "field", key: "" });
  assert.equal(VALUE_TRANSFORM_KINDS.length, 9);
  assert.equal(new Set(VALUE_TRANSFORM_KINDS).size, 9);
});

test("dotted literal object keys and numeric list indices are distinct", () => {
  const literal = composeValueExpression("data", [
    { kind: "field", key: "meta.name" },
    { kind: "index", index: 1 },
  ]);
  const nested = composeValueExpression("data", [
    { kind: "field", key: "meta" },
    { kind: "field", key: "name" },
    { kind: "index", index: 0 },
  ]);
  const data = { "meta.name": ["first", "second"], meta: { name: ["nested", "other"] } };
  assert.deepEqual(evaluateExpression(literal, { data }), { kind: "value", value: "second" });
  assert.deepEqual(evaluateExpression(nested, { data }), { kind: "value", value: "nested" });
  assert.deepEqual(evaluateExpression(composeValueExpression("data", [
    { kind: "field", key: "meta.name" }, { kind: "index", index: -1 },
  ]), { data }), { kind: "value", value: "second" });
});

test("missing and null are not treated as the same value", () => {
  const ops = [
    { kind: "field" as const, key: "optional" },
    { kind: "fallback" as const, text: "未取得" },
  ];
  const expr = composeValueExpression("data", ops);
  assert.deepEqual(evaluateExpression(expr, { data: {} }), { kind: "value", value: "未取得" });
  assert.deepEqual(evaluateExpression(expr, { data: { optional: null } }), { kind: "value", value: null });
  assert.deepEqual(evaluateExpression(expr, { data: { optional: false } }), { kind: "value", value: false });
});

test("each operation is type-checked instead of silently coercing values", () => {
  const expr = composeValueExpression("data", [
    { kind: "field", key: "name" },
    { kind: "length" },
  ]);
  const result = evaluateExpression(expr, { data: { name: "not a list" } });
  assert.equal(result.kind, "error");
  if (result.kind === "error") assert.equal(result.code, "type-mismatch");

  const json = composeValueExpression("data", [
    { kind: "field", key: "json" }, { kind: "parse" }, { kind: "field", key: "tags" },
    { kind: "length" }, { kind: "format" },
  ]);
  assert.deepEqual(evaluateExpression(json, { data: { json: '{"tags":[1,2]}' } }), {
    kind: "value", value: "2",
  });
});

test("checking a field distinguishes a present null from a missing key", () => {
  assert.deepEqual(defaultTransform("has"), { kind: "has", key: "" });
  const exists = composeValueExpression("data", [{ kind: "has", key: "optional" }]);
  assert.deepEqual(evaluateExpression(exists, { data: { optional: null } }), { kind: "value", value: true });
  assert.deepEqual(evaluateExpression(exists, { data: {} }), { kind: "value", value: false });
  assert.equal(validateExpression(exists).ok, true);
});

test("nullish fallback covers null and missing, but preserves false and zero", () => {
  const expression = composeValueExpression("data", [
    { kind: "field", key: "optional" },
    { kind: "fallback-nullish", text: "代替" },
  ]);
  assert.deepEqual(defaultTransform("fallback-nullish"), { kind: "fallback-nullish", text: "" });
  assert.deepEqual(evaluateExpression(expression, { data: {} }), { kind: "value", value: "代替" });
  assert.deepEqual(evaluateExpression(expression, { data: { optional: null } }), { kind: "value", value: "代替" });
  assert.deepEqual(evaluateExpression(expression, { data: { optional: false } }), { kind: "value", value: false });
  assert.deepEqual(evaluateExpression(expression, { data: { optional: 0 } }), { kind: "value", value: 0 });
  assert.equal(validateExpression(expression).ok, true);
});
