/**
 * スクリプトエディタのクリップボードのデータ。コピーするのは選択の根元だけ。
 * 親を選択すれば子も含まれ、スクリプトを選択すればそのすべての動作が含まれる。
 */
import { cloneSteps, scriptUid, type PageScript } from "../../lib/script";
import type { ScriptStep } from "../../lib/types";
import { insertAt, type Loc } from "./step-tree";

export interface ScriptBlockClipboard {
  v: 1;
  scripts: PageScript[];
  steps: ScriptStep[];
}

/**
 * OS のクリップボードから戻したデータを、文書へ入れる前に最低限検証する。
 * 任意のテキストをコピーしただけでスクリプトとして解釈しないため、呼び出し側でも
 * このエディタ自身が保存した内容と一致することを必ず確認する。
 */
export function isScriptBlockClipboard(value: unknown): value is ScriptBlockClipboard {
  if (!value || typeof value !== "object") return false;
  const payload = value as Partial<ScriptBlockClipboard>;
  if (payload.v !== 1 || !Array.isArray(payload.steps) || !Array.isArray(payload.scripts) ||
      (!payload.steps.length && !payload.scripts.length)) return false;
  let count = 0;
  const validStep = (candidate: unknown, depth: number): boolean => {
    if (++count > 10_000 || depth > 64 || !candidate || typeof candidate !== "object") return false;
    const step = candidate as Partial<ScriptStep>;
    if (typeof step.id !== "string" || typeof step.kind !== "string") return false;
    if (step.kind === "if" || step.kind === "repeat" || step.kind === "for-each") {
      const nested = step as { then?: unknown; else?: unknown };
      return Array.isArray(nested.then) && nested.then.every((child) => validStep(child, depth + 1)) &&
        (step.kind !== "if" || nested.else === undefined ||
          (Array.isArray(nested.else) && nested.else.every((child) => validStep(child, depth + 1))));
    }
    return !("then" in step) && !("else" in step);
  };
  return payload.steps.every((step) => validStep(step, 0)) &&
    payload.scripts.every((script) =>
      !!script && typeof script.id === "string" && typeof script.nodeId === "string" &&
      typeof script.trigger === "string" && Array.isArray(script.steps) &&
      script.steps.every((step) => validStep(step, 0)));
}

export function copyScriptBlocks(
  scripts: PageScript[], selected: readonly string[], sourceScriptId?: string
): ScriptBlockClipboard | null {
  const selectedScripts = new Set(selected.filter((key) => key.startsWith("script:")).map((key) => key.slice(7)));
  const selectedSteps = new Set(selected.filter((key) => key.startsWith("step:")).map((key) => key.slice(5)));
  const copies: PageScript[] = [];
  const steps: ScriptStep[] = [];
  const collect = (list: ScriptStep[]) => {
    for (const step of list) {
      if (selectedSteps.has(step.id)) {
        steps.push(structuredClone(step));
      } else if (step.kind === "if") {
        collect(step.then);
        if (step.else) collect(step.else);
      } else if (step.kind === "repeat" || step.kind === "for-each") {
        collect(step.then);
      }
    }
  };
  for (const script of scripts) {
    if (selectedScripts.has(script.id)) copies.push(structuredClone(script));
    else if (sourceScriptId === undefined || script.id === sourceScriptId) collect(script.steps);
  }
  if (!copies.length && !steps.length) return null;
  return { v: 1, scripts: copies, steps };
}

/** 選択した動作の直後。選択が無ければ、開いているスクリプトの末尾。 */
function insertionPoint(scripts: PageScript[], selected: readonly string[], openScriptId: string | null): Loc | null {
  const open = scripts.find((script) => script.id === openScriptId);
  if (!open) return null;

  // 別のスクリプトに切り替えたあと、以前の選択位置に貼り付けない。
  // 選択した順序ではなく、スクリプト内に表示される順序で最後の動作を基準にする。
  const chosen = new Set(selected.filter((key) => key.startsWith("step:")).map((key) => key.slice(5)));
  let last: Loc | null = null;
  const visit = (steps: ScriptStep[], list: string, parentSelected = false) => {
    steps.forEach((step, index) => {
      const selectedHere = chosen.has(step.id);
      if (selectedHere && !parentSelected) last = { scriptId: open.id, list, index: index + 1 };
      // 親と子を両方選択していても、親の直後に貼り付ける。
      if (step.kind === "if") {
        visit(step.then, `${step.id}:then`, parentSelected || selectedHere);
        if (step.else) visit(step.else, `${step.id}:else`, parentSelected || selectedHere);
      } else if (step.kind === "repeat" || step.kind === "for-each") {
        visit(step.then, `${step.id}:then`, parentSelected || selectedHere);
      }
    });
  };
  visit(open.steps, "root");
  return last ?? { scriptId: open.id, list: "root", index: open.steps.length };
}

/** 貼り付けは、1回で元に戻せる文書の編集として行い、入れ子の動作には新しい ID を振る。 */
export function pasteScriptBlocks(
  scripts: PageScript[],
  selected: readonly string[],
  clipboard: ScriptBlockClipboard,
  openScriptId: string | null,
): { scripts: PageScript[]; selection: string[] } | null {
  if (clipboard.v !== 1 || (!clipboard.scripts.length && !clipboard.steps.length)) return null;
  const selection: string[] = [];
  let next = scripts;
  if (clipboard.scripts.length) {
    const copies = clipboard.scripts.map((source) => {
      const script = structuredClone(source);
      script.id = scriptUid();
      script.steps = cloneSteps(script.steps);
      selection.push("script:" + script.id);
      return script;
    });
    next = [...next, ...copies];
  }
  if (clipboard.steps.length) {
    const location = insertionPoint(scripts, selected, openScriptId);
    if (location) {
      const steps = cloneSteps(structuredClone(clipboard.steps));
      const inserted = insertAt(next, location, steps);
      if (inserted !== next) {
        next = inserted;
        selection.push(...steps.map((step) => "step:" + step.id));
      }
    }
  }
  return next === scripts ? null : { scripts: next, selection };
}
