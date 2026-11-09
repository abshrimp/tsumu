import assert from "node:assert/strict";
import { test } from "node:test";
import { setVarPath, withinScriptValueLimit } from "../lib/value-semantics";

test("nested writes reject sparse array indexes without changing the original variable", () => {
  const original = [{ name: "first" }];
  const vars: Record<string, unknown> = { rows: original };
  for (const invalid of ["rows.3", "rows.1000000", "rows.1000001"]) {
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
