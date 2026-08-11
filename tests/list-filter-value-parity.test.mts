import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { PAGE_DATA_RUNTIME } from "../lib/generator/browser-data";
import { test } from "node:test";
import { resolvedListOps } from "../components/canvas/render";
import { filterItems, type ListOp } from "../lib/data";
import { filterPredicate } from "../lib/generator/render-helpers";
import { interpolate, lookupVar } from "../lib/vars";
import { matchesValueCondition, parseValueLiteral } from "../lib/value-semantics";

const passesStart = PAGE_DATA_RUNTIME.indexOf("  function passes(");
const passesEnd = PAGE_DATA_RUNTIME.indexOf("  function filter(", passesStart);
assert.ok(passesStart >= 0 && passesEnd > passesStart);
const browserPasses = runInNewContext(PAGE_DATA_RUNTIME.slice(passesStart, passesEnd) + "\npasses", {
  read: lookupVar, compare: (left: unknown, right: unknown, op: string) => matchesValueCondition(left, op, right), parseValueLiteral, interpolate,
});

const examples = [null, undefined, true, false, 2, "null", "false", "[1,2]", "", [1, 2], { name: "A", enabled: true }];
function evaluate(left: unknown, template: string, vars: Record<string, unknown>, op = "eq", not = false) {
  const ops: ListOp[] = [{ kind: "filter", conds: [{ field: "value", op: op as any, value: template, not }] }];
  const item = { value: left };
  const canvas = filterItems([item], resolvedListOps(new Map([["items", ops]]), "items", vars)).length > 0;
  const next = new Function("item", "vars", "lookupVar", "interpolate", `return ${filterPredicate(ops, "vars")}`)(item, vars, lookupVar, interpolate);
  const browser = browserPasses(item, (ops[0] as any).conds, vars);
  assert.equal(browser, next, JSON.stringify({ left, template, vars, op, not }));
  return { canvas, next };
}
for (const wanted of examples) test(`whole reference retains its JSON value: ${JSON.stringify(wanted)}`, () => {
  for (const left of examples) for (const not of [false, true]) {
    const expected = not !== matchesValueCondition(left, "eq", wanted);
    for (const template of ["{wanted}", " {wanted} ", "{nested.value}", "[slug]"]) {
      const actual = evaluate(left, template, { wanted, nested: { value: wanted }, slug: wanted }, "eq", not);
      assert.deepEqual(actual, { canvas: expected, next: expected }, JSON.stringify({left,wanted,template,not}));
    }
  }
});
test("missing variables remain undefined, not empty text or null", () => {
  for (const left of [undefined, null, ""]) {
    const expected = left === undefined;
    assert.deepEqual(evaluate(left, "{missing}", {}), { canvas: expected, next: expected });
  }
});
test("literal and mixed-template parsing keeps existing text and escape semantics", () => {
  const vars = { name: "A", count: 2, wanted: { name:"A" } };
  for (const template of ['{"name":"A"}', 'prefix {name}', '\\{name}', '"{name}"', '[{count}]', '{count}{count}', '{wanted} suffix', '[slug] suffix']) {
    const right = parseValueLiteral(interpolate(template, vars));
    for (const left of [...examples, right]) {
      const expected = matchesValueCondition(left,"eq",right);
      assert.deepEqual(evaluate(left,template,vars), {canvas:expected,next:expected},template);
    }
  }
});
test("typed references are preserved for all collection comparisons", () => {
  for (const op of ["in","contains","eq","has-key","empty","starts-with","ends-with","gte"])
    for (const wanted of examples) for (const left of examples) {
      const expected = matchesValueCondition(left,op,wanted);
      assert.deepEqual(evaluate(left,"{wanted}",{wanted},op), {canvas:expected,next:expected}, JSON.stringify({left,wanted,op}));
    }
});
