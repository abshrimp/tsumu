import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateValueRecipe } from "../lib/script-model/recipe-runtime";
import { defaultTransform, VALUE_TRANSFORM_KINDS, type ValueTransform } from "../lib/script-model/compose";

const run = (input: unknown, steps: readonly ValueTransform[]) => evaluateValueRecipe(input, steps);
const val = (value: unknown) => ({ kind: "value", value });

test("all advertised transforms have stable, serializable defaults", () => {
  assert.equal(VALUE_TRANSFORM_KINDS.length, 20);
  assert.equal(new Set(VALUE_TRANSFORM_KINDS).size, VALUE_TRANSFORM_KINDS.length);
  for (const kind of VALUE_TRANSFORM_KINDS) {
    const transform = defaultTransform(kind);
    assert.equal(transform.kind, kind);
    assert.doesNotThrow(() => JSON.parse(JSON.stringify(transform)));
  }
});

test("numeric arithmetic and comparison have explicit types and errors", () => {
  assert.deepEqual(run(12, [
    { kind: "math", operation: "add", operand: 8 },
    { kind: "math", operation: "divide", operand: 4 },
  ]), val(5));
  assert.deepEqual(run(8, [{ kind: "math", operation: "remainder", operand: 3 }]), val(2));
  assert.deepEqual(run(8, [{ kind: "math", operation: "subtract", operand: 3 }]), val(5));
  assert.deepEqual(run(3, [{ kind: "math", operation: "multiply", operand: 3 }]), val(9));
  assert.deepEqual(run("12", [{ kind: "math", operation: "add", operand: 1 }]),
    { kind: "error", code: "type-mismatch" });
  assert.deepEqual(run(12, [{ kind: "math", operation: "divide", operand: 0 }]),
    { kind: "error", code: "division-by-zero" });
  assert.deepEqual(run(1e308, [{ kind: "math", operation: "multiply", operand: 10 }]),
    { kind: "error", code: "limit-exceeded" });
  assert.deepEqual(run(12, [
    { kind: "compare", operation: "gt", operandType: "number", operand: "10" },
    { kind: "not" },
  ]), val(false));
  assert.deepEqual(run("10", [{ kind: "compare", operation: "eq", operandType: "number", operand: "10" }]), val(false));
  assert.deepEqual(run("B", [{ kind: "compare", operation: "contains", operandType: "text", operand: "B" }]), val(true));
  assert.deepEqual(run(false, [{ kind: "not" }]), val(true));
  assert.deepEqual(run(0, [{ kind: "not" }]), { kind: "error", code: "type-mismatch" });
  assert.deepEqual(run(10, [{ kind: "compare", operation: "gt", operandType: "number", operand: "NaN" }]), { kind: "error", code: "invalid-literal" });
});

test("split, join and replace compose without implicit coercion", () => {
  const items = run(" blue, , red, green ", [{ kind: "split", separator: "," }]);
  assert.deepEqual(items, val(["blue", "red", "green"]));
  assert.deepEqual(run((items as {kind:"value";value:unknown}).value, [{ kind: "join", separator: "/" }]), val("blue/red/green"));
  assert.deepEqual(run([0, false, "a", "", null], [{ kind: "join", separator: "-" }]), val("0-false-a"));
  assert.deepEqual(run([{ name: "A" }], [{ kind: "join", separator: "," }]), { kind: "error", code: "type-mismatch" });
  assert.deepEqual(run("banana", [{ kind: "replace", find: "na", replacement: "X", regex: false }]), val("baXX"));
  assert.deepEqual(run("ab12 cd34", [{ kind: "replace", find: "([a-z]+)(\\d+)", replacement: "$2:$1", regex: true }]), val("12:ab 34:cd"));
  assert.deepEqual(run("a", [{ kind: "replace", find: "(", replacement: "", regex: true }]), { kind: "error", code: "invalid-regex" });
});

test("list find/filter/sort/map are immutable and distinguish missing from null", () => {
  const original = [
    { id: 3, name: "Gamma", meta: { active: false } },
    { id: 1, name: "Alpha", meta: { active: true } },
    { id: 2, name: "Beta", meta: { active: true } },
  ];
  const before = structuredClone(original);
  assert.deepEqual(run(original, [
    { kind: "filter", field: "meta.active", operation: "eq", operandType: "boolean", operand: "true" },
    { kind: "sort", field: "id", direction: "desc" },
    { kind: "map-field", field: "name" },
  ]), val(["Beta", "Alpha"]));
  assert.deepEqual(run(original, [
    { kind: "find", field: "id", operation: "eq", operandType: "number", operand: "3" },
    { kind: "field", key: "name" },
  ]), val("Gamma"));
  assert.deepEqual(run(original, [
    { kind: "find", field: "id", operation: "eq", operandType: "number", operand: "99" },
  ]), { kind: "missing" });
  assert.deepEqual(run(original, [
    { kind: "map-set", field: "selected", operandType: "boolean", operand: "true" },
    { kind: "map-field", field: "selected" },
  ]), val([true, true, true]));
  assert.deepEqual(original, before);
  assert.deepEqual(run(["red", "blue", "red"], [
    { kind: "filter", field: "", operation: "eq", operandType: "text", operand: "red" },
  ]), val(["red", "red"]));
  assert.deepEqual(run([{ score: 1 }, { score: null }], [
    { kind: "sort", field: "score", direction: "asc" },
  ]), { kind: "error", code: "type-mismatch" });
  assert.deepEqual(run([{ id: 1 }, { name: "two" }], [
    { kind: "map-field", field: "id" },
  ]), { kind: "error", code: "missing-value" });
  assert.deepEqual(run([{ id: 1 }], [
    { kind: "map-set", field: "__proto__", operandType: "text", operand: "unsafe" },
  ]), { kind: "error", code: "invalid-path" });
});

test("runtime source serialization works with the generated helper shim", () => {
  const source = evaluateValueRecipe.toString();
  const pure = new Function("const __name = (fn) => fn; return (" + source + ")")() as typeof evaluateValueRecipe;
  assert.deepEqual(pure([3, 1, 2], [{ kind: "sort", field: "", direction: "asc" }]), val([1, 2, 3]));
  assert.deepEqual(pure(5, [{ kind: "math", operation: "divide", operand: 2 }]), val(2.5));
});
