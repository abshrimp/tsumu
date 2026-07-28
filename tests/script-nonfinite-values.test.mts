import assert from "node:assert/strict";
import { test } from "node:test";
import { matchesValueCondition, setVarPath, withinScriptValueLimit } from "../lib/value-semantics";

test("non-finite numbers never silently change into JSON null or compare as valid values", () => {
  for (const bad of [NaN, Infinity, -Infinity]) {
    assert.equal(matchesValueCondition(bad, "eq", bad), false);
    assert.equal(matchesValueCondition([bad], "contains", bad), false);
    assert.equal(withinScriptValueLimit(bad), false);
    assert.equal(withinScriptValueLimit([1, { bad }]), false);
    const vars: Record<string, unknown> = { existing: 42 };
    assert.equal(setVarPath(vars, "existing", bad, withinScriptValueLimit), undefined);
    assert.equal(vars.existing, 42, "invalid writes must not mutate existing variables");
    assert.equal(setVarPath(vars, "nested.bad", bad, withinScriptValueLimit), undefined);
    assert.equal(Object.hasOwn(vars, "nested"), false);
  }
  assert.equal(withinScriptValueLimit(1), true);
  assert.equal(withinScriptValueLimit(null), true);
  assert.equal(withinScriptValueLimit(undefined), true, "undefined represents a missing value");
  assert.equal(withinScriptValueLimit([0, true, false, "text"]), true);
});

test("unsupported scalar kinds are rejected before JSON persistence", () => {
  for (const unsupported of [1n, Symbol("x"), () => 1]) {
    assert.equal(withinScriptValueLimit(unsupported), false);
    assert.equal(withinScriptValueLimit({ unsupported }), false);
  }
});
