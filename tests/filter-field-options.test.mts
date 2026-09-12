import assert from "node:assert/strict";
import { test } from "node:test";
import { filterFieldKind, filterFieldOperators, filterFieldSelection } from "../lib/filter-field-options";
import { matchesValueCondition } from "../lib/value-semantics";

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
