import type { ScriptStep, SiteDoc, StyleState } from "./types";

/** 利用者が作る状態は要素ごとに適用し、新しいグローバルな CSS の擬似クラスにはしない。 */
export const CUSTOM_STATE_PREFIX = "custom:";
export const CUSTOM_STATE_ATTRIBUTE = "data-site-state";

export function isValidCustomStateName(value: string): boolean {
  return value.length > 0 && value.length <= 40 &&
    /^[\p{L}\p{N}_][\p{L}\p{N}_ -]*$/u.test(value) &&
    !["default", "hover", "active", "focus"].includes(value);
}

export function customStateKey(name: string): StyleState | null {
  const clean = name.trim();
  return isValidCustomStateName(clean) ? `custom:${clean}` as StyleState : null;
}

export function customStateName(state: string): string | null {
  if (!state.startsWith(CUSTOM_STATE_PREFIX)) return null;
  const name = state.slice(CUSTOM_STATE_PREFIX.length);
  return isValidCustomStateName(name) ? name : null;
}

/** CSS の接尾辞を返す。セレクターにしてはいけない値なら null を返す。 */
export function customStateSelector(state: string): string | null {
  const name = customStateName(state);
  return name === null ? null : `[${CUSTOM_STATE_ATTRIBUTE}=${JSON.stringify(name)}]`;
}

/** このノードを対象にするスクリプトが使うすべての状態と、すでにスタイルを付けた状態。 */
export function customStatesForNode(doc: SiteDoc, nodeId: string): StyleState[] {
  const node = doc.nodes[nodeId];
  if (!node) return [];
  const found = new Set<StyleState>();
  for (const bp of Object.values(node.styles)) {
    for (const state of Object.keys(bp)) {
      if (customStateName(state) !== null) found.add(state as StyleState);
    }
  }
  const walk = (steps: ScriptStep[], isOwnScript: boolean): void => {
    for (const step of steps) {
      if (step.kind === "set-state" &&
        (node.attrId && step.target === node.attrId ||
         isOwnScript && step.target === "@self")) {
        const key = customStateKey(step.state);
        if (key) found.add(key);
      }
      if (step.kind === "if") {
        walk(step.then, isOwnScript);
        if (step.else) walk(step.else, isOwnScript);
      } else if (step.kind === "repeat" || step.kind === "for-each") {
        walk(step.then, isOwnScript);
      }
    }
  };
  for (const [id, other] of Object.entries(doc.nodes)) {
    for (const script of other.scripts ?? []) walk(script.steps, id === nodeId);
  }
  for (const page of Object.values(doc.pages)) {
    for (const script of [...(page.pageScripts ?? []), ...(page.scripts ?? [])]) {
      walk(script.steps, false);
    }
  }
  return [...found].sort((a,b)=>a.localeCompare(b,"ja"));
}
