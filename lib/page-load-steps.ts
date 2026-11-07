import type { ValueTransform } from "./script-model/compose";

type ScriptStep =
  | { kind: "set-var"; into: string; value: string }
  | { kind: "transform"; into: string; source: string; transform: ValueTransform }
  | { kind: "if"; cond: { subject: string; left?: string; value?: string; op?: string }; then: ScriptStep[]; else?: ScriptStep[] }
  | { kind: "for-each"; array: string; then: ScriptStep[] }
  | { kind: "repeat"; times: string | number; then: ScriptStep[] };
import type { RecipeEvaluation } from "./script-model/recipe-runtime";

/**
 * Execute data-only steps before rendering a page. The same function is serialized
 * into generated sites, so the editor's samples and published SSR use identical
 * iteration, local-item scoping and conditional semantics.
 *
 * Fetch is intentionally handled outside: this interpreter never performs I/O
 * or browser effects. The page planner only passes fully supported subtrees.
 */
export function runPurePageSteps(
  steps: readonly ScriptStep[],
  vars: Record<string, unknown>,
  lookup: (scope: Record<string, unknown>, name: string) => unknown,
  interpolate: (text: string, scope: Record<string, unknown>) => string,
  evaluate: (input: unknown, transforms: readonly any[], variables?: Record<string, unknown>) => RecipeEvaluation,
  external: Record<string, unknown> = {},
): boolean {
  let budget = 0;
  let exhausted = false;
  const maxBudget = 100_000;
  // Commit only after the subtree completes, never publish partially updated data.
  const staged = Object.assign(Object.create(null), vars) as Record<string, unknown>;
  const changed = new Set<string>();
  const scopeOf = (locals: Record<string, unknown>) =>
    Object.assign(Object.create(null), external, staged, locals) as Record<string, unknown>;
  const compare = (left: string, right: string, operation: string): boolean => {
    switch (operation) {
      case "eq": return left === right;
      case "neq": return left !== right;
      case "contains": return left.includes(right);
      case "not-contains": return !left.includes(right);
      case "starts-with": return left.startsWith(right);
      case "ends-with": return left.endsWith(right);
      case "gt": return parseFloat(left) > parseFloat(right);
      case "lt": return parseFloat(left) < parseFloat(right);
      case "empty": return left === "";
      case "not-empty": return left !== "";
      case "in": return right.split(",").some((part) => part.trim() === left);
      default: return left === right;
    }
  };
  const rawRef = /^\{([^{}]+)\}$/;
  const write = (name: string, result: unknown) => {
    if (!name) return;
    Object.defineProperty(staged, name, {
      value: result, enumerable: true, writable: true, configurable: true,
    });
    changed.add(name);
  };
  const execute = (body: readonly ScriptStep[], locals: Record<string, unknown>, depth: number): void => {
    if (depth > 16) { exhausted = true; return; }
    for (const step of body) {
      if (exhausted) return;
      if (++budget > maxBudget) { exhausted = true; return; }
      const scope = scopeOf(locals);
      switch (step.kind) {
        case "set-var": {
          if (!step.into) break;
          const match = rawRef.exec(step.value.trim());
          write(step.into, match
            ? lookup(scope, match[1].trim())
            : interpolate(step.value, scope));
          break;
        }
        case "transform": {
          if (!step.into || !step.source) break;
          const result = evaluate(lookup(scope, step.source), [step.transform], scope);
          if (result.kind === "value") write(step.into, result.value);
          break;
        }
        case "if": {
          if (step.cond.subject !== "var") break;
          const chosen = compare(
            interpolate(step.cond.left ?? "", scope),
            interpolate(step.cond.value ?? "", scope),
            step.cond.op ?? "eq",
          ) ? step.then : step.else;
          if (chosen?.length) execute(chosen, locals, depth + 1);
          break;
        }
        case "for-each": {
          if (!step.array || !step.then.length) break;
          const source = lookup(scope, step.array);
          if (!Array.isArray(source)) break;
          // The browser runtime skips nulls and nested arrays, and exposes
          // primitive items through the special `値` field.
          for (let i = 0; i < source.length && !exhausted; i++) {
            if (++budget > maxBudget) { exhausted = true; break; }
            const item = source[i];
            if (item == null || Array.isArray(item)) continue;
            const child = Object.assign(
              Object.create(null), locals,
              typeof item === "object" ? item : { "値": item },
            ) as Record<string, unknown>;
            execute(step.then, child, depth + 1);
          }
          break;
        }
        case "repeat": {
          const matched = typeof step.times === "string"
            ? /^\\{([^{}\\s]+)\\}$/.exec(step.times.trim()) : null;
          const raw = typeof step.times === "string"
            ? matched ? lookup(scope, matched[1]) : undefined : step.times;
          if (raw === null || raw === undefined || typeof raw === "boolean" ||
              (typeof raw === "string" && !raw.trim())) break;
          const count = Number(raw);
          if (!Number.isInteger(count) || count < 1 || count > 1000) break;
          for (let i = 0; i < count && !exhausted; i++) execute(step.then, locals, depth + 1);
          break;
        }
      }
    }
  };
  execute(steps, Object.create(null) as Record<string, unknown>, 0);
  if (exhausted) return false;
  for (const key of changed) {
    Object.defineProperty(vars, key, {
      value: staged[key], enumerable: true, writable: true, configurable: true,
    });
  }
  return true;
}
