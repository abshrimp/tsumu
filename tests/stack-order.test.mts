import assert from "node:assert/strict";
import { test } from "node:test";
import { nextStackLevel } from "../lib/stack-order";

test("front and back cross all sibling stacking levels", () => {
  assert.equal(nextStackLevel("0", ["2", "20", "0"], "front"), 21);
  assert.equal(nextStackLevel("0", ["2", "-8", "0"], "back"), -9);
  assert.equal(nextStackLevel("30", ["0", "20"], "front"), null);
  assert.equal(nextStackLevel("-9", ["0", "-8"], "back"), null);
});
test("single steps cross only the nearest higher or lower group", () => {
  assert.equal(nextStackLevel("0", ["3", "30"], "forward"), 4);
  assert.equal(nextStackLevel("10", ["3", "-4"], "backward"), 2);
  assert.equal(nextStackLevel("0", [undefined, "7"], "forward"), 1);
  assert.equal(nextStackLevel("0", [undefined, "-7"], "backward"), -1);
});
test("no siblings means no change", () => {
  for (const a of ["front", "forward", "backward", "back"] as const)
    assert.equal(nextStackLevel("0", [], a), null);
});
test("integer limits are respected", () => {
  assert.equal(nextStackLevel("2147483647", ["2147483647"], "front"), null);
  assert.equal(nextStackLevel("-2147483647", ["-2147483647"], "back"), null);
  assert.equal(nextStackLevel("0", ["auto"], "front"), 1);
});
