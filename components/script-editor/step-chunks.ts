import type { ScriptStep } from "../../lib/types";

/** Keep small scripts completely mounted; window only large step lists. */
export const SCRIPT_STEP_WINDOW_THRESHOLD = 128;
export const SCRIPT_STEP_CHUNK_SIZE = 48;

export interface StepChunk {
  start: number;
  steps: ScriptStep[];
  estimatedHeight: number;
}

// Placeholders preserve the scroll extent until their actual size is measured.
// A separate estimate per branch avoids treating a nested loop like one row.
function estimateStepHeight(step: ScriptStep, depth = 0): number {
  if (depth >= 12) return 52;
  if (step.kind === "if") {
    return 52 + (step.conditions?.length ?? 0) * 34 +
      estimateStepsHeight(step.then, depth + 1) +
      (step.else?.length ? 26 + estimateStepsHeight(step.else, depth + 1) : 0);
  }
  if (step.kind === "repeat" || step.kind === "for-each") {
    return 58 + estimateStepsHeight(step.then, depth + 1);
  }
  return 42;
}

function estimateStepsHeight(steps: ScriptStep[], depth: number): number {
  let height = 0;
  for (const step of steps) height += estimateStepHeight(step, depth);
  return height;
}

/** Preserve original list indices, including insertion slots, across windows. */
export function chunkScriptSteps(steps: ScriptStep[]): StepChunk[] {
  const chunks: StepChunk[] = [];
  for (let start = 0; start < steps.length; start += SCRIPT_STEP_CHUNK_SIZE) {
    const slice = steps.slice(start, start + SCRIPT_STEP_CHUNK_SIZE);
    chunks.push({ start, steps: slice, estimatedHeight: estimateStepsHeight(slice, 0) });
  }
  return chunks;
}

/** Approximate an offscreen script's full footprint before it has been measured. */
export function estimateScriptStackHeight(steps: ScriptStep[]): number {
  return Math.max(72, 42 + estimateStepsHeight(steps, 0));
}
