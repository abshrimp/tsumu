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
  assert.equal(VALUE_TRANSFORM_KINDS.length, 24);
  assert.equal(new Set(VALUE_TRANSFORM_KINDS).size, VALUE_TRANSFORM_KINDS.length);
  for (const kind of VALUE_TRANSFORM_KINDS) {
    const transform = defaultTransform(kind);
    assert.equal(transform.kind, kind);
    assert.doesNotThrow(() => JSON.parse(JSON.stringify(transform)));
  }
});

test("numeric arithmetic and text comparisons follow shared if/list rules", () => {
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
    { kind: "compare", operation: "gt", operand: "10" },
    { kind: "not" },
  ]), val(false));
  assert.deepEqual(run("10", [{ kind: "compare", operation: "eq", operand: "10" }]), val(true));
  assert.deepEqual(run("B", [{ kind: "compare", operation: "contains", operand: "B" }]), val(true));
  assert.deepEqual(run(false, [{ kind: "not" }]), val(true));
  assert.deepEqual(run(0, [{ kind: "not" }]), { kind: "error", code: "type-mismatch" });
  assert.deepEqual(run(10, [{ kind: "compare", operation: "gt", operand: "NaN" }]), val(false));
});

test("value operations use if/list operators with negation and grouped AND/OR conditions", () => {
  // A numeric comparison parses its input without a separate operand-type selector.
  const numeric = (input: unknown, not = false) => evaluateValueRecipe(input, [{
    kind: "compare", operation: "gte", operand: "10", not,
    conditions: [
      { field: "", operation: "lte", operand: "20", and: true },
      { field: "", operation: "eq", operand: "40", and: false },
    ],
  }]);
  assert.deepEqual(numeric(15), val(true));
  assert.deepEqual(numeric(25), val(false));
  assert.deepEqual(numeric(40), val(true));
  assert.deepEqual(numeric(15, true), val(false));
  assert.deepEqual(evaluateValueRecipe("hello", [
    { kind: "compare", operation: "contains", operand: "lo", not: true },
  ]), val(false));
  assert.deepEqual(evaluateValueRecipe("b", [
    { kind: "compare", operation: "in", operand: "a, b, c" },
  ]), val(true));
  assert.deepEqual(evaluateValueRecipe("", [
    { kind: "compare", operation: "empty", operand: "" },
  ]), val(true));
  assert.deepEqual(evaluateValueRecipe("text", [
    { kind: "compare", operation: "empty", operand: "", not: true },
  ]), val(true));

  const items = [
    { name: "Alpha", score: 12 }, { name: "Beta", score: 18 },
    { name: "Gamma", score: 25 }, { name: "Delta", score: 40 },
  ];
  const conditions = [
    { field: "score", operation: "lte" as const, operand: "20", and: true },
    { field: "name", operation: "contains" as const, operand: "Del", and: false },
  ];
  assert.deepEqual(evaluateValueRecipe(items, [{
    kind: "filter", field: "score", operation: "gte", operand: "10",
    conditions,
  }]), val([items[0], items[1], items[3]]));
  assert.deepEqual(evaluateValueRecipe(items, [{
    kind: "find", field: "name", operation: "contains", operand: "mm",
    not: true,
  }]), val(items[0]));
  assert.deepEqual(evaluateValueRecipe(items, [{
    kind: "filter", field: "score", operation: "gte", operand: "10",
    conditions: [{ field: "name", operation: "contains", operand: "t", not: true, and: true }],
  }]), val([items[0], items[2]]));
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

test("unfinished transform conditions do not change results and keep OR boundaries", () => {
  const inactive = { field: "", operation: "eq" as const, operand: "", configured: false };
  const enabled = { field: "", operation: "eq" as const, operand: "yes", and: true };
  assert.deepEqual(run("yes", [{
    kind: "compare", operation: "eq", operand: "yes", conditions: [{ ...inactive, and: true }],
  }]), val(true));
  assert.deepEqual(run("no", [{
    kind: "compare", operation: "eq", operand: "yes",
    conditions: [{ ...inactive, and: false }, enabled],
  }]), val(false));
  assert.deepEqual(run("yes", [{
    kind: "compare", operation: "eq", operand: "no",
    conditions: [{ ...inactive, and: false }, enabled],
  }]), val(true), "OR boundary survives the incomplete clause before an AND");
  assert.deepEqual(run("no", [{
    kind: "compare", operation: "eq", operand: "no",
    conditions: [{ ...inactive, and: false }],
  }]), val(true), "an unfinished final OR group is ignored");
  const rows = [
    { active: "yes", role: "user" },
    { active: "no", role: "admin" },
    { active: "no", role: "user" },
  ];
  assert.deepEqual(run(rows, [{
    kind: "filter", field: "active", operation: "eq", operand: "yes",
    conditions: [
      { ...inactive, and: false },
      { field: "role", operation: "eq", operand: "admin", and: true },
    ],
  }]), val(rows.slice(0, 2)));
  // The absence of configured is intentional compatibility with saved clauses.
  assert.deepEqual(run("yes", [{
    kind: "compare", operation: "eq", operand: "yes",
    conditions: [{ field: "", operation: "eq", operand: "", and: true }],
  }]), val(false));
});

test("nested JSON paths and negative-one array indices use common lookup rules", () => {
  const obj = {
    meta: { city: "Kyoto", scores: [3, 7] },
    "meta.city": "literal key wins",
    empty: { value: undefined },
  };
  assert.deepEqual(run(obj, [{ kind: "field", key: "meta.city" }]), val("literal key wins"));
  assert.deepEqual(run(obj, [{ kind: "field", key: "meta.scores.-1" }]), val(7));
  assert.deepEqual(run(obj, [{ kind: "has", key: "meta.scores.-1" }]), val(true));
  assert.deepEqual(run(obj, [{ kind: "has", key: "meta.scores.3" }]), val(false));
  assert.deepEqual(run(obj, [{ kind: "field", key: "meta.scores.3" }]), { kind: "missing" });
  assert.deepEqual(run(obj, [{ kind: "has", key: "empty.value" }]), val(true),
    "presence checks distinguish own undefined values from nonexistent keys");
  assert.deepEqual(run(obj, [{ kind: "field", key: "empty.value" }]), { kind: "missing" });
  assert.deepEqual(run([{ score: [1, 4] }, { score: [2, 6] }], [
    { kind: "map-field", field: "score.-1" },
  ]), val([4, 6]));
  assert.deepEqual(evaluateValueRecipe(undefined, [{
    kind: "fallback", text: "{meta.scores.-1}",
  }], obj), val(7));
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
    kind: "filter", field: "{filterField}", operation: "eq", operand: "{city}",
  }]), val([records[0]]));
  assert.deepEqual(evaluate(records, [{ kind: "map-field", field: "{dynamicField}" }]), val(["a", "b"]));
  assert.equal(JSON.stringify(evaluate(records, [{
    kind: "map-set", field: "{dynamicField}", operandType: "text", operand: "Hi {name}",
  }])), JSON.stringify(val([{ name: "Hi 田中", city: "京都" }, { name: "Hi 田中", city: "東京" }])));
  assert.deepEqual(evaluate(records, [{
    kind: "sort", field: "{dynamicField}", direction: "desc",
  }]), val([records[1], records[0]]));
  assert.deepEqual(evaluate([], [{
    kind: "append", operandType: "text", operand: "{entry}",
  }]), val([{ id: 3 }]), "a single token retains its native object value");
  assert.deepEqual(evaluate("田中さん", [{
    kind: "compare", operation: "eq", operand: "{name}{suffix}",
  }]), val(true));
  assert.deepEqual(evaluate([{ name: "a" }], [{
    kind: "map-set", field: "{danger}", operandType: "text", operand: "unsafe",
  }]), { kind: "error", code: "type-mismatch" }, "undefined field names fail safely");
  assert.deepEqual(evaluateValueRecipe([{ name: "a" }], [{
    kind: "map-set", field: "{danger}", operandType: "text", operand: "unsafe",
  }], { danger: "__proto__" }), { kind: "error", code: "invalid-path" });
});

test("object dictionaries support dynamic date keys and configurable entry-list fields", () => {
  const holidays = { "2026-11-03": "文化の日", "2026-11-23": "勤労感謝の日", "2027-01-01": "元日" };
  const original = structuredClone(holidays);
  const vars = { date: "2026-11-23", dateLabel: "日付", holidayLabel: "祝日名" };
  assert.deepEqual(evaluateValueRecipe(holidays, [{ kind: "field", key: "{date}" }], vars), val("勤労感謝の日"));
  assert.deepEqual(evaluateValueRecipe(holidays, [{ kind: "has", key: "{date}" }], vars), val(true));
  assert.deepEqual(evaluateValueRecipe(holidays, [{ kind: "has", key: "2026-11-24" }], vars), val(false));
  assert.deepEqual(evaluateValueRecipe(holidays, [{ kind: "field", key: "2026-11-24" }], vars),
    { kind: "missing" });
  assert.deepEqual(evaluateValueRecipe(holidays, [{
    kind: "object-entries", keyField: "{dateLabel}", valueField: "{holidayLabel}",
  }], vars), val([
    { "日付": "2026-11-03", "祝日名": "文化の日" },
    { "日付": "2026-11-23", "祝日名": "勤労感謝の日" },
    { "日付": "2027-01-01", "祝日名": "元日" },
  ]));
  assert.deepEqual(evaluateValueRecipe(holidays, [
    { kind: "object-entries", keyField: "日付", valueField: "祝日名" },
    { kind: "filter", field: "祝日名", operation: "contains", operand: "の日" },
    { kind: "sort", field: "日付", direction: "desc" },
    { kind: "map-field", field: "祝日名" },
    { kind: "join", separator: "・" },
  ]), val("勤労感謝の日・文化の日"));
  assert.deepEqual(holidays, original, "Object conversion must not mutate the original JSON");
});

test("object entry conversion validates input types, field names and limits", () => {
  const good = { kind: "object-entries", keyField: "キー", valueField: "値" } as const;
  assert.deepEqual(run({}, [good]), val([]));
  assert.deepEqual(run({ one: null, two: 2 }, [good]),
    val([{ "キー": "one", "値": null }, { "キー": "two", "値": 2 }]));
  assert.deepEqual(run(null, [good]), { kind: "error", code: "type-mismatch" });
  assert.deepEqual(run(["one"], [good]), { kind: "error", code: "type-mismatch" });
  assert.deepEqual(run("value", [good]), { kind: "error", code: "type-mismatch" });
  assert.deepEqual(run({}, [{ ...good, keyField: "" }]), { kind: "error", code: "invalid-path" });
  assert.deepEqual(run({}, [{ ...good, valueField: "キー" }]), { kind: "error", code: "invalid-path" });
  assert.deepEqual(run({}, [{ ...good, keyField: "__proto__" }]), { kind: "error", code: "invalid-path" });
  assert.deepEqual(run({}, [{ ...good, valueField: "constructor" }]), { kind: "error", code: "invalid-path" });
  const malicious = JSON.parse('{"__proto__": "safe", "constructor": 17, "2026-11-23": "勤労感謝の日"}');
  assert.deepEqual(run(malicious, [good]), val([
    { "キー": "__proto__", "値": "safe" },
    { "キー": "constructor", "値": 17 },
    { "キー": "2026-11-23", "値": "勤労感謝の日" },
  ]));
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
  const oversized = Object.fromEntries(Array.from({ length: 10001 }, (_, i) => ["k" + i, i]));
  assert.deepEqual(run(oversized, [good]), { kind: "error", code: "limit-exceeded" });
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

test("list find/filter/sort/map are immutable and distinguish missing from null", () => {
  const original = [
    { id: 3, name: "Gamma", meta: { active: false } },
    { id: 1, name: "Alpha", meta: { active: true } },
    { id: 2, name: "Beta", meta: { active: true } },
  ];
  const before = structuredClone(original);
  assert.deepEqual(run(original, [
    { kind: "filter", field: "meta.active", operation: "eq", operand: "true" },
    { kind: "sort", field: "id", direction: "desc" },
    { kind: "map-field", field: "name" },
  ]), val(["Beta", "Alpha"]));
  assert.deepEqual(run(original, [
    { kind: "find", field: "id", operation: "eq", operand: "3" },
    { kind: "field", key: "name" },
  ]), val("Gamma"));
  assert.deepEqual(run(original, [
    { kind: "find", field: "id", operation: "eq", operand: "99" },
  ]), { kind: "missing" });
  assert.deepEqual(run(original, [
    { kind: "map-set", field: "selected", operandType: "boolean", operand: "true" },
    { kind: "map-field", field: "selected" },
  ]), val([true, true, true]));
  assert.deepEqual(original, before);
  assert.deepEqual(run(["red", "blue", "red"], [
    { kind: "filter", field: "", operation: "eq", operand: "red" },
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

test("comparison fields interpolate variables without operand types", () => {
  assert.deepEqual(evaluateValueRecipe(12, [
    { kind: "compare", operation: "gt", operand: "{limit}" },
  ], { limit: 10 }), { kind: "value", value: true });
  assert.deepEqual(evaluateValueRecipe([{ score: 2 }, { score: 5 }], [
    { kind: "filter", field: "score", operation: "gte", operand: "{settings.minimum}" },
    { kind: "map-field", field: "score" },
  ], { settings: { minimum: 5 } }), { kind: "value", value: [5] });
  assert.deepEqual(evaluateValueRecipe("abc", [
    { kind: "compare", operation: "eq", operand: "{missing}" },
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

