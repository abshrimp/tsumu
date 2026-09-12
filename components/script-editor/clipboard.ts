/**
 * スクリプトエディタのクリップボードのデータ。コピーするのは選択の根元だけ。
 * 親を選択すれば子も含まれ、スクリプトを選択すればそのすべての手順が含まれる。
 */
import { cloneSteps, scriptUid, type PageScript } from "../../lib/script";
import type { ScriptStep } from "../../lib/types";
import { insertAt, type Loc } from "./step-tree";

export interface ScriptBlockClipboard {
  v: 1;
  scripts: PageScript[];
  steps: ScriptStep[];
  sourcePos: { x: number; y: number };
}

export function copyScriptBlocks(scripts: PageScript[], selected: readonly string[]): ScriptBlockClipboard | null {
  const selectedScripts = new Set(selected.filter((key) => key.startsWith("script:")).map((key) => key.slice(7)));
  const selectedSteps = new Set(selected.filter((key) => key.startsWith("step:")).map((key) => key.slice(5)));
  const copies: PageScript[] = [];
  const steps: ScriptStep[] = [];
  let sourcePos: { x: number; y: number } | null = null;
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
    if (selectedScripts.has(script.id)) {
      copies.push(structuredClone(script));
      sourcePos ??= { ...script.pos };
    } else {
      const before = steps.length;
      collect(script.steps);
      if (steps.length !== before) sourcePos ??= { ...script.pos };
    }
  }
  if (!copies.length && !steps.length) return null;
  return { v: 1, scripts: copies, steps, sourcePos: sourcePos ?? { x: 32, y: 32 } };
}

function insertionAfterSelection(scripts: PageScript[], selected: readonly string[]): Loc | null {
  const locate = (script: PageScript, list: ScriptStep[], name: string, id: string): Loc | null => {
    for (let i = 0; i < list.length; i++) {
      const step = list[i];
      if (step.id === id) return { scriptId: script.id, list: name, index: i + 1 };
      if (step.kind === "if") {
        const found = locate(script, step.then, step.id + ":then", id) ||
          (step.else && locate(script, step.else, step.id + ":else", id));
        if (found) return found;
      } else if (step.kind === "repeat" || step.kind === "for-each") {
        const found = locate(script, step.then, step.id + ":then", id);
        if (found) return found;
      }
    }
    return null;
  };
  for (let i = selected.length - 1; i >= 0; i--) {
    const key = selected[i];
    if (key.startsWith("step:")) {
      for (const script of scripts) {
        const found = locate(script, script.steps, "root", key.slice(5));
        if (found) return found;
      }
    }
    if (key.startsWith("script:")) {
      const script = scripts.find((item) => item.id === key.slice(7));
      if (script) return { scriptId: script.id, list: "root", index: script.steps.length };
    }
  }
  return null;
}

/** 貼り付けは、1回で元に戻せる文書の編集として行い、入れ子のブロックには新しい ID を振る。 */
export function pasteScriptBlocks(
  scripts: PageScript[],
  selected: readonly string[],
  clipboard: ScriptBlockClipboard,
  offset = 32,
): { scripts: PageScript[]; selection: string[] } | null {
  if (clipboard.v !== 1 || (!clipboard.scripts.length && !clipboard.steps.length)) return null;
  const selection: string[] = [];
  let next = scripts;
  if (clipboard.scripts.length) {
    const copies = clipboard.scripts.map((source) => {
      const script = structuredClone(source);
      script.id = scriptUid();
      script.steps = cloneSteps(script.steps);
      script.pos = {
        x: Math.max(8, script.pos.x + offset),
        y: Math.max(8, script.pos.y + offset),
      };
      selection.push("script:" + script.id);
      return script;
    });
    next = [...next, ...copies];
  }
  if (clipboard.steps.length) {
    const steps = cloneSteps(structuredClone(clipboard.steps));
    const location = insertionAfterSelection(scripts, selected);
    const inserted = location ? insertAt(next, location, steps) : next;
    if (inserted !== next) {
      next = inserted;
    } else {
      next = [...next, {
        id: scriptUid(), nodeId: null, steps,
        pos: {
          x: Math.max(8, clipboard.sourcePos.x + offset),
          y: Math.max(8, clipboard.sourcePos.y + offset),
        },
      }];
    }
    selection.push(...steps.map((step) => "step:" + step.id));
  }
  return { scripts: next, selection };
}
