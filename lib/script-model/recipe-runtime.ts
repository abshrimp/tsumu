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
  // A single text field accepts ordinary text, {variable.path}, or a mixture.
  // Whole references preserve the source value (including numbers, lists, null).
  // Escaped \{ starts a literal brace. No eval or dynamic code is involved.
  const interpolateText = (template: string, max: number, regexPattern = false):
    { ok: true; value: unknown } | { ok: false } => {
    if (typeof template !== "string" || template.length > max) return { ok: false };
    const single = /^\{([^{}\s"'<>]+)\}$/.exec(template);
    if (single && (!regexPattern || !/^\d+(,\d*)?$/.test(single[1]))) {
      const value = valueAt(variables, single[1]);
      return value === undefined ? { ok: false } : { ok: true, value };
    }
    const output = template.replace(/\\\{|\{([^{}\s"'<>]+)\}/g, (token, path: string | undefined) => {
      if (token.charAt(0) === "\\") return "{";
      if (regexPattern && /^\d+(,\d*)?$/.test(path ?? "")) return token;
      const v = valueAt(variables, path ?? "");
      const asText = (value: unknown): string =>
        value == null || typeof value === "object" ? "" : String(value);
      return Array.isArray(v) ? v.map(asText).filter(Boolean).join(", ") : asText(v);
    });
    return output.length <= max ? { ok: true, value: output } : { ok: false };
  };
  const textParam = (template: string, max: number, regexPattern = false):
    { ok: true; value: string } | { ok: false } => {
    const result = interpolateText(template, max, regexPattern);
    if (!result.ok || result.value === null || typeof result.value === "object") return { ok: false };
    const value = String(result.value);
    return value.length <= max ? { ok: true, value } : { ok: false };
  };
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
    if (step.operandType === "text") return interpolateText(step.operand, 4096);
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
  // Condition predicates use the same text comparison rules as if/list filters.
  // Arithmetic remains numeric; equality compares the displayed value as text.
  const conditionText = (value: unknown): string => {
    if (value == null) return "";
    if (Array.isArray(value)) return value.map(conditionText).filter(Boolean).join(", ");
    if (typeof value === "object") return "";
    return String(value);
  };
  const compare = (left: unknown, right: string, operator: string): boolean => {
    const value = conditionText(left);
    switch (operator) {
      case "contains": return value.includes(right);
      case "starts-with": return value.startsWith(right);
      case "ends-with": return value.endsWith(right);
      case "gt": return parseFloat(value) > parseFloat(right);
      case "gte": return parseFloat(value) >= parseFloat(right);
      case "lt": return parseFloat(value) < parseFloat(right);
      case "lte": return parseFloat(value) <= parseFloat(right);
      case "empty": return value === "";
      case "in": return right.split(",").some((part) => part.trim() === value);
      default: return value === right;
    }
  };

  // Same grouping rule as visual list filters: AND binds inside OR groups.
  const matchesConditions = (
    value: unknown,
    first: { readonly operation: string; readonly operand: string; readonly not?: boolean; readonly field?: string },
    additional: readonly { readonly operation: string; readonly operand: string; readonly not?: boolean; readonly and?: boolean; readonly field: string }[],
    itemMode: boolean,
  ): { ok: true; value: boolean } | { ok: false; code: string } => {
    if (additional.length > 32) return { ok: false, code: "limit-exceeded" };
    let any = false;
    let all = true;
    const clauses = [first, ...additional];
    for (let index = 0; index < clauses.length; index++) {
      const clause = clauses[index];
      if (index > 0 && !("and" in clause && clause.and)) {
        any = any || all;
        all = true;
      }
      const rhs = clause.operation === "empty"
        ? { ok: true as const, value: "" } : interpolateText(clause.operand, 4096);
      if (!rhs.ok) return { ok: false, code: "invalid-literal" };
      let lhs = value;
      if (itemMode) {
        const field = textParam(clause.field ?? "", 256);
        if (!field.ok) return { ok: false, code: "type-mismatch" };
        lhs = valueAt(value, field.value);
      }
      // A missing item field never satisfies a condition, including its negation.
      if (itemMode && lhs === undefined) { all = false; continue; }
      const result = compare(lhs, conditionText(rhs.value), clause.operation);
      all = all && (clause.not ? !result : result);
    }
    return { ok: true, value: any || all };
  };

  let current: unknown = input;
  let absent = current === undefined;
  try {
    for (const step of steps) {
      if (!step || typeof step !== "object" || !("kind" in step)) return failure("invalid-recipe");
      switch (step.kind) {
        case "fallback":
        case "fallback-nullish": {
          if (typeof step.text !== "string" || step.text.length > 10000) return failure("invalid-recipe");
          if (absent || (step.kind === "fallback-nullish" && current === null)) {
            const replacement = interpolateText(step.text, 10000);
            if (!replacement.ok) return failure("missing-value");
            current = replacement.value;
            absent = false;
          }
          break;
        }
        case "field":
        case "has": {
          if (absent) {
            if (step.kind === "has") { current = false; absent = false; }
            break;
          }
          const key = textParam(step.key, 256);
          if (!key.ok || !current || typeof current !== "object" || Array.isArray(current))
            return failure("type-mismatch");
          const present = owns(current, key.value);
          if (step.kind === "has") { current = present; absent = false; }
          else { current = present ? (current as Record<string, unknown>)[key.value] : undefined; absent = !present; }
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
          let arithmetic = left;
          switch (step.operation) {
            case "add": arithmetic += rhs; break;
            case "subtract": arithmetic -= rhs; break;
            case "multiply": arithmetic *= rhs; break;
            case "divide":
              if (rhs === 0) return failure("division-by-zero");
              arithmetic /= rhs; break;
            case "remainder":
              if (rhs === 0) return failure("division-by-zero");
              arithmetic %= rhs; break;
            default: return failure("invalid-recipe");
          }
          if (!Number.isFinite(arithmetic)) return failure("limit-exceeded");
          current = arithmetic;
          break;
        }
        case "compare": {
          if (absent) break;
          const result = matchesConditions(current, step, step.conditions ?? [], false);
          if (!result.ok) return failure(result.code);
          current = result.value;
          break;
        }
        case "not":
          if (absent) break;
          if (typeof current !== "boolean") return failure("type-mismatch");
          current = !current;
          break;
        case "split": {
          if (absent) break;
          const delimiter = textParam(step.separator, 256);
          if (typeof current !== "string" || !delimiter.ok) return failure("type-mismatch");
          if (current.length > 100000) return failure("limit-exceeded");
          current = current.split(delimiter.value || ",").map((part: string) => part.trim()).filter(Boolean);
          break;
        }
        case "join": {
          if (absent) break;
          const delimiter = textParam(step.separator, 256);
          if (!Array.isArray(current) || !delimiter.ok) return failure("type-mismatch");
          if (current.length > 10000) return failure("limit-exceeded");
          const pieces: string[] = [];
          for (const part of current) {
            if (part === null || part === "") continue;
            if (!scalar(part)) return failure("type-mismatch");
            pieces.push(String(part));
          }
          current = pieces.join(delimiter.value);
          break;
        }
        case "replace": {
          if (absent) break;
          const needle = textParam(step.find, 256, step.regex);
          const replacement = textParam(step.replacement, 10000);
          if (typeof current !== "string" || !needle.ok || !replacement.ok ||
              typeof step.regex !== "boolean") return failure("type-mismatch");
          if (current.length > 10000) return failure("limit-exceeded");
          if (!needle.value) break;
          if (step.regex) {
            let pattern: RegExp;
            try { pattern = new RegExp(needle.value, "g"); } catch { return failure("invalid-regex"); }
            current = current.replace(pattern, replacement.value);
          } else current = current.split(needle.value).join(replacement.value);
          break;
        }
        case "find":
        case "filter": {
          if (absent) break;
          if (!Array.isArray(current) || current.length > 10000) return failure("type-mismatch");
          const kept: unknown[] = [];
          let match: unknown = undefined;
          for (const item of current) {
            const result = matchesConditions(item, step, step.conditions ?? [], true);
            if (!result.ok) return failure(result.code);
            if (result.value) {
              if (step.kind === "find") { match = item; break; }
              kept.push(item);
            }
          }
          if (step.kind === "find") { current = match; absent = match === undefined; }
          else current = kept;
          break;
        }
        case "object-entries": {
          if (absent) break;
          if (!current || typeof current !== "object" || Array.isArray(current))
            return failure("type-mismatch");
          const keyName = textParam(step.keyField, 128);
          const valueName = textParam(step.valueField, 128);
          if (!keyName.ok || !valueName.ok || !keyName.value.trim() || !valueName.value.trim() ||
              keyName.value === valueName.value ||
              [keyName.value, valueName.value].some((name) =>
                name === "__proto__" || name === "constructor" || name === "prototype"))
            return failure("invalid-path");
          const source = current as Record<string, unknown>;
          const entries = Object.entries(source);
          if (entries.length > 10000) return failure("limit-exceeded");
          current = entries.map(([key, value]) =>
            Object.fromEntries([[keyName.value, key], [valueName.value, value]]));
          break;
        }
        case "map-field": {
          if (absent) break;
          const field = textParam(step.field, 256);
          if (!Array.isArray(current) || !field.ok || !field.value || current.length > 10000)
            return failure("type-mismatch");
          const mapped: unknown[] = [];
          for (const item of current) {
            const entry = valueAt(item, field.value);
            if (entry === undefined) return failure("missing-value");
            mapped.push(entry);
          }
          current = mapped;
          break;
        }
        case "map-set": {
          if (absent) break;
          const field = textParam(step.field, 256);
          if (!Array.isArray(current) || !field.ok || !field.value || current.length > 10000)
            return failure("type-mismatch");
          if (field.value === "__proto__" || field.value === "constructor" || field.value === "prototype")
            return failure("invalid-path");
          const rhs = argument(step);
          if (!rhs.ok) return failure("invalid-literal");
          const mapped: unknown[] = [];
          for (const item of current) {
            if (!item || typeof item !== "object" || Array.isArray(item)) return failure("type-mismatch");
            const copy = Object.assign(Object.create(null), item);
            copy[field.value] = rhs.value;
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
          const field = textParam(step.field, 256);
          if (!Array.isArray(current) || !field.ok || current.length > 10000 ||
              (step.direction !== "asc" && step.direction !== "desc"))
            return failure("type-mismatch");
          const pairs: { item: unknown; key: string | number; order: number }[] = [];
          let keyType: string | undefined;
          for (let i = 0; i < current.length; i++) {
            const item = current[i];
            const key = valueAt(item, field.value);
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
