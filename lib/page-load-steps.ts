import { matchesValueCondition, removeListItem, setVarPath, withinScriptValueLimit } from "./value-semantics";
import type { ScriptStep } from "./types";
import type { RecipeEvaluation } from "./script-model/recipe-runtime";

/**
 * Execute data-only steps before rendering a page. The same function is serialized
 * into generated sites, so the editor's samples and published SSR use identical
 * iteration, local-item scoping and conditional semantics.
 *
 * Fetch is intentionally handled outside: this interpreter never performs I/O
 * or browser effects. The page planner only passes fully supported subtrees.
 */
function createPageStepRunner(
  matchesValueCondition: typeof import("./value-semantics").matchesValueCondition,
  withinLimit: typeof withinScriptValueLimit,
  writePath: typeof setVarPath,
  removeItem: typeof removeListItem,
) {
  return function runPurePageSteps(
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
    const rawRef = /^\{([^{}\s"'<>`]+)\}$/;
    const valueInput = (input: string, scope: Record<string, unknown>): unknown => {
      const text = input.trim();
      const reference = rawRef.exec(text);
      if (reference) return lookup(scope, reference[1]);
      if (text === "true" || text === "false" || text === "null" ||
          text.startsWith("[") || text.startsWith("{") ||
          /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(text) ||
          (text.startsWith('"') && text.endsWith('"'))) {
        try { return JSON.parse(text); } catch { /* Continue as ordinary text. */ }
      }
      return interpolate(input, scope);
    };
    const write = (name: string, result: unknown, editingList = false) => {
      if (!name) return;
      const root = writePath(staged, name, result, withinLimit, editingList);
      if (root === undefined) { exhausted = true; return; }
      changed.add(root);
    };
    const execute = (body: readonly ScriptStep[], locals: Record<string, unknown>, depth: number, loopDepth = 0): boolean => {
      if (depth > 16) { exhausted = true; return false; }
      for (const step of body) {
        if (exhausted) return false;
        if (++budget > maxBudget) { exhausted = true; return false; }
        const scope = scopeOf(locals);
        if (step.kind === "break-loop") {
          if (loopDepth) return true;
          exhausted = true;
          return false;
        }
        switch (step.kind) {
          case "set-var": {
            if (!step.into) break;
            const match = rawRef.exec(step.value.trim());
            write(step.into, match
              ? lookup(scope, match[1].trim())
              : valueInput(step.value, scope));
            break;
          }
          case "set-list-item": {
            if (!step.list) break;
            const list = lookup(scope, step.list);
            if (!list || typeof list !== "object") break;
            const provided = !!step.key.trim();
            const keyValue = provided ? valueInput(step.key, scope) : undefined;
            if (provided && (typeof keyValue !== "string" && typeof keyValue !== "number")) break;
            const nextValue = valueInput(step.value, scope);
            if (Array.isArray(list)) {
              const copy = list.slice();
              const index = provided ? Number(keyValue) : copy.length;
              if (!Number.isSafeInteger(index) || index < 0 || index > copy.length ||
                  (index === copy.length && copy.length >= 10000)) break;
              copy[index] = nextValue;
              write(step.list, copy, true);
            } else {
              if (!provided) break;
              const key = String(keyValue);
              if (!Object.hasOwn(list, key) && Object.keys(list).length >= 10000) break;
              if (key === "__proto__" || key === "prototype" || key === "constructor") break;
              const copy = Object.assign(Object.create(null), list) as Record<string, unknown>;
              copy[key] = nextValue;
              write(step.list, copy, true);
            }
            break;
          }
          case "remove-list-item": {
            if (!step.list || !step.value.trim()) break;
            const source = lookup(scope, step.list);
            const selection = valueInput(step.value, scope);
            const result = removeItem(source, step.mode, selection, matchesValueCondition);
            if (result !== undefined) write(step.list, result, true);
            break;
          }
          case "transform": {
            if (!step.into || !step.source) break;
            const result = evaluate(lookup(scope, step.source), [step.transform], scope);
            if (result.kind === "value") write(step.into, result.value);
            else if (result.kind === "missing") write(step.into, undefined);
            break;
          }
          case "if": {
            const extras = step.conditions ?? [];
            if (extras.length > 32) {
              // Match browser behavior: malformed/oversized conditions are false.
              if (step.else?.length && execute(step.else, locals, depth + 1, loopDepth)) return true;
              break;
            }
            const groups: Array<typeof extras[number][]> = [[step.cond as typeof extras[number]]];
            for (const condition of extras) {
              if (!condition.and) groups.push([]);
              if (condition.subject !== "var" || !!condition.left?.trim())
                groups[groups.length - 1].push(condition);
            }
            if (groups.some((group) => group.some((condition) => condition.subject !== "var"))) break;
            // Skip incomplete additional clauses, but retain OR group boundaries.
            const matched = groups.some((group) => group.length > 0 && group.every((condition) => {
              if (!condition.left?.trim()) return false;
              const positive = matchesValueCondition(
                valueInput(condition.left, scope), condition.op ?? "eq",
                valueInput(condition.value ?? "", scope),
              );
              return condition.not ? !positive : positive;
            }));
            const chosen = matched ? step.then : step.else;
            if (chosen?.length && execute(chosen, locals, depth + 1, loopDepth)) return true;
            break;
          }
          case "for-each": {
            if (!step.array || !step.then.length) break;
            const source = lookup(scope, step.array);
            if (!source || typeof source !== "object") break;
            const keys = Object.keys(source);
            if (keys.length > 10000) { exhausted = true; break; }
            for (let i = 0; i < keys.length && !exhausted; i++) {
              if (++budget > maxBudget) { exhausted = true; break; }
              const key = keys[i];
              const item = (source as Record<string, unknown>)[key];
              const parentLoop = locals["ループ"];
              const current = Object.assign(Object.create(null), locals,
                item && typeof item === "object" && !Array.isArray(item) ? item : { "値": item },
                { "ループ": { "値": item, "キー": key, "順番": i, "外側": parentLoop } },
              ) as Record<string, unknown>;
              if (execute(step.then, current, depth + 1, loopDepth + 1)) break;
            }
            break;
          }
          case "repeat": {
            const matched = typeof step.times === "string"
              ? /^\{([^{}\s]+)\}$/.exec(step.times.trim()) : null;
            const raw = typeof step.times === "string"
              ? matched ? lookup(scope, matched[1]) : undefined : step.times;
            if (raw === null || raw === undefined || typeof raw === "boolean" ||
                (typeof raw === "string" && !raw.trim())) break;
            const count = Number(raw);
            if (!step.then.length) break;
            if (!Number.isInteger(count) || count < 1 || count > 1000) break;
            for (let i = 0; i < count && !exhausted; i++) {
              const current = Object.assign(Object.create(null), locals, {
                "ループ": { "値": i, "キー": String(i), "順番": i, "外側": locals["ループ"] },
              }) as Record<string, unknown>;
              if (execute(step.then, current, depth + 1, loopDepth + 1)) break;
            }
            break;
          }
        }
      }
      return false;
    };
    if (execute(steps, Object.create(null) as Record<string, unknown>, 0)) exhausted = true;
    if (exhausted) return false;
    for (const key of changed) {
      Object.defineProperty(vars, key, {
        value: staged[key], enumerable: true, writable: true, configurable: true,
      });
    }
    return true;
  };
}

export const runPurePageSteps = createPageStepRunner(matchesValueCondition, withinScriptValueLimit, setVarPath, removeListItem);

// The generated browser/SSR interpreter uses the same predicates and budget.
export const PAGE_STEP_RUNNER_SOURCE = `(${createPageStepRunner.toString()})(${matchesValueCondition.toString()}, ${withinScriptValueLimit.toString()}, ${setVarPath.toString()}, ${removeListItem.toString()})`;
