import type { ScriptStep } from "../../lib/types";

/** 小さなスクリプトは全体をマウントし、大きな手順の一覧だけを表示範囲に絞る。 */
export const SCRIPT_STEP_WINDOW_THRESHOLD = 128;
export const SCRIPT_STEP_CHUNK_SIZE = 48;

export interface StepChunk {
  start: number;
  steps: ScriptStep[];
  estimatedHeight: number;
}

// 代わりの要素は、実際の大きさを測るまでスクロールの範囲を保つ。
// 入れ子のループを1行のように扱わないよう、分岐ごとに見積もる。
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

/** 表示範囲を分けても、差し込み位置を含めて、元の一覧での番号を保つ。 */
export function chunkScriptSteps(steps: ScriptStep[]): StepChunk[] {
  const chunks: StepChunk[] = [];
  for (let start = 0; start < steps.length; start += SCRIPT_STEP_CHUNK_SIZE) {
    const slice = steps.slice(start, start + SCRIPT_STEP_CHUNK_SIZE);
    chunks.push({ start, steps: slice, estimatedHeight: estimateStepsHeight(slice, 0) });
  }
  return chunks;
}

/** 画面の外にあるスクリプトの、測る前の全体の大きさを見積もる。 */
export function estimateScriptStackHeight(steps: ScriptStep[]): number {
  return Math.max(72, 42 + estimateStepsHeight(steps, 0));
}
