import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateValueRecipe } from "../lib/script-model/recipe-runtime";
import { defaultTransform, VALUE_TRANSFORM_KINDS, parseValueOperandInput, formatValueOperandInput, type ValueTransform } from "../lib/script-model/compose";


test("list operation value fields infer typed literals while keeping variables and mixed text", () => {
  const examples = [
    ["hello", "text", "hello"],
    ["123", "number", "123"],
    ["-1.25", "number", "-1.25"],
    ["1e3", "number", "1e3"],
    ["true", "boolean", "true"],
    ["false", "boolean", "false"],
    ["null", "null", ""],
    ["00123", "text", "00123"],
    ["{count}", "text", "{count}"],
    ["hello {name}", "text", "hello {name}"],
    ['"123"', "text", "123"],
    ['"true"', "text", "true"],
    ['"null"', "text", "null"],
    ['"{name}"', "text", "\\{name}"],
    ['"Hello {name}"', "text", "Hello \\{name}"],
  ] as const;
  for (const [input, operandType, operand] of examples) {
    const parsed = parseValueOperandInput(input);
    assert.deepEqual(parsed, { operand, operandType });
    assert.deepEqual(parseValueOperandInput(formatValueOperandInput(parsed.operand, parsed.operandType)), parsed);
  }
  const numeric = parseValueOperandInput("12");
  const bool = parseValueOperandInput("true");
  const string = parseValueOperandInput('"true"');
  const variable = parseValueOperandInput("{value}");
  assert.deepEqual(evaluateValueRecipe([], [{ kind: "append", ...numeric }]), val([12]));
  assert.deepEqual(evaluateValueRecipe([], [{ kind: "append", ...bool }]), val([true]));
  assert.deepEqual(evaluateValueRecipe([], [{ kind: "append", ...string }]), val(["true"]));
  assert.deepEqual(evaluateValueRecipe([], [{ kind: "append", ...variable }], { value: 5 }), val([5]));
  assert.deepEqual(evaluateValueRecipe([], [{ kind: "append", operandType: "text", operand: "Hi {name}" }], { name: "A" }), val(["Hi A"]));
  const quoted = parseValueOperandInput('"{name}"');
  assert.deepEqual(evaluateValueRecipe([], [{ kind: "append", ...quoted }], { name: "A" }),
    val(["{name}"]), "quotes force a literal brace rather than a variable lookup");
  const quotedMixed = parseValueOperandInput('"Hello {name}"');
  assert.deepEqual(evaluateValueRecipe([], [{ kind: "append", ...quotedMixed }], { name: "A" }),
    val(["Hello {name}"]));
});

const run = (input: unknown, steps: readonly ValueTransform[]) => evaluateValueRecipe(input, steps);
const val = (value: unknown) => ({ kind: "value", value });

test("all advertised transforms have stable, serializable defaults", () => {
  assert.equal(VALUE_TRANSFORM_KINDS.length, 12);
  assert.equal(new Set(VALUE_TRANSFORM_KINDS).size, VALUE_TRANSFORM_KINDS.length);
  for (const kind of VALUE_TRANSFORM_KINDS) {
    const transform = defaultTransform(kind);
    assert.equal(transform.kind, kind);
    assert.doesNotThrow(() => JSON.parse(JSON.stringify(transform)));
  }
});



test("numeric operations accept number-like input, reject invalid coercions, and bound division", () => {
  assert.deepEqual(run(12, [
    { kind: "math", operation: "add", operand: 8 },
    { kind: "math", operation: "divide", operand: 4 },
  ]), val(5));
  assert.deepEqual(run("12", [{ kind: "math", operation: "add", operand: 1 }]), val(13));
  assert.deepEqual(run(true, [{ kind: "math", operation: "add", operand: 1 }]),
    { kind: "error", code: "type-mismatch" });
  assert.deepEqual(run("abc", [{ kind: "math", operation: "add", operand: 1 }]),
    { kind: "error", code: "type-mismatch" });
  assert.deepEqual(run(12, [{ kind: "math", operation: "divide", operand: 0 }]),
    { kind: "error", code: "division-by-zero" });
  assert.deepEqual(run(1e308, [{ kind: "math", operation: "multiply", operand: 10 }]),
    { kind: "error", code: "limit-exceeded" });
  assert.deepEqual(run(8, [{ kind: "math", operation: "remainder", operand: 3 }]), val(2));
  assert.deepEqual(run(8, [{ kind: "math", operation: "subtract", operand: 3 }]), val(5));
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


test("list paths support direct dotted keys, nested keys, and final array positions", () => {
  const value = {
    meta: { city: "Kyoto", scores: [3, 7] },
    "meta.city": "literal key wins",
    empty: { value: undefined },
  };
  assert.deepEqual(run(value, [{ kind: "field", key: "meta.city" }]), val("literal key wins"));
  assert.deepEqual(run(value, [{ kind: "field", key: "meta.scores.-1" }]), val(7));
  assert.deepEqual(run(value, [{ kind: "field", key: "meta.scores.3" }]), { kind: "missing" });
  assert.deepEqual(run(value, [{ kind: "field", key: "empty.value" }]), { kind: "missing" });
  assert.deepEqual(run(["red", "blue"], [{ kind: "field", key: "1" }]), val("blue"));
  assert.deepEqual(evaluateValueRecipe(undefined, [
    { kind: "fallback", text: "{meta.scores.-1}" },
  ], value), val(7));
});

test("fallback has one operation with missing-only or missing-or-null semantics", () => {
  assert.deepEqual(run(undefined, [{ kind: "fallback", text: "fallback" }]), val("fallback"));
  assert.deepEqual(run(null, [{ kind: "fallback", text: "fallback" }]), val(null));
  assert.deepEqual(run(null, [{ kind: "fallback", text: "fallback", when: "nullish" }]), val("fallback"));
  assert.deepEqual(run(false, [{ kind: "fallback", text: "fallback", when: "nullish" }]), val(false));
  assert.deepEqual(run(0, [{ kind: "fallback", text: "fallback", when: "nullish" }]), val(0));
  assert.deepEqual(evaluateValueRecipe(undefined, [
    { kind: "fallback", text: "Hello {name}" },
  ], { name: "A" }), val("Hello A"));
  assert.deepEqual(evaluateValueRecipe(undefined, [
    { kind: "fallback", text: "{record}" },
  ], { record: { count: 3 } }), val({ count: 3 }));
});

test("text, JSON and list conversion keep original typed data", () => {
  assert.deepEqual(run(123, [{ kind: "format" }]), val("123"));
  assert.deepEqual(run({ "0": "a" }, [{ kind: "stringify" }]), val('{"0":"a"}'));
  assert.deepEqual(run('{"0":"a"}', [{ kind: "parse" }]), val({ "0": "a" }));
  assert.deepEqual(run([1, 2], [{ kind: "length" }]), val(2));
  assert.deepEqual(run({ a: 1, b: 2 }, [{ kind: "length" }]), val(2));
});


test("value sort uses natural ordering consistent with displayed list sort", () => {
  const items = [
    { id: "10", label: "item 10" },
    { id: "2", label: "item 2" },
    { id: "1", label: "item 1" },
    { id: "2", label: "item 2 again" },
  ];
  assert.deepEqual(run(items, [{ kind: "sort", field: "id", direction: "asc" }]),
    val([items[2], items[1], items[3], items[0]]));
  assert.deepEqual(run(items, [{ kind: "sort", field: "id", direction: "desc" }]),
    val([items[0], items[1], items[3], items[2]]));
  assert.deepEqual(run(["10", "2", "1"], [{ kind: "sort", field: "", direction: "asc" }]),
    val(["1", "2", "10"]));
  assert.deepEqual(run([10, 2, 1], [{ kind: "sort", field: "", direction: "asc" }]),
    val([1, 2, 10]));
});

test("runtime source serialization works with the generated helper shim", () => {
  const source = evaluateValueRecipe.toString();
  const pure = new Function("const __name = (fn) => fn; return (" + source + ")")() as typeof evaluateValueRecipe;
  assert.deepEqual(pure([3, 1, 2], [{ kind: "sort", field: "", direction: "asc" }]), val([1, 2, 3]));
  assert.deepEqual(pure(5, [{ kind: "math", operation: "divide", operand: 2 }]), val(2.5));
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
  ]), val(15)); // The default operand is interpreted as a number.
});


test("append returns a new list with typed values and enforces limits", () => {
  const original = [1, 2];
  assert.deepEqual(run(original, [{ kind: "append", operandType: "number", operand: "3" }]), val([1, 2, 3]));
  assert.deepEqual(evaluateValueRecipe(original, [
    { kind: "append", operandType: "variable", operand: "row" },
  ], { row: { id: 1 } }), val([1, 2, { id: 1 }]));
  assert.deepEqual(run(original, [{ kind: "append", operandType: "variable", operand: "missing" }]),
    { kind: "error", code: "invalid-literal" });
  assert.deepEqual(run("not a list", [{ kind: "append", operandType: "null", operand: "" }]),
    { kind: "error", code: "type-mismatch" });
  assert.deepEqual(run(Array(10000).fill(1), [{ kind: "append", operandType: "number", operand: "2" }]),
    { kind: "error", code: "type-mismatch" });
  assert.deepEqual(original, [1, 2]);
});


test("string replacements refuse expansion beyond 100KB without allocating huge output", () => {
  const result = evaluateValueRecipe("a".repeat(10000), [{
    kind: "replace", find: "a", replacement: "x".repeat(10000), regex: false,
  }]);
  assert.deepEqual(result, { kind: "error", code: "limit-exceeded" });
  assert.deepEqual(evaluateValueRecipe("abracadabra", [{
    kind: "replace", find: "a", replacement: "XY", regex: false,
  }]), val("XYbrXYcXYdXYbrXY"));
});

test("dynamic regex replacements reject catastrophic patterns and ambiguous quantifiers", () => {
  // A naive replace with (a+)+$ on this input causes exponential backtracking.
  const input = "a".repeat(28) + "!";
  for (const pattern of ["(a+)+$", "((a+))+$", "((a|aa))+$", "(a|aa)+$", "a+a+$", ".*.*$", "([ab]+)([abc]+)$"]) {
    const result = evaluateValueRecipe(input, [{
      kind: "replace", find: pattern, replacement: "x", regex: true,
    }]);
    assert.deepEqual(result, { kind: "error", code: "invalid-regex" }, pattern);
  }
  assert.deepEqual(evaluateValueRecipe("abc123", [{
    kind: "replace", find: "([a-z]+)(\\d+)", replacement: "$2:$1", regex: true,
  }]), val("123:abc"));
});

test("regex text and replacement expansions have bounded execution and output", () => {
  const repeat = (text: string, find: string, replacement: string) =>
    evaluateValueRecipe(text, [{
      kind: "replace", find, replacement, regex: true,
    }]);
  assert.deepEqual(repeat("a".repeat(1000), "a", "x".repeat(1000)),
    { kind: "error", code: "limit-exceeded" });
  assert.deepEqual(repeat("a".repeat(1000), "a", "$'"),
    { kind: "error", code: "limit-exceeded" });
  assert.deepEqual(repeat("a".repeat(3000), "a", "x"),
    { kind: "error", code: "invalid-regex" });
  assert.deepEqual(repeat("abc123", "[a-z]+", "x"), val("x123"));
  assert.deepEqual(repeat("abc", "(a)", "$1$1"), val("aabc"));
});

test("serialized recipe runtime also rejects pathological regex and expansion", () => {
  const embedded = new Function("const __name = (fn) => fn; return (" +
    evaluateValueRecipe.toString() + ")")() as typeof evaluateValueRecipe;
  assert.deepEqual(embedded("a".repeat(28) + "!", [{
    kind: "replace", find: "(a+)+$", replacement: "x", regex: true,
  }]), { kind: "error", code: "invalid-regex" });
  assert.deepEqual(embedded("a".repeat(2000), [{
    kind: "replace", find: "a", replacement: "x".repeat(1000), regex: false,
  }]), { kind: "error", code: "limit-exceeded" });
});

