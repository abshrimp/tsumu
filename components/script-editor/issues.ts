/**
 * まだ設定が終わっていない動作を見つけて、次に何をすればよいかを短い文で返す。
 * 実行時の検査ではなく、作っている人への案内に使う。
 */

import { walkSteps, type PageScript } from "../../lib/script";
import type { ScriptCond, ScriptStep } from "../../lib/types";
import { tr } from "../../lib/i18n";

function conditionIssue(cond: ScriptCond): string | null {
  if (cond.subject === "var") return cond.left?.trim() ? null : tr("Choose a variable to check.");
  return cond.target ? null : tr("Choose the element to check.");
}

/** この動作そのものに足りない設定（中に入れた動作は見ない）。 */
export function stepIssue(step: ScriptStep): string | null {
  switch (step.kind) {
    case "show":
    case "hide":
    case "toggle":
    case "scroll-to":
    case "set-state":
      return step.target ? null : tr("Choose an element.");
    case "set-value":
    case "set-enabled":
      return step.target ? null : tr("Choose an input field.");
    case "open-page":
      return step.pageId ? null : tr("Choose a page.");
    case "open-url":
      return step.url.trim() ? null : tr("Enter a web address.");
    case "dialog":
      return step.mode !== "alert" && !step.into?.trim() ? tr("Name the variable that keeps the answer.") : null;
    case "fetch":
      return !step.url.trim() ? tr("Enter the web address of the data.")
        : !step.as?.trim() ? tr("Give the data a name.") : null;
    case "set-var":
      return step.into.trim() ? null : tr("Give the variable a name.");
    case "transform":
      return !step.source.trim() ? tr("Choose the variable to change.")
        : !step.into.trim() ? tr("Name the variable that keeps the result.") : null;
    case "store-save":
      return step.key.trim() ? null : tr("Enter a name to save under.");
    case "store-load":
      return !step.key.trim() ? tr("Enter the name it was saved under.")
        : !step.into.trim() ? tr("Give the variable a name.") : null;
    case "for-each":
      return step.array.trim() ? null : tr("Choose a list.");
    case "list-display":
      return step.array.trim() ? null : tr("Choose a list.");
    case "set-list-item":
    case "remove-list-item":
      return step.list.trim() ? null : tr("Choose a list.");
    case "if": {
      for (const cond of [step.cond, ...(step.conditions ?? [])]) {
        const issue = conditionIssue(cond);
        if (issue) return issue;
      }
      return null;
    }
    case "copy":
    case "wait":
    case "repeat":
    case "break-loop":
      return null;
  }
}

/** スクリプトがそのまま動くか。動かない理由があれば、最初の1つを返す。 */
export function scriptStatus(script: PageScript): { ready: boolean; pending: number; message: string } {
  if (script.trigger === "change" && script.changeVariable !== undefined && !script.changeVariable.trim()) {
    return { ready: false, pending: 0, message: tr("Choose the variable to watch.") };
  }
  if (!script.steps.length) {
    return { ready: false, pending: 0, message: tr("Add the first action.") };
  }
  let pending = 0;
  walkSteps(script.steps, (step) => {
    if (stepIssue(step)) pending++;
  });
  return pending
    ? { ready: false, pending, message: tr("{n} not set", { n: pending }) }
    : { ready: true, pending: 0, message: tr("Ready") };
}
