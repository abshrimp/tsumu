import assert from "node:assert/strict";
import { test } from "node:test";
import type { ScriptStep } from "../lib/types";
import {
  isValueOperation, switchValueOperation, VALUE_OPERATION_KINDS,
} from "../lib/script-value-operations";

const base: ScriptStep = { id: "value", kind: "set-var", into: "chosen", value: "{data.tags}" };

test("seven existing output-producing actions are selectable as one editor operation", () => {
  assert.deepEqual(VALUE_OPERATION_KINDS, [
    "set-var", "count", "join", "split", "array-find", "calc", "replace",
  ]);
  for (const kind of VALUE_OPERATION_KINDS) {
    const switched = switchValueOperation(base, kind);
    assert.equal(switched.kind, kind);
    assert.equal(switched.id, "value");
    assert.equal(switched.into, "chosen");
    assert.ok(isValueOperation(switched));
    assert.equal(JSON.parse(JSON.stringify(switched)).kind, kind);
  }
});

test("converting a direct list reference preserves the selected list and output", () => {
  const count = switchValueOperation(base, "count");
  assert.deepEqual(count, { id: "value", kind: "count", into: "chosen", array: "data.tags" });
  const join = switchValueOperation(count, "join");
  assert.deepEqual(join, { id: "value", kind: "join", into: "chosen", array: "data.tags", sep: "、" });
  const find = switchValueOperation(join, "array-find");
  assert.deepEqual(find, {
    id: "value", kind: "array-find", into: "chosen", array: "data.tags", field: "", value: "",
  });
  const plain = switchValueOperation(find, "set-var");
  assert.deepEqual(plain, { id: "value", kind: "set-var", into: "chosen", value: "{data.tags}" });
});

test("compatible text sources and delimiters survive switching; incompatible fields are discarded", () => {
  const before: ScriptStep = {
    id: "step", kind: "replace", source: "a,b,c", find: "a", to: "x", regex: true, into: "parts",
  };
  const split = switchValueOperation(before, "split");
  assert.deepEqual(split, { id: "step", kind: "split", source: "a,b,c", sep: ",", into: "parts" });
  assert.deepEqual(switchValueOperation(split, "replace"), {
    id: "step", kind: "replace", source: "a,b,c", find: "", to: "", into: "parts",
  });
  assert.deepEqual(switchValueOperation(split, "join"), {
    id: "step", kind: "join", array: "", sep: ",", into: "parts",
  });
});

test("switching operations never mutates an existing saved step or unrelated side effects", () => {
  const immutable = JSON.stringify(base);
  assert.equal(switchValueOperation(base, "set-var"), base);
  const original: ScriptStep = { id: "x", kind: "fetch", url: "https://example.test" };
  assert.equal(switchValueOperation(original, "count"), original);
  assert.equal(isValueOperation(original), false);
  assert.equal(JSON.stringify(base), immutable);
});

test("non-reference text is not silently interpreted as a list variable", () => {
  const original: ScriptStep = {
    id: "x", kind: "set-var", value: "Hello {data.tags}", into: "greeting",
  };
  assert.deepEqual(switchValueOperation(original, "count"), {
    id: "x", kind: "count", array: "", into: "greeting",
  });
  assert.deepEqual(switchValueOperation(original, "split"), {
    id: "x", kind: "split", source: "Hello {data.tags}", sep: ",", into: "greeting",
  });
});
