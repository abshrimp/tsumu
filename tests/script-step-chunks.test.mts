import assert from "node:assert/strict";
import { test } from "node:test";
import {
  chunkScriptSteps, estimateScriptStackHeight,
  SCRIPT_STEP_CHUNK_SIZE, SCRIPT_STEP_WINDOW_THRESHOLD,
} from "../components/script-editor/step-chunks";
import type { ScriptStep } from "../lib/types";

test("large script step windows preserve every original step and insertion index", () => {
  const steps: ScriptStep[] = Array.from({ length: 4096 }, (_, i) => ({
    id: "wait-" + i, kind: "wait", seconds: i,
  }));
  const before = [...steps];
  const chunks = chunkScriptSteps(steps);
  assert.equal(chunks.length, Math.ceil(steps.length / SCRIPT_STEP_CHUNK_SIZE));
  assert.equal(chunks[0].start, 0);
  assert.equal(chunks.at(-1)!.start, 4080);
  assert.ok(chunks.every((part) => part.steps.length <= SCRIPT_STEP_CHUNK_SIZE));
  const flattened = chunks.flatMap((part) => part.steps);
  for (let i = 0; i < steps.length; i++) {
    assert.strictEqual(flattened[i], steps[i]);
    assert.equal(chunks[Math.floor(i / SCRIPT_STEP_CHUNK_SIZE)].start +
      i % SCRIPT_STEP_CHUNK_SIZE, i);
  }
  assert.deepEqual(steps, before);
  assert.equal(SCRIPT_STEP_WINDOW_THRESHOLD, 128);
});

test("window heights include nested branches but remain finite under deeply nested input", () => {
  const root: ScriptStep[] = [{ id: "wait", kind: "wait", seconds: 1 }];
  for (let depth = 0; depth < 30; depth++) {
    root.splice(0, root.length, {
      id: "repeat-" + depth, kind: "repeat", times: 2,
      then: [root[0]],
    });
  }
  const height = estimateScriptStackHeight(root);
  assert.ok(height > 70);
  assert.ok(Number.isFinite(height));
  assert.ok(chunkScriptSteps(root)[0].estimatedHeight > 0);
});
