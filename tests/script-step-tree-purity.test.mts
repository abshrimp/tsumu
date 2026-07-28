import assert from "node:assert/strict";
import { test } from "node:test";
import { connectNewTransform, insertAt, listIn, takeAt } from "../components/script-editor/step-tree";
import type { Script, ScriptStep } from "../lib/types";

function fixture(): Script[] {
  return [{
    id: "script", pos: { x: 0, y: 0 }, steps: [{
      id: "decision", kind: "if",
      cond: { subject: "var", target: "", left: "ready", op: "eq", value: "true" },
      then: [{ id: "yes", kind: "wait", seconds: 1 }],
    }],
  }];
}

const elseLocation = { scriptId: "script", list: "decision:else", index: 0 };

test("looking up an absent else branch does not mutate the source script", () => {
  const scripts = fixture();
  const initial = structuredClone(scripts);
  assert.equal(listIn(scripts[0], elseLocation.list), null);
  assert.deepEqual(scripts, initial);
  const pending: ScriptStep[] = [{
    id: "transform", kind: "transform", source: "", into: "",
    transform: { kind: "length" },
  }];
  const connected = connectNewTransform(scripts, elseLocation, pending);
  assert.deepEqual(connected, pending);
  assert.deepEqual(scripts, initial);
  const [remaining, removed] = takeAt(scripts, elseLocation);
  assert.deepEqual(remaining, scripts);
  assert.deepEqual(removed, []);
  assert.deepEqual(scripts, initial);
});

test("inserting into a new else branch changes only the cloned document", () => {
  const scripts = fixture();
  const initial = structuredClone(scripts);
  const next = insertAt(scripts, elseLocation, [{ id: "no", kind: "wait", seconds: 2 }]);
  assert.notEqual(next, scripts);
  assert.deepEqual(scripts, initial);
  assert.deepEqual(listIn(next[0], elseLocation.list), [{ id: "no", kind: "wait", seconds: 2 }]);
  assert.equal(listIn(scripts[0], elseLocation.list), null);
});

test("connecting a new transform in an existing else branch preserves the source", () => {
  const scripts = fixture();
  const branch = scripts[0].steps[0];
  if (branch.kind !== "if") throw new Error("Expected if branch");
  branch.else = [{ id: "set", kind: "set-var", value: "hello", into: "message" }];
  const initial = structuredClone(scripts);
  const result = connectNewTransform(scripts, { ...elseLocation, index: 1 }, [{
    id: "transform", kind: "transform", source: "", into: "", transform: { kind: "field", key: "name" },
  }]);
  assert.equal(result.length, 1);
  assert.equal(result[0].kind, "transform");
  if (result[0].kind === "transform") {
    assert.equal(result[0].source, "message");
    assert.equal(result[0].into, "message");
  }
  assert.deepEqual(scripts, initial);
});
