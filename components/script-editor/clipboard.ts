/**
 * スクリプトエディタのクリップボードのデータ。コピーするのは選択の根元だけ。
 * 親を選択すれば子も含まれ、スクリプトを選択すればそのすべての動作が含まれる。
 */
import { cloneSteps, scriptUid, type PageScript } from "../../lib/script";
import type { ScriptStep } from "../../lib/types";
import { findStepLoc, insertAt, type Loc } from "./step-tree";

export interface ScriptBlockClipboard {
  v: 2;
  scripts: PageScript[];
  steps: ScriptStep[];
}

export function copyScriptBlocks(scripts: PageScript[], selected: readonly string[]): ScriptBlockClipboard | null {
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
    else collect(script.steps);
  }
  if (!copies.length && !steps.length) return null;
  return { v: 2, scripts: copies, steps };
}

/** 選択した動作の直後。選択が無ければ、開いているスクリプトの末尾。 */
function insertionPoint(scripts: PageScript[], selected: readonly string[], openScriptId: string | null): Loc | null {
  for (let i = selected.length - 1; i >= 0; i--) {
    const key = selected[i];
    if (!key.startsWith("step:")) continue;
    for (const script of scripts) {
      const found = findStepLoc(script, key.slice(5));
      if (found) return { ...found, index: found.index + 1 };
    }
  }
  const open = scripts.find((script) => script.id === openScriptId);
  return open ? { scriptId: open.id, list: "root", index: open.steps.length } : null;
}

/** 貼り付けは、1回で元に戻せる文書の編集として行い、入れ子の動作には新しい ID を振る。 */
export function pasteScriptBlocks(
  scripts: PageScript[],
  selected: readonly string[],
  clipboard: ScriptBlockClipboard,
  openScriptId: string | null,
): { scripts: PageScript[]; selection: string[] } | null {
  if (clipboard.v !== 2 || (!clipboard.scripts.length && !clipboard.steps.length)) return null;
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
