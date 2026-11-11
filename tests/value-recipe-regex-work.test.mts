import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateValueRecipe } from "../lib/script-model/recipe-runtime";

// Exercise the same self-contained evaluator emitted into exported pages. Only the
// constructor in this evaluator is replaced; none of the budget fixtures is compiled.
const withConstructor = new Function("RegExp",
  "const __name = (fn) => fn; return (" + evaluateValueRecipe.toString() + ");");

function checkBudget(source: string, find: string, expectedPattern: string | null,
  variables: Record<string, unknown> = {}) {
  const compiled: [string, string][] = [];
  const evaluate = withConstructor(function (pattern: string, flags: string) {
    compiled.push([pattern, flags]);
    return /\uFFFF/g; // The fixed sentinel does not match any of the ASCII fixtures.
  }) as typeof evaluateValueRecipe;
  const result = evaluate(source, [{ kind: "replace", find, replacement: "", regex: true }], variables);
  assert.deepEqual(compiled, expectedPattern === null ? [] : [[expectedPattern, "g"]]);
  assert.deepEqual(result, expectedPattern === null
    ? { kind: "error", code: "invalid-regex" }
    : { kind: "value", value: source });
}

test("independent choices in four code fields can use exactly 256 paths", () => {
  const code = "(?:N|S|E|W)(?:1|2|3|4)(?:a|b|c|d)(?:!|@|#|%)";
  checkBudget("N1a!", code, code);
  checkBudget("N1a!X", code + "(?:X|Y)", null);
});

test("fixed group expansion counts its two group boundaries", () => {
  // The three letters and two boundaries cost five units per fixed iteration.
  const field = "(?:abc){819}X";
  checkBudget("!", field, field); // 819 × 5 + 1 = 4096
  checkBudget("!", field + "Y", null);
});

test("the work for a fixed suffix depends on the source length", () => {
  // For n possible search starts, this prefix and its 64-unit suffix cost 65n².
  const field = "x+y{64}";
  checkBudget("-".repeat(507), field, field);
  checkBudget("-".repeat(508), field, null);
  checkBudget("-".repeat(508), "x+y", "x+y");
});

test("leaving a capture counts once per inner choice", () => {
  const field = "([A-Z]+)::";
  checkBudget("-".repeat(2046), field, field);
  checkBudget("-".repeat(2047), field, null);
  checkBudget("-".repeat(2047), "[A-Z]+::", "[A-Z]+::");
});

test("resolved pattern variables pass through the same budget before construction", () => {
  const field = "x+y{64}";
  checkBudget("-".repeat(507), "{format}", field, { format: field });
  checkBudget("-".repeat(508), "{format}", null, { format: field });
});

test("ordinary global replacements preserve capture order and unmatched text", () => {
  const result = evaluateValueRecipe("AB-07, CD-12.", [{
    kind: "replace", find: "{format}", regex: true, replacement: "$2/$1",
  }], { format: "([A-Z]{2})-([0-9]{2})" });
  assert.deepEqual(result, { kind: "value", value: "07/AB, 12/CD." });
});
