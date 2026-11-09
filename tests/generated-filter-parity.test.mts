import assert from "node:assert/strict";
import { test } from "node:test";
import { filterPredicate } from "../lib/generator/render-helpers";
import { matchesValueCondition, parseValueLiteral } from "../lib/value-semantics";
import { interpolate, lookupVar } from "../lib/vars";

function actual(left: unknown, op: string, value: string) {
  const source = filterPredicate([{kind:"filter", conds:[{field:"value",op,value}]}] as any, "vars");
  return new Function("item", "vars", "interpolate", "lookupVar", `return ${source}`)({value:left}, {}, interpolate, lookupVar);
}
for (const [label,left,op,value] of [
  ["number text equality", "2", "eq", "2"],
  ["boolean text equality", "true", "eq", "true"],
  ["nested scalar equality", {a:"2"}, "eq", '{"a":2}'],
  ["array contains scalar text", ["2"], "contains", "2"],
  ["boolean comma membership", true, "in", "false,true"],
  ["numeric spelling preserved", 1, "in", "1.0,2"],
  ["overflow equality rejected", Infinity, "eq", "1e999"],
] as const) test(`generated filter matches preview: ${label}`, () => {
  assert.equal(actual(left,op,value), matchesValueCondition(left,op,parseValueLiteral(value)));
});
test("generated nested equality respects the same depth budget", () => {
  let left: any = {v:1}; for (let i=0;i<17;i++) left={next:left};
  assert.equal(actual(left,"eq",JSON.stringify(left)), matchesValueCondition(left,"eq",JSON.parse(JSON.stringify(left))));
});
test("ordinary filter operator matrix keeps preview parity", () => {
  for (const left of [null,undefined,false,true,0,1,2,"2","02","true","abc","null","annulling",[],[1,"2"],{}, {a:2}])
    for (const op of ["eq","contains","in","empty","has-key","starts-with","ends-with","gt","gte","lt","lte"])
      for (const value of ["null","false","true","0","2","02","abc","a","[]","[1,2]",'{"a":2}'])
        assert.equal(actual(left,op,value), matchesValueCondition(left,op,parseValueLiteral(value)), JSON.stringify({left,op,value}));
});
