import assert from "node:assert/strict";
import { test } from "node:test";
import { filterItems, type ListOp } from "../lib/data";

test("list filters prepare literals once per evaluation, not once per item", () => {
  let reads = 0;
  const ops: ListOp[] = [{ kind: "filter", conds: [{
    field: "category", op: "in", get value() { reads++; return '["a","c"]'; },
  }] }];
  const items = Array.from({ length: 200 }, (_, i) => ({ category: i % 2 ? "a" : "b" }));
  const result = filterItems(items, ops);
  assert.deepEqual(result, items.filter((item) => item.category === "a"));
  assert.equal(reads, 1);
  assert.equal(result[0], items[1]);
});

test("prepared filters preserve mixed condition groups, sequential joins and negation", () => {
  const items = [
    { name: "a", score: 1, enabled: true },
    { name: "b", score: 2, enabled: true },
    { name: "c", score: 3, enabled: false },
    { name: "d", score: 4, enabled: false },
  ];
  const ops: ListOp[] = [
    { kind: "filter", conds: [
      { field: "name", op: "eq", value: "a" },
      { field: "score", op: "gte", value: "2" },
      { field: "enabled", op: "eq", value: "true", and: true },
    ] },
    { kind: "sort", field: "name", dir: "desc" },
    { kind: "filter", join: "or", conds: [{ field: "name", op: "eq", value: "d" }] },
    { kind: "filter", join: "and", conds: [{ field: "name", op: "eq", value: "b", not: true }] },
  ];
  assert.deepEqual(filterItems(items, ops), [items[0], items[3]]);
});

test("filter preparation does not cache edited literals or resolved values between calls", () => {
  const condition = { field: "value", op: "eq" as const, value: '{"name":"a"}' };
  const filter: Extract<ListOp, { kind: "filter" }> = { kind: "filter", conds: [condition] };
  const items = [{ value: { name: "a" } }, { value: { name: "b" } }, { value: undefined }, { value: null }];
  assert.deepEqual(filterItems(items, [filter]), [items[0]]);
  condition.value = '{"name":"b"}';
  assert.deepEqual(filterItems(items, [filter]), [items[1]]);
  filter.conds[0].resolvedValue = { value: undefined };
  assert.deepEqual(filterItems(items, [filter]), [items[2]]);
  filter.conds[0].resolvedValue.value = null;
  assert.deepEqual(filterItems(items, [filter]), [items[3]]);
  assert.equal(condition.value, '{"name":"b"}');
});

test("empty filters, invalid JSON and no-filter identity keep their existing behavior", () => {
  const items = [{ value: "[invalid" }, { value: "other" }];
  assert.equal(filterItems(items, []), items);
  assert.equal(filterItems(items, [{ kind: "sort", field: "value", dir: "asc" }]), items);
  assert.deepEqual(filterItems(items, [{ kind: "filter", conds: [] }]), []);
  assert.deepEqual(filterItems(items, [{ kind: "filter", conds: [{ field: "value", value: "[invalid", op: "eq" }] }]), [items[0]]);
  assert.deepEqual(filterItems([], [{ kind: "filter", conds: [] }]), []);
});

test("prepared list filters still short-circuit row field access", () => {
  const item = { first: true, get skipped(): unknown { throw new Error("unreachable field"); } };
  assert.deepEqual(filterItems([item], [
    { kind: "filter", conds: [
      { field: "first", op: "eq", value: "true" },
      { field: "skipped", op: "eq", value: "true" },
    ] },
    { kind: "filter", join: "or", conds: [{ field: "skipped", op: "eq", value: "true" }] },
  ]), [item]);
});


test("unused operands remain lazy, including empty input and short-circuited filters", () => {
  const skipped = { field: "value", op: "eq" as const, get value(): string { throw new Error("unused operand"); } };
  assert.deepEqual(filterItems([], [{ kind: "filter", conds: [skipped] }]), []);
  const items = [{ value: true }];
  assert.deepEqual(filterItems(items, [
    { kind: "filter", conds: [{ field: "value", op: "eq", value: "true" }, skipped] },
    { kind: "filter", join: "or", conds: [skipped] },
  ]), items);
  assert.deepEqual(filterItems(items, [
    { kind: "filter", conds: [{ field: "value", op: "eq", value: "false" }, { field: "value", op: "eq", and: true, get value(): string { throw new Error("unused operand"); } }] },
  ]), []);
});
