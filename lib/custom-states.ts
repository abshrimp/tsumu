import type { ScriptStep, SiteDoc, StyleState } from "./types";

/** User-authored states are scoped to an element, not a new global CSS pseudoclass. */
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

/** Returns a CSS suffix, or null when a value must never become a selector. */
export function customStateSelector(state: string): string | null {
  const name = customStateName(state);
  return name === null ? null : `[${CUSTOM_STATE_ATTRIBUTE}=${JSON.stringify(name)}]`;
}

/** All states used by scripts targeting this node, plus previously styled states. */
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
