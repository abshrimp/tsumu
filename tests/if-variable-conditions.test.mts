import assert from "node:assert/strict";
import { test } from "node:test";
import { changeIfVariableLeft, ifVariableOperators, ifVariableSample } from "../lib/if-variable-conditions";
import { matchesValueCondition } from "../lib/value-semantics";

const categories = { "出展カテゴリ": ["物販"], "投票カテゴリ": ["物販"], "大分類": ["かう"] };
const samples = { data: { categories, name: "出展者", tags: ["物販"] } };

test("if variable references retain complete list objects and singleton arrays", () => {
  assert.deepEqual(ifVariableSample("{data.categories}", samples), categories);
  assert.deepEqual(ifVariableSample("{data.categories.出展カテゴリ}", samples), ["物販"]);
  assert.deepEqual(ifVariableSample('["物販"]', samples), ["物販"]);
  assert.equal(ifVariableSample("{later}", samples), undefined);
  assert.equal(ifVariableSample("Hello {data.categories}", samples), undefined);
  assert.deepEqual(ifVariableOperators("{data.categories}", samples), ["has-key", "empty", "eq"]);
  assert.deepEqual(ifVariableOperators("{data.categories.出展カテゴリ}", samples), ["contains", "empty", "eq"]);
  assert.equal(ifVariableOperators("{later}", samples), undefined);
  assert.equal(ifVariableOperators("{data.name}", samples), undefined);
});

test("if condition chooses relevant operation when switching between values and lists", () => {
  const scalar = { left: "{data.name}", op: "eq" as const, value: "物販" };
  const object = changeIfVariableLeft(scalar, "{data.categories}", samples);
  assert.deepEqual(object, { left: "{data.categories}", op: "has-key", value: "" });
  const array = changeIfVariableLeft(object, "{data.categories.出展カテゴリ}", samples);
  assert.deepEqual(array, { left: "{data.categories.出展カテゴリ}", op: "contains", value: "" });
  assert.deepEqual(changeIfVariableLeft({ ...array, value: "物販" }, "{data.tags}", samples), {
    left: "{data.tags}", op: "contains", value: "物販",
  });
  assert.deepEqual(changeIfVariableLeft({ ...array, value: "物販" }, "{later}", samples), {
    left: "{later}", op: "contains", value: "物販",
  });
  assert.deepEqual(changeIfVariableLeft(scalar, "{data.categories.出展カテゴリ}", samples), {
    left: "{data.categories.出展カテゴリ}", op: "contains", value: "物販",
  });
});

test("if condition membership and key predicates keep runtime evaluation unchanged", () => {
  assert.equal(matchesValueCondition(categories, "has-key", "出展カテゴリ"), true);
  assert.equal(matchesValueCondition(categories, "has-key", "未登録"), false);
  assert.equal(matchesValueCondition(categories["出展カテゴリ"], "contains", "物販"), true);
  assert.equal(matchesValueCondition(categories["出展カテゴリ"], "contains", "飲食"), false);
});
