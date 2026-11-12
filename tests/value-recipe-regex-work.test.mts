import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateValueRecipe } from "../lib/script-model/recipe-runtime";

// 書き出したページに出力するものと同じ、自己完結した評価器を動かす。置き換えるのは、
// この評価器の中のコンストラクターだけ。処理量の上限を試す準備は、どれもコンパイルしない。
const withConstructor = new Function("RegExp",
  "const __name = (fn) => fn; return (" + evaluateValueRecipe.toString() + ");");

function checkBudget(source: string, find: string, expectedPattern: string | null,
  variables: Record<string, unknown> = {}) {
  const compiled: [string, string][] = [];
  const evaluate = withConstructor(function (pattern: string, flags: string) {
    compiled.push([pattern, flags]);
    return /\uFFFF/g; // 固定の番兵は、ASCII のどの準備にも一致しない。
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
  // 3文字と2つの境界で、固定の1回のくり返しあたり5単位かかる。
  const field = "(?:abc){819}X";
  checkBudget("!", field, field); // 819 × 5 + 1 = 4096
  checkBudget("!", field + "Y", null);
});

test("the work for a fixed suffix depends on the source length", () => {
  // 探索を始める位置が n 通りあるとき、この前置部分と 64 単位の後ろの部分で、65n² かかる。
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
