import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { SCRIPT_RUNTIME } from "../lib/script-runtime";

// Exercise the exact predicate embedded in the browser/standalone export.
// Keep the injected dependencies tiny so the number of field reads is visible.
function exportedFilter() {
  const start = SCRIPT_RUNTIME.indexOf("function passOne(conds, item)");
  const end = SCRIPT_RUNTIME.indexOf("function passes(fs, item)", start);
  assert.ok(start > 0 && end > start);
  const source = SCRIPT_RUNTIME.slice(start, end);
  return runInNewContext(`(function () {
    function fieldOf(item, field) { return item[field]; }
    function matchValueCondition(value, op, expected) { return value === expected; }
    ${source}
    return passOne;
  })()`) as (conds: Array<{field:string; op:string; value:string; and?:boolean}>, item: object) => boolean;
}

test("client list predicates short-circuit satisfied OR groups", () => {
  const passOne = exportedFilter();
  let accesses = 0;
  const item = { flag: "yes", get expensive() { accesses++; throw new Error("unnecessary predicate"); } };
  assert.equal(passOne([
    { field: "flag", op: "eq", value: "yes" },
    { field: "expensive", op: "eq", value: "no", and: false },
  ], item), true);
  assert.equal(accesses, 0);
});

test("client list predicates short-circuit failed AND groups", () => {
  const passOne = exportedFilter();
  let accesses = 0;
  const item = { flag: "yes", get expensive() { accesses++; throw new Error("unnecessary predicate"); } };
  assert.equal(passOne([
    { field: "flag", op: "eq", value: "no" },
    { field: "expensive", op: "eq", value: "yes", and: true },
  ], item), false);
  assert.equal(accesses, 0);
});

test("client list predicates preserve normal AND-before-OR grouping", () => {
  const passOne = exportedFilter();
  const conds = [
    { field: "a", op: "eq", value: "yes" },
    { field: "b", op: "eq", value: "yes", and: false },
    { field: "c", op: "eq", value: "yes", and: true },
  ];
  assert.equal(passOne(conds, { a: "no", b: "yes", c: "yes" }), true);
  assert.equal(passOne(conds, { a: "no", b: "yes", c: "no" }), false);
  assert.equal(passOne(conds, { a: "yes", b: "no", c: "no" }), true);
  assert.equal(passOne([], {}), true);
});
