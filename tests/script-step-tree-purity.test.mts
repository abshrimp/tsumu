import assert from "node:assert/strict";
import { test } from "node:test";
import { connectNewTransform, insertAt, listIn, takeAt, takeSelectedSteps } from "../components/script-editor/step-tree";
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

test("duplicate branch IDs resolve the first owner in both reads and edits", () => {
  const scripts = fixture();
  const first = scripts[0].steps[0];
  if (first.kind !== "if") throw new Error("Expected if branch");
  first.then = [{
    id: "duplicate", kind: "if",
    cond: first.cond,
    then: [{ id: "first-child", kind: "wait", seconds: 1 }],
  }];
  scripts[0].steps.push({
    id: "duplicate", kind: "if",
    cond: first.cond,
    then: [{ id: "second-child", kind: "wait", seconds: 2 }],
  });
  const original = structuredClone(scripts);
  assert.deepEqual(listIn(scripts[0], "duplicate:then")?.map((step) => step.id), ["first-child"]);
  const next = insertAt(scripts, { scriptId: "script", list: "duplicate:then", index: 1 },
    [{ id: "inserted", kind: "wait", seconds: 3 }]);
  assert.deepEqual(listIn(next[0], "duplicate:then")?.map((step) => step.id), ["first-child", "inserted"]);
  assert.equal(next[0].steps[1], scripts[0].steps[1], "later duplicate branch remains shared");
  assert.deepEqual(scripts, original, "the original document is never mutated");

  const [afterRemoval, removed] = takeAt(next, { scriptId: "script", list: "duplicate:then", index: 1 });
  assert.deepEqual(removed.map((step) => step.id), ["inserted"]);
  assert.deepEqual(listIn(afterRemoval[0], "duplicate:then")?.map((step) => step.id), ["first-child"]);
});

test("a missing first duplicate else branch is not silently redirected to the next duplicate", () => {
  const scripts = fixture();
  const first = scripts[0].steps[0];
  if (first.kind !== "if") throw new Error("Expected if branch");
  first.id = "duplicate";
  scripts[0].steps.push({
    id: "duplicate", kind: "if", cond: first.cond,
    then: [], else: [{ id: "other", kind: "wait", seconds: 1 }],
  });
  assert.equal(listIn(scripts[0], "duplicate:else"), null);
  const original = structuredClone(scripts);
  const next = insertAt(scripts, { scriptId: "script", list: "duplicate:else", index: 0 },
    [{ id: "new-else", kind: "wait", seconds: 1 }]);
  assert.deepEqual(listIn(next[0], "duplicate:else")?.map((step) => step.id), ["new-else"]);
  assert.equal(next[0].steps[1], scripts[0].steps[1]);
  assert.deepEqual(scripts, original);
});

test("dragging one middle block keeps both adjacent blocks connected", () => {
  const scripts: Script[] = [{
    id: "s", trigger: "click", pos: { x: 0, y: 0 },
    steps: ["a", "b", "c", "d"].map((id) => ({ id, kind: "wait" as const, seconds: 1 })),
  }];
  const original = structuredClone(scripts);
  const [remaining, taken] = takeSelectedSteps(scripts, { scriptId: "s", list: "root", index: 1 }, new Set(["b"]));
  assert.deepEqual(taken.map((step) => step.id), ["b"]);
  assert.deepEqual(remaining[0].steps.map((step) => step.id), ["a", "c", "d"]);
  assert.deepEqual(scripts, original);
});

test("dragging multiple selected blocks leaves unselected blocks in order", () => {
  const scripts: Script[] = [{
    id: "s", trigger: "click", pos: { x: 0, y: 0 },
    steps: ["a", "b", "c", "d"].map((id) => ({ id, kind: "wait" as const, seconds: 1 })),
  }];
  const [remaining, taken] = takeSelectedSteps(scripts, { scriptId: "s", list: "root", index: 1 }, new Set(["b", "d"]));
  assert.deepEqual(taken.map((step) => step.id), ["b", "d"]);
  assert.deepEqual(remaining[0].steps.map((step) => step.id), ["a", "c"]);
});

test("dragging an unselected block does not pull along the previous selection", () => {
  const scripts: Script[] = [{
    id: "s", trigger: "click", pos: { x: 0, y: 0 },
    steps: ["a", "b", "c"].map((id) => ({ id, kind: "wait" as const, seconds: 1 })),
  }];
  const [remaining, taken] = takeSelectedSteps(scripts, { scriptId: "s", list: "root", index: 2 }, new Set(["a", "b"]));
  assert.deepEqual(taken.map((step) => step.id), ["c"]);
  assert.deepEqual(remaining[0].steps.map((step) => step.id), ["a", "b"]);
});
