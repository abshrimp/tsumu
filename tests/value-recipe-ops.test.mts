import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateValueRecipe } from "../lib/script-model/recipe-runtime";
import { defaultTransform, VALUE_TRANSFORM_KINDS, type ValueTransform } from "../lib/script-model/compose";

const run = (input: unknown, steps: readonly ValueTransform[]) => evaluateValueRecipe(input, steps);
const val = (value: unknown) => ({ kind: "value", value });

test("all advertised transforms have stable, serializable defaults", () => {
  assert.equal(VALUE_TRANSFORM_KINDS.length, 23);
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
  assert.deepEqual(run("12", [{ kind: "math", operation: "add", operand: 1 }]), val(13));
  assert.deepEqual(run("not a number", [{ kind: "math", operation: "add", operand: 1 }]),
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

test("text fields combine text and variables without switching input modes", () => {
  const variables = { name: "田中", city: "京都", suffix: "さん", marker: "・", count: 7,
    dynamicField: "name", filterField: "city", entry: { id: 3 } };
  const evaluate = (input: unknown, steps: readonly ValueTransform[]) =>
    evaluateValueRecipe(input, steps, variables);

  assert.deepEqual(evaluate(undefined, [{ kind: "fallback", text: "こんにちは、{name}{suffix}" }]),
    val("こんにちは、田中さん"));
  assert.deepEqual(evaluate(undefined, [{ kind: "fallback", text: "{count}" }]), val(7));
  assert.deepEqual(evaluate(undefined, [{ kind: "fallback", text: "{entry}" }]), val({ id: 3 }));
  assert.deepEqual(evaluate(null, [{ kind: "fallback-nullish", text: "{entry}" }]), val({ id: 3 }));
  assert.deepEqual(evaluate(null, [{ kind: "fallback", text: "replaced" }]), val(null));
  assert.deepEqual(evaluate(undefined, [{ kind: "fallback", text: "Unknown: {unknown}" }]), val("Unknown: "));
  assert.deepEqual(evaluate(undefined, [{ kind: "fallback", text: "{unknown}" }]),
    { kind: "error", code: "missing-value" });
  assert.deepEqual(evaluate(undefined, [{ kind: "fallback", text: "\\{name}" }]), val("{name}"));

  assert.deepEqual(evaluate({ name: "work" }, [{ kind: "field", key: "{dynamicField}" }]), val("work"));
  assert.deepEqual(evaluate({ name: "work" }, [{ kind: "has", key: "{dynamicField}" }]), val(true));
  assert.deepEqual(evaluate("a・b", [{ kind: "split", separator: "{marker}" }]), val(["a", "b"]));
  assert.deepEqual(evaluate(["a", "b"], [{ kind: "join", separator: " {city} / " }]),
    val("a 京都 / b"));
  assert.deepEqual(evaluate("Hello, world", [{
    kind: "replace", find: "world", replacement: "{city}の{name}{suffix}", regex: false,
  }]), val("Hello, 京都の田中さん"));
  assert.deepEqual(evaluate("aaaa", [{
    kind: "replace", find: "a{2}", replacement: "x", regex: true,
  }]), val("xx"), "regex quantifiers must not be parsed as variable references");
  assert.deepEqual(evaluate("Hello, world", [{
    kind: "replace", find: "world", replacement: "{entry}", regex: false,
  }]), { kind: "error", code: "type-mismatch" });

  const records = [{ name: "a", city: "京都" }, { name: "b", city: "東京" }];
  assert.deepEqual(evaluate(records, [{
    kind: "filter", field: "{filterField}", operation: "eq", operandType: "text", operand: "{city}",
  }]), val([records[0]]));
  assert.deepEqual(evaluate(records, [{ kind: "map-field", field: "{dynamicField}" }]), val(["a", "b"]));
  assert.deepEqual(evaluate(records, [{
    kind: "map-set", field: "{dynamicField}", operandType: "text", operand: "Hi {name}",
  }]), val([{ name: "Hi 田中", city: "京都" }, { name: "Hi 田中", city: "東京" }]));
  assert.deepEqual(evaluate(records, [{
    kind: "sort", field: "{dynamicField}", direction: "desc",
  }]), val([records[1], records[0]]));
  assert.deepEqual(evaluate([], [{
    kind: "append", operandType: "text", operand: "{entry}",
  }]), val([{ id: 3 }]), "a single token retains its native object value");
  assert.deepEqual(evaluate("田中さん", [{
    kind: "compare", operation: "eq", operandType: "text", operand: "{name}{suffix}",
  }]), val(true));
  assert.deepEqual(evaluate([{ name: "a" }], [{
    kind: "map-set", field: "{danger}", operandType: "text", operand: "unsafe",
  }]), { kind: "error", code: "type-mismatch" }, "undefined field names fail safely");
  assert.deepEqual(evaluateValueRecipe([{ name: "a" }], [{
    kind: "map-set", field: "{danger}", operandType: "text", operand: "unsafe",
  }], { danger: "__proto__" }), { kind: "error", code: "invalid-path" });
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

test("comparisons and list operations resolve typed variables, including nested paths", () => {
  assert.deepEqual(evaluateValueRecipe(12, [
    { kind: "compare", operation: "gt", operandType: "variable", operand: "limit" },
  ], { limit: 10 }), { kind: "value", value: true });
  assert.deepEqual(evaluateValueRecipe([{ score: 2 }, { score: 5 }], [
    { kind: "filter", field: "score", operation: "gte", operandType: "variable", operand: "settings.minimum" },
    { kind: "map-field", field: "score" },
  ], { settings: { minimum: 5 } }), { kind: "value", value: [5] });
  assert.deepEqual(evaluateValueRecipe("abc", [
    { kind: "compare", operation: "eq", operandType: "variable", operand: "missing" },
  ], {}), { kind: "error", code: "invalid-literal" });
});

test("math operands can resolve nested variables and safely parse numeric form strings", () => {
  assert.deepEqual(evaluateValueRecipe("12.5", [
    { kind: "math", operation: "multiply", operandType: "variable", operand: "settings.taxRate" },
  ], { settings: { taxRate: "1.1" } }), val(13.750000000000002));
  assert.deepEqual(evaluateValueRecipe(12, [
    { kind: "math", operation: "divide", operandType: "variable", operand: "rate" },
  ], { rate: "0" }), { kind: "error", code: "division-by-zero" });
  assert.deepEqual(evaluateValueRecipe(12, [
    { kind: "math", operation: "add", operandType: "variable", operand: "bad" },
  ], { bad: "twelve" }), { kind: "error", code: "type-mismatch" });
  assert.deepEqual(evaluateValueRecipe(12, [
    { kind: "math", operation: "add", operandType: "variable", operand: "missing" },
  ], {}), { kind: "error", code: "type-mismatch" });
  assert.deepEqual(evaluateValueRecipe(12, [
    { kind: "math", operation: "add", operand: 3 },
  ]), val(15)); // Existing documents without operandType still work.
});

test("list additions and removals compose without changing their inputs", () => {
  const original = [1, 2, 2, 3];
  const data = { value: { id: 7 } };
  assert.deepEqual(evaluateValueRecipe(original, [
    { kind: "append", operandType: "variable", operand: "value" },
  ], data), val([1, 2, 2, 3, { id: 7 }]));
  assert.deepEqual(run(original, [
    { kind: "remove", operandType: "number", operand: "2" },
    { kind: "append", operandType: "number", operand: "4" },
    { kind: "remove-at", index: 0 },
  ]), val([3, 4]));
  assert.deepEqual(run(original, [{ kind: "remove-at", index: -1 }]), val([1, 2, 2]));
  assert.deepEqual(run(original, [{ kind: "remove-at", index: 100 }]), val(original));
  assert.deepEqual(run(original, [{ kind: "append", operandType: "variable", operand: "missing" }]),
    { kind: "error", code: "invalid-literal" });
  assert.deepEqual(run("not a list", [{ kind: "append", operandType: "null", operand: "" }]),
    { kind: "error", code: "type-mismatch" });
  assert.deepEqual(run(Array(10000).fill(1), [{ kind: "append", operandType: "number", operand: "2" }]),
    { kind: "error", code: "limit-exceeded" });
  assert.deepEqual(original, [1, 2, 2, 3]);
});

