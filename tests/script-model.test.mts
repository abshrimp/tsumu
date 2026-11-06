import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateExpression } from "../lib/script-model/evaluate.ts";
import { validateExpression } from "../lib/script-model/validate.ts";
import { HARD_LIMITS } from "../lib/script-model/values.ts";
import type { ErrorCode, Eval, Expr, Json, OpName, OperationFields, Path } from "../lib/script-model/types.ts";

const literal = (value: Json): Expr => ({ kind: "literal", value });
const ref = (symbolId: string, path: Path = []): Expr => ({ kind: "ref", root: { kind: "variable", symbolId }, path });
const binding = (scopeId: string, slot: "item" | "index" = "item", path: Path = []): Expr => ({ kind: "ref", root: { kind: "binding", scopeId, slot }, path });
const op = <K extends OpName>(name: K, fields: OperationFields[K]): Expr => ({ kind: "op", op: name, ...fields }) as Expr;
const plain = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
function resultValue(result: Eval): Json {
  assert.equal(result.kind, "value", JSON.stringify(result));
  return plain((result as Extract<Eval, { kind: "value" }>).value);
}
function error(result: Eval, code: ErrorCode, path?: string): void {
  assert.equal(result.kind, "error", JSON.stringify(result));
  assert.equal((result as Extract<Eval, { kind: "error" }>).code, code);
  if (path !== undefined) assert.equal((result as Extract<Eval, { kind: "error" }>).exprPath, path);
}
const evaluate = (expression: Expr, variables?: unknown): Json => resultValue(evaluateExpression(expression, variables));

test("literal braces and every JSON kind survive expression JSON round trips", () => {
  const values: Json[] = ["{商品}", "false", false, "0", 0, null, "", [], {}, [1, false, null, { title: "A" }]];
  for (const value of values) {
    const stored = plain(literal(value));
    assert.deepEqual(evaluate(stored), value);
    assert.deepEqual(evaluate(ref("id"), { id: value }), value);
  }
  assert.deepEqual(evaluateExpression(ref("absent")), { kind: "missing" });
  assert.equal(Object.is(evaluate(literal(-0)), -0), false);
});

test("references use IDs, explicit paths and own properties only", () => {
  const variables = { id: { "meta.name": "flat", meta: { name: "nested" }, "": "empty", 'quote"[x]': "quoted" }, list: ["a", "b"] };
  assert.equal(evaluate(ref("id", ["meta.name"]), variables), "flat");
  assert.equal(evaluate(ref("id", ["meta", "name"]), variables), "nested");
  assert.equal(evaluate(ref("id", [""]), variables), "empty");
  assert.equal(evaluate(ref("id", ['quote"[x]']), variables), "quoted");
  assert.equal(evaluate(ref("list", [0]), variables), "a");
  assert.equal(evaluate(ref("list", [-1]), variables), "b");
  for (const path of [[2], [-3]]) assert.deepEqual(evaluateExpression(ref("list", path), variables), { kind: "missing" });
  assert.deepEqual(evaluateExpression(ref("toString")), { kind: "missing" });
  assert.deepEqual(evaluateExpression(ref("id", ["toString"]), variables), { kind: "missing" });
  error(evaluateExpression(ref("list", ["0"]), variables), "type-mismatch");
  error(evaluateExpression(ref("id", [0]), variables), "type-mismatch");
  error(evaluateExpression(ref("id", ["meta", "name", "length"]), variables), "type-mismatch");
});

test("templates require strings and explicit scalar formatting", () => {
  const expression: Expr = { kind: "template", parts: ["Price: ", op("formatScalar", { source: ref("price") }), " {literal}"] };
  assert.equal(evaluate(expression, { price: 12.5 }), "Price: 12.5 {literal}");
  assert.equal(evaluate(op("formatScalar", { source: literal(false) })), "false");
  for (const value of [0, false, null, [], {}]) error(evaluateExpression({ kind: "template", parts: [literal(value)] }), "type-mismatch", "/parts/0");
  for (const value of [null, [], {}]) error(evaluateExpression(op("formatScalar", { source: literal(value) })), "type-mismatch", "/source");
  error(evaluateExpression({ kind: "template", parts: [ref("missing")] }), "missing-value", "/parts/0");
});

test("JSON conversion is explicit, finite, and does not swallow parse failures", () => {
  const data = { list: [null, false, 1, 'quotes"\\\n'], number: "12" };
  const stored = op("parseJson", { source: op("stringifyJson", { source: literal(data) }) });
  assert.deepEqual(evaluate(stored), data);
  assert.equal(evaluate(literal('{"a":1}')), '{"a":1}');
  assert.equal(evaluate(op("parseJson", { source: literal("null") })), null);
  error(evaluateExpression(op("parseJson", { source: literal("not JSON: SECRET") })), "invalid-json", "");
  assert.equal(JSON.stringify(evaluateExpression(op("parseJson", { source: literal("SECRET") }))).includes("SECRET"), false);
  error(evaluateExpression(op("parseJson", { source: literal("1e400") })), "invalid-json-value");
  const secretKeyError = evaluateExpression(op("parseJson", { source: literal('{"SECRET_KEY":1e400}') }));
  error(secretKeyError, "invalid-json-value", "");
  assert.equal(JSON.stringify(secretKeyError).includes("SECRET_KEY"), false);
  error(evaluateExpression(op("parseJson", { source: literal(123) })), "type-mismatch");
  error(evaluateExpression(op("stringifyJson", { source: ref("missing") })), "missing-value");
});

test("missing/null defaults are distinct and lazily evaluate valid fallbacks", () => {
  const fallback = op("parseJson", { source: literal("invalid JSON") });
  for (const value of [false, 0, "", [], {}]) {
    assert.deepEqual(evaluate(op("defaultIfNullish", { source: literal(value), fallback })), value);
  }
  assert.equal(evaluate(op("defaultIfMissing", { source: literal(null), fallback })), null);
  assert.equal(evaluate(op("defaultIfMissing", { source: ref("none"), fallback: literal("default") })), "default");
  assert.equal(evaluate(op("defaultIfNullish", { source: literal(null), fallback: literal("default") })), "default");
  assert.equal(evaluate(op("defaultIfNullish", { source: ref("none"), fallback: literal("default") })), "default");
  assert.equal(evaluate(op("isMissing", { source: ref("none") })), true);
  assert.equal(evaluate(op("isMissing", { source: literal(null) })), false);
});

test("defaults and missing tests never catch execution errors", () => {
  const source = op("parseJson", { source: literal("invalid") });
  error(evaluateExpression(op("isMissing", { source })), "invalid-json");
  error(evaluateExpression(op("defaultIfMissing", { source, fallback: literal(0) })), "invalid-json");
  error(evaluateExpression(op("defaultIfNullish", { source, fallback: literal(0) })), "invalid-json");
});

test("equal is deep, typed and independent of object key order", () => {
  const same = op("equal", { left: literal({ a: [1, null], b: false }), right: literal({ b: false, a: [1, null] }) });
  assert.equal(evaluate(same), true);
  for (const [left, right] of [["0", 0], [false, "false"], [null, ""], [[], {}], [[1, 2], [2, 1]], [{ a: null }, {}]] as [Json, Json][]) {
    assert.equal(evaluate(op("equal", { left: literal(left), right: literal(right) })), false);
  }
  error(evaluateExpression(op("equal", { left: ref("none"), right: literal(null) })), "missing-value");
});

test("map preserves primitives, nulls, arrays and zero-based indexes", () => {
  const source = [1, null, [2]];
  assert.deepEqual(evaluate(op("array.map", { source: literal(source), lambda: { scopeId: "row", body: binding("row") } })), source);
  assert.deepEqual(evaluate(op("array.map", { source: literal(source), lambda: { scopeId: "row", body: binding("row", "index") } })), [0, 1, 2]);
  assert.equal(evaluate(op("array.length", { source: literal(source) })), 3);
  assert.deepEqual(evaluate(op("array.map", { source: literal([]), lambda: { scopeId: "row", body: ref("missing") } })), []);
  error(evaluateExpression(op("array.map", { source: literal([1]), lambda: { scopeId: "row", body: ref("missing") } })), "missing-value", "/lambda/body");
});

test("nested lambdas retain explicitly named outer item/index and page variables", () => {
  const expression = op("array.map", {
    source: ref("rows"),
    lambda: { scopeId: "outer", body: op("array.map", {
      source: binding("outer", "item", ["children"]),
      lambda: { scopeId: "inner", body: { kind: "template", parts: [
        binding("outer", "item", ["title"]), "/", binding("inner"), "/", ref("title"), "/",
        op("formatScalar", { source: binding("outer", "index") }), "/", op("formatScalar", { source: binding("inner", "index") }),
      ] } },
    }) },
  });
  assert.deepEqual(evaluate(expression, { rows: [{ title: "A", children: ["x", "y"] }, { title: "B", children: ["z"] }], title: "page" }), [["A/x/page/0/0", "A/y/page/0/1"], ["B/z/page/1/0"]]);
});

test("filter requires boolean; find stops at first match and returns the actual item", () => {
  const source = literal([1, 2, 1]);
  const lambda = { scopeId: "row", body: op("equal", { left: binding("row"), right: literal(1) }) };
  assert.deepEqual(evaluate(op("array.filter", { source, lambda })), [1, 1]);
  assert.equal(evaluate(op("array.find", { source, lambda })), 1);
  assert.deepEqual(evaluateExpression(op("array.find", { source: literal([2]), lambda })), { kind: "missing" });
  error(evaluateExpression(op("array.filter", { source, lambda: { scopeId: "row", body: literal("true") } })), "type-mismatch", "/lambda/body");
  const shortCircuit = { scopeId: "row", body: binding("row", "item", ["match"]) };
  assert.deepEqual(evaluate(op("array.find", { source: literal([{ match: true }, null]), lambda: shortCircuit })), { match: true });
  error(evaluateExpression(op("array.filter", { source: literal([{ match: true }, null]), lambda: shortCircuit })), "type-mismatch");
});

test("lambda IDs have one lexical owner and cannot escape or shadow", () => {
  error(evaluateExpression(binding("outside")), "unbound-scope", "/root");
  const nested = op("array.map", { source: literal([1]), lambda: { scopeId: "same", body: op("array.map", { source: literal([1]), lambda: { scopeId: "same", body: binding("same") } }) } });
  error(evaluateExpression(nested), "duplicate-scope");
  const invalidSource = op("array.map", { source: binding("row"), lambda: { scopeId: "row", body: literal(1) } });
  error(evaluateExpression(invalidSource), "unbound-scope");
});

test("object get/has distinguish missing, null, false and explicit dotted keys", () => {
  const source = literal({ "a.b": null, a: { b: false }, arr: [0] });
  assert.equal(evaluate(op("object.get", { source, path: ["a.b"] })), null);
  assert.equal(evaluate(op("object.get", { source, path: ["a", "b"] })), false);
  assert.equal(evaluate(op("object.get", { source, path: ["arr", -1] })), 0);
  assert.equal(evaluate(op("object.has", { source, path: ["a.b"] })), true);
  assert.equal(evaluate(op("object.has", { source, path: ["absent"] })), false);
  assert.equal(evaluate(op("object.has", { source: literal(null), path: [] })), true);
  error(evaluateExpression(op("object.has", { source, path: ["a.b", "x"] })), "type-mismatch");
});

test("object updates copy paths and never mutate aliases or caller inputs", () => {
  const original = { detail: { price: 1 }, rows: [{ value: 2 }], nil: null };
  const variables = { original, alias: original };
  const before = JSON.stringify(variables);
  const updated = op("object.set", { source: ref("original"), path: ["detail", "price"], value: literal(3), missingParents: "error" });
  assert.deepEqual(evaluate(updated, variables), { detail: { price: 3 }, rows: [{ value: 2 }], nil: null });
  assert.deepEqual(evaluate(ref("alias"), variables), original);
  assert.equal(JSON.stringify(variables), before);
  assert.deepEqual(evaluate(op("object.remove", { source: updated, path: ["detail", "price"] }), variables), { detail: {}, rows: [{ value: 2 }], nil: null });
  assert.deepEqual(evaluate(op("object.remove", { source: ref("original"), path: ["absent", "x"] }), variables), original);
  error(evaluateExpression(op("object.set", { source: ref("original"), path: ["nil", "x"], value: literal(1), missingParents: "create" }), variables), "type-mismatch");
});

test("set creates only explicit parents and never creates sparse arrays", () => {
  const set = (path: Path, missingParents: "error" | "create", source: Json = {}): Expr => op("object.set", { source: literal(source), path, value: literal(false), missingParents });
  assert.deepEqual(evaluate(set(["a", "b"], "create")), { a: { b: false } });
  error(evaluateExpression(set(["a", "b"], "error")), "missing-parent");
  assert.deepEqual(evaluate(set(["a", 0, "b"], "create")), { a: [{ b: false }] });
  error(evaluateExpression(set(["a", 2], "create")), "invalid-path");
  error(evaluateExpression(set(["a", -1], "create")), "invalid-path");
  assert.deepEqual(evaluate(set([-1], "error", [1, 2])), [1, false]);
  assert.deepEqual(evaluate(set([2], "error", [1, 2])), [1, 2, false]);
  assert.deepEqual(evaluate(op("object.remove", { source: literal([1, 2, 3]), path: [-2] })), [1, 3]);
  error(evaluateExpression(set([], "create")), "invalid-expression");
});

test("dangerous JSON keys remain ordinary own keys through read/write/parse/stringify", () => {
  const original = JSON.parse('{"__proto__":{"polluted":"safe"},"constructor":{"prototype":{"x":1}},"prototype":2}');
  assert.equal(evaluate(ref("id", ["__proto__", "polluted"]), { id: original }), "safe");
  const updated = op("object.set", { source: literal(original), path: ["__proto__", "polluted"], value: literal("new"), missingParents: "error" });
  const output = evaluate(op("parseJson", { source: op("stringifyJson", { source: updated }) }));
  assert.deepEqual(output, JSON.parse('{"__proto__":{"polluted":"new"},"constructor":{"prototype":{"x":1}},"prototype":2}'));
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
  assert.deepEqual(evaluateExpression(ref("id", ["constructor"]), { id: {} }), { kind: "missing" });
  assert.deepEqual(evaluate(ref("__proto__"), JSON.parse('{"__proto__":3}')), 3);
  assert.deepEqual(evaluate(op("object.set", { source: literal({}), path: ["__proto__", "polluted"], value: literal(true), missingParents: "create" })), JSON.parse('{"__proto__":{"polluted":true}}'));
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

test("public results and validated trees are detached from input aliases", () => {
  const source = { a: { b: 1 } };
  const expression = literal(source);
  const validated = validateExpression(expression);
  assert.equal(validated.ok, true);
  const result = evaluateExpression(ref("source"), { source });
  assert.equal(result.kind, "value");
  if (result.kind === "value") (result.value as { a: { b: number } }).a.b = 99;
  source.a.b = 2;
  if (validated.ok) assert.deepEqual(evaluate(validated.expression), { a: { b: 1 } });
  assert.equal(source.a.b, 2);
});

test("validation rejects unknown operations, old shapes and extra/missing fields", () => {
  const invalid = [
    { kind: "set-var", name: "x", value: "1" }, { kind: "op", op: "constructor" },
    { kind: "op", op: "future.operation", source: literal(1) },
    { kind: "literal", value: 1, legacy: true }, { kind: "literal" },
    { kind: "op", op: "formatScalar", args: [literal(1)] },
    { kind: "ref", root: { kind: "variable", name: "x" }, path: [] },
    { kind: "ref", root: { kind: "variable", symbolId: "" }, path: [] },
    { kind: "ref", root: { kind: "parameter", source: "query", name: "x" }, path: [] },
    { kind: "template", parts: [1] },
    { kind: "op", op: "object.set", source: literal({}), path: ["x"], value: literal(1), missingParents: "guess" },
  ];
  for (const expression of invalid) {
    error(evaluateExpression(expression), "invalid-expression");
    assert.equal(validateExpression(expression).ok, false);
  }
  for (const index of [1.5, Number.MAX_SAFE_INTEGER + 1, null, true]) error(evaluateExpression({ kind: "ref", root: { kind: "variable", symbolId: "x" }, path: [index] }), "invalid-expression");
});

test("non-JSON values, cycles, sparse arrays and accessor side effects are rejected", () => {
  let calls = 0;
  const accessor = Object.defineProperty({}, "x", { enumerable: true, get() { calls++; return 1; } });
  const cycle: Record<string, unknown> = {}; cycle.self = cycle;
  const sparse = [1, , 3];
  const custom = Object.assign(Object.create({ inherited: 1 }), { own: 2 });
  const symbol = { [Symbol("hidden")]: 1 };
  const nonenumerable = Object.defineProperty({}, "x", { value: 1 });
  const toJSON = { toJSON() { calls++; return 1; } };
  for (const value of [undefined, NaN, Infinity, -Infinity, BigInt(1), () => 1, new Date(), cycle, sparse, accessor, custom, symbol, nonenumerable, toJSON]) {
    error(evaluateExpression({ kind: "literal", value }), "invalid-json-value");
  }
  assert.equal(calls, 0);
  error(evaluateExpression(literal(1), []), "invalid-context");
  error(evaluateExpression(literal(1), { bad: undefined }), "invalid-json-value");
});

test("resource limits cover input, parsing, recursion, output expansion and execution", () => {
  error(evaluateExpression(literal(1), {}, { maxSteps: 1 }), "limit-exceeded");
  error(evaluateExpression(literal("a".repeat(30)), {}, { maxTextUnits: 20 }), "limit-exceeded");
  error(evaluateExpression(literal([1, 2, 3]), {}, { maxNodes: 4 }), "limit-exceeded");
  let nested: Json = 0;
  for (let i = 0; i < 70; i++) nested = [nested];
  error(evaluateExpression(literal(nested)), "limit-exceeded");
  error(evaluateExpression(op("parseJson", { source: literal("[".repeat(70) + "0" + "]".repeat(70)) })), "limit-exceeded");
  const duplicated = op("array.map", { source: literal(Array(30).fill(0)), lambda: { scopeId: "row", body: ref("large") } });
  error(evaluateExpression(duplicated, { large: Array(30).fill(1) }, { maxNodes: 300 }), "limit-exceeded");
  error(evaluateExpression(op("stringifyJson", { source: duplicated }), { large: Array(30).fill(1) }, { maxNodes: 300 }), "limit-exceeded");
  const repeated = op("array.map", { source: literal(Array(100).fill(0)), lambda: { scopeId: "row", body: literal(0) } });
  error(evaluateExpression(repeated, {}, { maxSteps: 150 }), "limit-exceeded");
  for (const n of [0, -1, Infinity, 1.5, HARD_LIMITS.maxSteps + 1]) error(evaluateExpression(literal(1), {}, { maxSteps: n }), "invalid-limits");
  let reads = 0;
  const accessorLimit = Object.defineProperty({}, "maxSteps", { enumerable: true, get() { reads++; return 100; } });
  error(evaluateExpression(literal(1), {}, accessorLimit), "invalid-limits");
  assert.equal(reads, 0);
  error(evaluateExpression(literal(1), {}, Object.create({ maxSteps: 100 })), "invalid-limits");
  error(evaluateExpression(literal(1), {}, { unexpected: 1 } as never), "invalid-limits");
});

test("finite JSON output and error results are deterministic across repeated runs", () => {
  const expression = op("array.map", { source: ref("rows"), lambda: { scopeId: "row", body: op("object.set", { source: binding("row"), path: ["index"], value: binding("row", "index"), missingParents: "error" }) } });
  const variables = { rows: [{ title: "A" }, { title: "B" }] };
  const first = JSON.stringify(evaluateExpression(expression, variables));
  for (let i = 0; i < 10; i++) assert.equal(JSON.stringify(evaluateExpression(plain(expression), plain(variables))), first);
  assert.deepEqual(JSON.parse(first), { kind: "value", value: [{ title: "A", index: 0 }, { title: "B", index: 1 }] });
});

test("repeated parsing charges the source text and work before native parsing", () => {
  const expression = op("array.map", { source: literal(Array(20).fill(0)), lambda: { scopeId: "row", body: op("parseJson", { source: ref("text") }) } });
  const variables = { text: " ".repeat(1000) + "0" };
  assert.deepEqual(evaluate(expression, variables), Array(20).fill(0));
  error(evaluateExpression(expression, variables, { maxTextUnits: 2000, maxSteps: 500, maxNodes: 200 }), "limit-exceeded", "/lambda/body");
  error(evaluateExpression(expression, variables, { maxTextUnits: 2000, maxNodes: 200 }), "limit-exceeded", "/lambda/body");
  error(evaluateExpression(expression, variables, { maxSteps: 500, maxNodes: 200 }), "limit-exceeded", "/lambda/body");
});

test("repeated early-mismatch equality charges all object keys and array scans", () => {
  const left = Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`key${i}`, i]));
  const right = { ...left, extra: 1 };
  const expression = op("array.map", { source: literal(Array(50).fill(0)), lambda: { scopeId: "row", body: op("equal", { left: ref("left"), right: ref("right") }) } });
  assert.deepEqual(evaluate(expression, { left, right }), Array(50).fill(false));
  error(evaluateExpression(expression, { left, right }, { maxSteps: 1000 }), "limit-exceeded", "/lambda/body");
  const differentFirst = { ...left, key0: -1 };
  error(evaluateExpression(expression, { left, right: differentFirst }, { maxSteps: 1000 }), "limit-exceeded", "/lambda/body");
  const arrayLeft = Array(200).fill(0);
  const arrayRight = [-1, ...arrayLeft.slice(1)];
  error(evaluateExpression(expression, { left: arrayLeft, right: arrayRight }, { maxSteps: 1000 }), "limit-exceeded", "/lambda/body");
  const source = op("object.set", { source: literal(left), path: ["extra"], value: literal(1), missingParents: "error" });
  assert.equal(evaluate(op("equal", { left: source, right: literal(right) })), true);
  assert.equal(evaluate(op("equal", { left: op("object.remove", { source, path: ["extra"] }), right: literal(left) })), true);
});

test("empty template parts still consume work on every evaluation", () => {
  const expression = op("array.map", { source: literal(Array(50).fill(0)), lambda: { scopeId: "row", body: { kind: "template", parts: Array(500).fill("") } } });
  assert.deepEqual(evaluate(expression), Array(50).fill(""));
  error(evaluateExpression(expression, {}, { maxSteps: 1000 }), "limit-exceeded", "/lambda/body");
});

test("returned missing results cannot poison subsequent references or defaults", () => {
  const result = evaluateExpression(ref("absent"));
  assert.deepEqual(result, { kind: "missing" });
  assert.equal(Reflect.set(result, "kind", "value"), false);
  assert.equal(Reflect.set(result, "value", "poison"), false);
  assert.equal(Reflect.deleteProperty(result, "kind"), false);
  assert.deepEqual(evaluateExpression(ref("absent")), { kind: "missing" });
  assert.equal(evaluate(op("isMissing", { source: ref("absent") })), true);
  assert.equal(evaluate(op("defaultIfMissing", { source: ref("absent"), fallback: literal("default") })), "default");
  assert.equal(evaluate(op("defaultIfNullish", { source: ref("absent"), fallback: literal("default") })), "default");
});
