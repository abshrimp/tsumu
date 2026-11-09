import assert from "node:assert/strict";
import { test } from "node:test";
import { SlotIndex, type SlotPoint } from "../components/script-editor/slot-index";
import { mapStep } from "../components/script-editor/step-tree";
import type { ScriptStep } from "../lib/types";

function brute(slots: SlotPoint[], kind: SlotPoint["kind"], x: number, y: number) {
  let best: string | null = null;
  let distance = Infinity;
  slots.forEach((s) => {
    if (s.kind !== kind) return;
    const dx = x - s.x;
    const dy = y - s.y;
    if (Math.abs(dx) > 80 || Math.abs(dy) > 28) return;
    const score = Math.hypot(dx, dy * 2);
    if (score < distance) {
      best = s.key;
      distance = score;
    }
  });
  return best;
}

test("spatial hit testing agrees with the original full DOM slot scan", () => {
  const slots: SlotPoint[] = [];
  for (let row = 0; row < 180; row++) {
    for (let col = 0; col < 36; col++) {
      slots.push({ key: `s-${row}-${col}`, kind: row % 7 === 0 ? "head" : "step",
        x: col * 215 + 12, y: row * 41 + 9 });
    }
  }
  const index = new SlotIndex(slots);
  // Probe cell boundaries, negative coordinates, overlaps and near misses.
  for (let y = -60; y < 7500; y += 43) {
    for (let x = -100; x < 7800; x += 117) {
      for (const kind of ["step", "head"] as const) {
        assert.equal(index.nearest(kind, x, y), brute(slots, kind, x, y));
      }
    }
  }
});

test("spatial hit testing preserves DOM order for exactly tied slots", () => {
  const slots: SlotPoint[] = [
    { key: "first", kind: "step", x: 10, y: 20 },
    { key: "second", kind: "step", x: 10, y: 20 },
    { key: "head", kind: "head", x: 10, y: 20 },
  ];
  const index = new SlotIndex(slots);
  assert.equal(index.nearest("step", 10, 20), "first");
  assert.equal(index.nearest("head", 10, 20), "head");
  assert.equal(index.nearest("step", 500, 500), null);
});

test("editing a single deep block keeps unrelated blocks and scripts by reference", () => {
  const steps: ScriptStep[] = Array.from({ length: 4000 }, (_, i) => ({
    id: `wait-${i}`, kind: "wait", seconds: i + 1,
  }));
  const nested: ScriptStep = {
    id: "branch", kind: "if", cond: { subject: "var", target: "", left: "ready", op: "eq", value: "true" },
    then: [{ id: "nested", kind: "wait", seconds: 1 }],
  };
  const scripts = [
    { id: "a", pos: { x: 10, y: 10 }, steps: [...steps, nested] },
    { id: "b", pos: { x: 500, y: 500 }, steps: [{ id: "other", kind: "wait" as const, seconds: 2 }] },
  ];
  const result = mapStep(scripts, "nested", (s) => ({ ...s, seconds: 5 }) as ScriptStep);
  assert.notEqual(result[0], scripts[0]);
  assert.equal(result[1], scripts[1]);
  assert.equal(result[0].steps[0], scripts[0].steps[0]);
  assert.equal(result[0].steps[3999], scripts[0].steps[3999]);
  assert.equal(result[1].steps, scripts[1].steps);
  assert.equal(scripts[0].steps[4000], nested);
  assert.equal((result[0].steps[4000] as Extract<ScriptStep, { kind: "if" }>).then[0].kind, "wait");
  assert.equal(((result[0].steps[4000] as Extract<ScriptStep, { kind: "if" }>).then[0] as Extract<ScriptStep, { kind: "wait" }>).seconds, 5);
});
