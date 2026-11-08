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
export function runPurePageSteps(
  steps: readonly ScriptStep[],
  vars: Record<string, unknown>,
  lookup: (scope: Record<string, unknown>, name: string) => unknown,
  interpolate: (text: string, scope: Record<string, unknown>) => string,
  evaluate: (input: unknown, transforms: readonly any[], variables?: Record<string, unknown>) => RecipeEvaluation,
  external: Record<string, unknown> = {},
): boolean {
  function matchesValueCondition(left: unknown, operator: string, right: unknown): boolean {
    const owns = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
    const record = (value: unknown): value is Record<string, unknown> =>
      value !== null && typeof value === "object";
    const numeric = (value: unknown): number | undefined => {
      if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
      if (typeof value !== "string" || !/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value.trim())) return undefined;
      const n = Number(value.trim());
      return Number.isFinite(n) ? n : undefined;
    };
    const same = (a: unknown, b: unknown, depth = 0): boolean => {
      if (a === b) return true;
      if (!record(a) || !record(b) || depth >= 16) return false;
      const aa = Object.keys(a), bb = Object.keys(b);
      if (aa.length !== bb.length || aa.length > 10000) return false;
      return aa.every((key) => owns(b, key) && same(
        (a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], depth + 1));
    };
    if (operator === "has-key") {
      if (!record(left) || record(right) || right === undefined || right === null) return false;
      return owns(left, String(right));
    }
    if (operator === "empty") {
      if (left === undefined || left === null || left === "") return true;
      if (record(left)) return Object.keys(left).length === 0;
      return false;
    }
    if (operator === "contains") {
      if (record(left)) return Object.keys(left).some((key) =>
        same((left as Record<string, unknown>)[key], right));
      return left !== undefined && left !== null && !record(right) &&
        String(left).includes(String(right));
    }
    if (operator === "eq" || operator === undefined) return same(left, right);
    if (operator === "in") {
      if (record(right)) return Object.keys(right).some((key) =>
        same((right as Record<string, unknown>)[key], left));
      if (typeof right !== "string") return false;
      return right.split(",").some((part) => same(left, part.trim()) ||
        (typeof left === "number" && numeric(part.trim()) === left));
    }
    if (operator === "starts-with" || operator === "ends-with") {
      if (left === undefined || left === null || record(left) || record(right)) return false;
      const a = String(left), b = String(right);
      return operator === "starts-with" ? a.startsWith(b) : a.endsWith(b);
    }
    if (operator === "gt" || operator === "gte" || operator === "lt" || operator === "lte") {
      const a = numeric(left), b = numeric(right);
      if (a === undefined || b === undefined) return false;
      return operator === "gt" ? a > b : operator === "gte" ? a >= b :
        operator === "lt" ? a < b : a <= b;
    }
    return false;
  }
  
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
  const write = (name: string, result: unknown) => {
    if (!name) return;
    Object.defineProperty(staged, name, {
      value: result, enumerable: true, writable: true, configurable: true,
    });
    changed.add(name);
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
            write(step.list, copy);
          } else {
            if (!provided) break;
            const key = String(keyValue);
            if (!Object.hasOwn(list, key) && Object.keys(list).length >= 10000) break;
            if (key === "__proto__" || key === "prototype" || key === "constructor") break;
            const copy = Object.assign(Object.create(null), list) as Record<string, unknown>;
            copy[key] = nextValue;
            write(step.list, copy);
          }
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
}
