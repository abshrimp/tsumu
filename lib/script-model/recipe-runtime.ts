import type { ValueTransform } from "./compose";

export type RecipeEvaluation =
  | { kind: "value"; value: unknown }
  | { kind: "missing" }
  | { kind: "error"; code: string };

/**
 * Pure, self-contained evaluator shared by editor samples, SSR and client JS.
 * Do not capture imports or local helpers: the exported site embeds this function.
 * Undefined is missing; null is a real value. No input object is mutated.
 */
export function evaluateValueRecipe(input: unknown, steps: readonly ValueTransform[], variables: Record<string, unknown> = {}): RecipeEvaluation {
  const failure = (code: string): RecipeEvaluation => ({ kind: "error", code });
  const missing: RecipeEvaluation = { kind: "missing" };
  if (!Array.isArray(steps) || steps.length > 32) return failure("invalid-recipe");

  // Self-contained: this function is serialized into published browser/SSR code.
  const owns = (obj: object, key: string | number) => Object.prototype.hasOwnProperty.call(obj, key);
  const valueAt = (item: unknown, path: string): unknown => {
    if (!path) return item;
    if (!item || typeof item !== "object") return undefined;
    if (owns(item, path)) return (item as Record<string, unknown>)[path];
    let result: unknown = item;
    const parts = path.split(".");
    if (parts.length > 16) return undefined;
    for (const part of parts) {
      if (result === null || typeof result !== "object" || !owns(result, part)) return undefined;
      result = (result as Record<string, unknown>)[part];
    }
    return result;
  };
  const scalar = (value: unknown): value is string | number | boolean | null =>
    value === null || typeof value === "string" || typeof value === "boolean" ||
      (typeof value === "number" && Number.isFinite(value));
  const literal = (text: string, type: string): { ok: true; value: string | number | boolean | null } | { ok: false } => {
    if (typeof text !== "string" || text.length > 4096) return { ok: false };
    if (type === "text") return { ok: true, value: text };
    if (type === "null") return { ok: true, value: null };
    if (type === "boolean") return text === "true" || text === "false"
      ? { ok: true, value: text === "true" } : { ok: false };
    if (type === "number" && /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?$/.test(text.trim())) {
      const number = Number(text);
      return Number.isFinite(number) ? { ok: true, value: number } : { ok: false };
    }
    return { ok: false };
  };
  const argument = (step: { operand: string; operandType: string }):
    { ok: true; value: unknown } | { ok: false } => {
    if (step.operandType !== "variable") return literal(step.operand, step.operandType);
    const value = valueAt(variables, step.operand);
    return value === undefined ? { ok: false } : { ok: true, value };
  };
  // Numeric operations accept finite numbers and decimal strings (such as form inputs).
  // Comparison remains type-aware; numeric conversion is explicit to the math operation.
  const numberLike = (input: unknown): number | undefined => {
    if (typeof input === "number") return Number.isFinite(input) ? input : undefined;
    if (typeof input !== "string" || !/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?$/.test(input.trim())) return undefined;
    const number = Number(input.trim());
    return Number.isFinite(number) ? number : undefined;
  };
  const compare = (left: unknown, right: unknown, operator: string): boolean | undefined => {
    if (!scalar(left) || !scalar(right)) return undefined;
    switch (operator) {
      case "eq": return left === right;
      case "neq": return left !== right;
      case "gt":
      case "gte":
      case "lt":
      case "lte": {
        if (typeof left !== typeof right ||
            (typeof left !== "number" && typeof left !== "string") ||
            (typeof right !== "number" && typeof right !== "string")) return undefined;
        if (operator === "gt") return left > right;
        if (operator === "gte") return left >= right;
        if (operator === "lt") return left < right;
        return left <= right;
      }
      case "contains":
      case "starts-with":
      case "ends-with":
        if (typeof left !== "string" || typeof right !== "string") return undefined;
        if (operator === "contains") return left.includes(right);
        if (operator === "starts-with") return left.startsWith(right);
        return left.endsWith(right);
      default: return undefined;
    }
  };

  let current: unknown = input;
  let absent = current === undefined;
  try {
    for (const step of steps) {
      if (!step || typeof step !== "object" || !("kind" in step)) return failure("invalid-recipe");
      switch (step.kind) {
        case "fallback":
        case "fallback-nullish":
          if (typeof step.text !== "string" || step.text.length > 10000) return failure("invalid-recipe");
          if (absent || (step.kind === "fallback-nullish" && current === null)) {
            current = step.text;
            absent = false;
          }
          break;
        case "field":
        case "has": {
          if (absent) {
            if (step.kind === "has") { current = false; absent = false; }
            break;
          }
          if (typeof step.key !== "string" || step.key.length > 256 ||
              !current || typeof current !== "object" || Array.isArray(current))
            return failure("type-mismatch");
          const present = owns(current, step.key);
          if (step.kind === "has") { current = present; absent = false; }
          else { current = present ? (current as Record<string, unknown>)[step.key] : undefined; absent = !present; }
          break;
        }
        case "index": {
          if (absent) break;
          if (!Array.isArray(current) || !Number.isInteger(step.index) ||
              step.index < -1 || step.index > 1000000) return failure("type-mismatch");
          const index = step.index === -1 ? current.length - 1 : step.index;
          absent = !owns(current, index);
          current = absent ? undefined : current[index];
          break;
        }
        case "length":
          if (absent) break;
          if (!Array.isArray(current)) return failure("type-mismatch");
          current = current.length;
          break;
        case "format":
          if (absent) break;
          if (typeof current !== "string" && typeof current !== "number" &&
              typeof current !== "boolean") return failure("type-mismatch");
          current = String(current);
          break;
        case "stringify":
          if (absent) break;
          current = JSON.stringify(current);
          if (typeof current !== "string" || current.length > 100000) return failure("limit-exceeded");
          break;
        case "parse":
          if (absent) break;
          if (typeof current !== "string") return failure("type-mismatch");
          if (current.length > 100000) return failure("limit-exceeded");
          try { current = JSON.parse(current); } catch { return failure("invalid-json"); }
          break;
        case "math": {
          if (absent) break;
          if (step.operandType !== undefined && step.operandType !== "number" && step.operandType !== "variable")
            return failure("invalid-recipe");
          const left = numberLike(current);
          const right = step.operandType === "variable"
            ? valueAt(variables, typeof step.operand === "string" ? step.operand : "")
            : step.operand;
          const rhs = numberLike(right);
          if (left === undefined || rhs === undefined) return failure("type-mismatch");
          current = left;
          switch (step.operation) {
            case "add": current += rhs; break;
            case "subtract": current -= rhs; break;
            case "multiply": current *= rhs; break;
            case "divide":
              if (rhs === 0) return failure("division-by-zero");
              current /= rhs; break;
            case "remainder":
              if (rhs === 0) return failure("division-by-zero");
              current %= rhs; break;
            default: return failure("invalid-recipe");
          }
          if (!Number.isFinite(current)) return failure("limit-exceeded");
          break;
        }
        case "compare": {
          if (absent) break;
          const rhs = argument(step);
          if (!rhs.ok) return failure("invalid-literal");
          const answer = compare(current, rhs.value, step.operation);
          if (answer === undefined) return failure("type-mismatch");
          current = answer;
          break;
        }
        case "not":
          if (absent) break;
          if (typeof current !== "boolean") return failure("type-mismatch");
          current = !current;
          break;
        case "split": {
          if (absent) break;
          if (typeof current !== "string" || typeof step.separator !== "string" ||
              step.separator.length > 256) return failure("type-mismatch");
          if (current.length > 100000) return failure("limit-exceeded");
          current = current.split(step.separator || ",").map((part: string) => part.trim()).filter(Boolean);
          break;
        }
        case "join": {
          if (absent) break;
          if (!Array.isArray(current) || typeof step.separator !== "string" ||
              step.separator.length > 256) return failure("type-mismatch");
          if (current.length > 10000) return failure("limit-exceeded");
          const pieces: string[] = [];
          for (const part of current) {
            if (part === null || part === "") continue;
            if (!scalar(part)) return failure("type-mismatch");
            pieces.push(String(part));
          }
          current = pieces.join(step.separator);
          break;
        }
        case "replace": {
          if (absent) break;
          if (typeof current !== "string" || typeof step.find !== "string" ||
              typeof step.replacement !== "string" || typeof step.regex !== "boolean") return failure("type-mismatch");
          if (current.length > 10000 || step.find.length > 256 || step.replacement.length > 10000)
            return failure("limit-exceeded");
          if (!step.find) break;
          if (step.regex) {
            let pattern: RegExp;
            try { pattern = new RegExp(step.find, "g"); } catch { return failure("invalid-regex"); }
            current = current.replace(pattern, step.replacement);
          } else current = current.split(step.find).join(step.replacement);
          break;
        }
        case "find":
        case "filter": {
          if (absent) break;
          if (!Array.isArray(current) || typeof step.field !== "string" ||
              step.field.length > 256 || current.length > 10000) return failure("type-mismatch");
          const rhs = argument(step);
          if (!rhs.ok) return failure("invalid-literal");
          const kept: unknown[] = [];
          let match: unknown = undefined;
          for (const item of current) {
            const lhs = valueAt(item, step.field);
            if (lhs === undefined) continue;
            const yes = compare(lhs, rhs.value, step.operation);
            if (yes === undefined) return failure("type-mismatch");
            if (yes) {
              if (step.kind === "find") { match = item; break; }
              kept.push(item);
            }
          }
          if (step.kind === "find") { current = match; absent = match === undefined; }
          else current = kept;
          break;
        }
        case "map-field": {
          if (absent) break;
          if (!Array.isArray(current) || typeof step.field !== "string" ||
              !step.field || step.field.length > 256 || current.length > 10000)
            return failure("type-mismatch");
          const mapped: unknown[] = [];
          for (const item of current) {
            const field = valueAt(item, step.field);
            if (field === undefined) return failure("missing-value");
            mapped.push(field);
          }
          current = mapped;
          break;
        }
        case "map-set": {
          if (absent) break;
          if (!Array.isArray(current) || typeof step.field !== "string" ||
              !step.field || step.field.length > 256 || current.length > 10000)
            return failure("type-mismatch");
          if (step.field === "__proto__" || step.field === "constructor" || step.field === "prototype")
            return failure("invalid-path");
          const rhs = argument(step);
          if (!rhs.ok) return failure("invalid-literal");
          const mapped: unknown[] = [];
          for (const item of current) {
            if (!item || typeof item !== "object" || Array.isArray(item)) return failure("type-mismatch");
            const copy = Object.assign(Object.create(null), item);
            copy[step.field] = rhs.value;
            mapped.push(copy);
          }
          current = mapped;
          break;
        }
        case "append":
        case "remove": {
          if (absent) break;
          if (!Array.isArray(current) || current.length > 10000) return failure("type-mismatch");
          const rhs = argument(step);
          if (!rhs.ok) return failure("invalid-literal");
          if (step.kind === "append") {
            if (current.length >= 10000) return failure("limit-exceeded");
            current = [...current, rhs.value];
          } else {
            // Remove all elements equal to the chosen value; input array is not mutated.
            current = current.filter((item: unknown) => item !== rhs.value);
          }
          break;
        }
        case "remove-at": {
          if (absent) break;
          if (!Array.isArray(current) || current.length > 10000 || !Number.isInteger(step.index) ||
              step.index < -1 || step.index > 1000000) return failure("type-mismatch");
          const index = step.index === -1 ? current.length - 1 : step.index;
          current = current.filter((_: unknown, at: number) => at !== index);
          break;
        }
        case "sort": {
          if (absent) break;
          if (!Array.isArray(current) || typeof step.field !== "string" ||
              step.field.length > 256 || current.length > 10000 ||
              (step.direction !== "asc" && step.direction !== "desc"))
            return failure("type-mismatch");
          const pairs: { item: unknown; key: string | number; order: number }[] = [];
          let keyType: string | undefined;
          for (let i = 0; i < current.length; i++) {
            const item = current[i];
            const key = valueAt(item, step.field);
            if (key === undefined) return failure("missing-value");
            if (typeof key !== "number" && typeof key !== "string") return failure("type-mismatch");
            if (typeof key === "number" && !Number.isFinite(key)) return failure("type-mismatch");
            if (keyType !== undefined && keyType !== typeof key) return failure("type-mismatch");
            keyType = typeof key;
            pairs.push({ item, key, order: i });
          }
          pairs.sort((a, b) => {
            let order = a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
            if (step.direction === "desc") order *= -1;
            return order || a.order - b.order;
          });
          current = pairs.map((p) => p.item);
          break;
        }
        default: return failure("invalid-recipe");
      }
      if (typeof current === "string" && current.length > 100000) return failure("limit-exceeded");
      if (Array.isArray(current) && current.length > 10000) return failure("limit-exceeded");
    }
    return absent ? missing : { kind: "value", value: current };
  } catch {
    return failure("invalid-recipe");
  }
}
