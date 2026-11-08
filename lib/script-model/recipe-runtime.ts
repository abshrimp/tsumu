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
      if (result === null || typeof result !== "object") return undefined;
      const key = Array.isArray(result) && part === "-1" ? result.length - 1 : part;
      if (!owns(result, key)) return undefined;
      result = (result as Record<string | number, unknown>)[key];
    }
    return result;
  };
  const hasAt = (item: unknown, path: string): boolean => {
    if (!item || typeof item !== "object") return false;
    if (owns(item, path)) return true;
    const parts = path.split(".");
    if (parts.length > 16) return false;
    let result: unknown = item;
    for (const part of parts) {
      if (result === null || typeof result !== "object") return false;
      const key = Array.isArray(result) && part === "-1" ? result.length - 1 : part;
      if (!owns(result, key)) return false;
      result = (result as Record<string | number, unknown>)[key];
    }
    return true;
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
  // JavaScript RegExp may backtrack exponentially on external data.
  // The generated browser and server code embed this evaluator verbatim.
  const safeRegex = (pattern: string): boolean => {
    if (pattern.length > 256) return false;
    type Scope = { repeats: boolean; alternation: boolean };
    type Atom = { category: string | null; group?: Scope };
    const scopes: Scope[] = [{ repeats: false, alternation: false }];
    const repeated: (string | null)[] = [];
    const category = (value: string): string | null => {
      if (value === "\\d" || value === "[0-9]") return "digit";
      if (value === "\\w") return "word";
      if (value === "\\s") return "space";
      if (value === "[a-z]") return "lower";
      if (value === "[A-Z]") return "upper";
      if (value.length === 1) return "literal:" + value;
      return null;
    };
    const accepts = (kind: string, char: string): boolean => {
      if (kind === "word") return /^[a-zA-Z0-9_]$/.test(char);
      if (kind === "digit") return /^[0-9]$/.test(char);
      if (kind === "lower") return /^[a-z]$/.test(char);
      if (kind === "upper") return /^[A-Z]$/.test(char);
      if (kind === "space") return /^\s$/.test(char);
      return true;
    };
    const overlaps = (a: string | null, b: string | null): boolean => {
      if (!a || !b) return true;
      if (a.startsWith("literal:"))
        return b.startsWith("literal:") ? a === b : accepts(b, a.slice(8));
      if (b.startsWith("literal:")) return accepts(a, b.slice(8));
      if (a === "word") return b !== "space";
      if (b === "word") return a !== "space";
      return a === b;
    };
    let last: Atom | null = null;
    for (let i = 0; i < pattern.length; i++) {
      const char = pattern[i];
      if (char === "\\") {
        if (i + 1 >= pattern.length || /[1-9]/.test(pattern[i + 1]) ||
            pattern[i + 1] === "k") return false;
        // Consume multi-character escapes as one atom. Its trailing digit or
        // letter is not the character that the regex engine will repeat.
        const escape = pattern[i + 1];
        if (escape === "x" || escape === "u" || escape === "c") {
          const token = /^(?:x[0-9a-f]{2}|u[0-9a-f]{4}|c[a-z])/i.exec(pattern.slice(i + 1));
          if (!token) return false;
          const code = escape === "c" ? token[0].toUpperCase().charCodeAt(1) % 32 :
            parseInt(token[0].slice(1), 16);
          last = { category: category(String.fromCharCode(code)) };
          i += token[0].length;
          continue;
        }
        if (escape === "0" && /[0-9]/.test(pattern[i + 2] ?? "")) return false;
        last = { category: category("\\" + pattern[++i]) };
        continue;
      }
      if (char === "[") {
        let end = i + 1;
        for (; end < pattern.length; end++) {
          if (pattern[end] === "\\") { end++; continue; }
          if (pattern[end] === "]") break;
        }
        if (end >= pattern.length) return false;
        last = { category: category(pattern.slice(i, end + 1)) };
        i = end;
        continue;
      }
      if (char === "(") {
        if (pattern[i + 1] === "?") {
          if (pattern[i + 2] !== ":") return false;
          i += 2;
        }
        scopes.push({ repeats: false, alternation: false });
        last = null;
        continue;
      }
      if (char === ")") {
        if (scopes.length <= 1) return false;
        const completed = scopes.pop()!;
        // Repetition or alternation can be nested in otherwise unquantified
        // groups; retain those flags when validating an outer group quantifier.
        scopes[scopes.length - 1].repeats ||= completed.repeats;
        scopes[scopes.length - 1].alternation ||= completed.alternation;
        last = { category: null, group: completed };
        continue;
      }
      if (char === "|") {
        scopes[scopes.length - 1].alternation = true;
        last = null;
        continue;
      }
      let quantifier = char === "*" || char === "+" || char === "?";
      let fixed = false;
      if (char === "{") {
        const count = /^\{(\d+)(?:,(\d*))?\}/.exec(pattern.slice(i));
        if (count) {
          const min = Number(count[1]);
          const max = count[2] === "" ? Infinity : count[2] === undefined ? min : Number(count[2]);
          if (min > 1000 || (max > 1000 && max !== Infinity) || max < min) return false;
          quantifier = true;
          fixed = min === max;
          i += count[0].length - 1;
        }
      }
      if (quantifier) {
        if (!last || (last.group && (last.group.repeats || last.group.alternation))) return false;
        if (!fixed) {
          if (repeated.some((other) => overlaps(last!.category, other))) return false;
          repeated.push(last.category);
          scopes[scopes.length - 1].repeats = true;
        }
        last = null;
      } else {
        last = { category: char === "." || char === "^" || char === "$" ? null : category(char) };
      }
    }
    return scopes.length === 1;
  };
  const MAX_RECIPE_TEXT = 100000;

  let current: unknown = input;
  let absent = current === undefined;
  try {
    for (const step of steps) {
      if (!step || typeof step !== "object" || !("kind" in step)) return failure("invalid-recipe");
      switch (step.kind) {
        case "fallback": {
          if (typeof step.text !== "string" || step.text.length > 10000) return failure("invalid-recipe");
          if (absent || (step.when === "nullish" && current === null)) {
            const replacement = interpolateText(step.text, 10000);
            if (!replacement.ok) return failure("missing-value");
            current = replacement.value;
            absent = false;
          }
          break;
        }
        case "field": {
          if (absent) break;
          const key = textParam(step.key, 256);
          if (!key.ok || !current || typeof current !== "object")
            return failure("type-mismatch");
          const direct = owns(current, key.value);
          const present = direct || (!!key.value && hasAt(current, key.value));
          current = present
            ? direct ? (current as Record<string, unknown>)[key.value] : valueAt(current, key.value)
            : undefined;
          absent = current === undefined;
          break;
        }
        case "length":
          if (absent) break;
          if (!current || typeof current !== "object") return failure("type-mismatch");
          current = Object.keys(current).length;
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
          // Already-parsed JSON values pass through without changing their type.
          // This also lets typed variable assignments feed existing parse chains.
          if (typeof current !== "string") {
            if (current === null || typeof current === "boolean" ||
                typeof current === "number" && Number.isFinite(current) ||
                typeof current === "object") break;
            return failure("type-mismatch");
          }
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
          if (!current || typeof current !== "object" || !delimiter.ok) return failure("type-mismatch");
          const values = Object.values(current);
          if (values.length > 10000) return failure("limit-exceeded");
          const pieces: string[] = [];
          for (const part of values) {
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
            if (current.length > 2048 || !safeRegex(needle.value)) return failure("invalid-regex");
            let pattern: RegExp;
            try { pattern = new RegExp(needle.value, "g"); } catch { return failure("invalid-regex"); }
            // Bound potentially expanded capture and surrounding-context substitutions.
            let projected = current.length;
            const captures = replacement.value.match(/\$(?:&|[1-9]\d?)/g)?.length ?? 0;
            const contexts = replacement.value.match(/\$(?:'|`)/g)?.length ?? 0;
            for (const match of current.matchAll(pattern)) {
              projected += replacement.value.length + captures * match[0].length + contexts * current.length;
              if (projected > MAX_RECIPE_TEXT) return failure("limit-exceeded");
            }
            current = current.replace(pattern, replacement.value);
          } else {
            const chunks = current.split(needle.value);
            const count = chunks.length - 1;
            const length = current.length + count * (replacement.value.length - needle.value.length);
            if (length > MAX_RECIPE_TEXT) return failure("limit-exceeded");
            current = chunks.join(replacement.value);
          }
          if (typeof current !== "string" || current.length > MAX_RECIPE_TEXT) return failure("limit-exceeded");
          break;
        }
        case "append": {
          if (absent) break;
          if (!Array.isArray(current) || current.length >= 10000) return failure("type-mismatch");
          const rhs = argument(step);
          if (!rhs.ok) return failure("invalid-literal");
          current = [...current, rhs.value];
          break;
        }
        case "sort": {
          if (absent) break;
          const field = textParam(step.field, 256);
          if (!current || typeof current !== "object" || !field.ok ||
              (step.direction !== "asc" && step.direction !== "desc"))
            return failure("type-mismatch");
          const array = Array.isArray(current);
          const entries = Object.entries(current);
          if (entries.length > 10000 || (Array.isArray(current) && current.length > 10000))
            return failure("limit-exceeded");
          const pairs: { item: unknown; sourceKey: string; key: string | number; order: number }[] = [];
          let keyType: string | undefined;
          for (let i = 0; i < entries.length; i++) {
            const [sourceKey, item] = entries[i];
            const key = valueAt(item, field.value);
            if (key === undefined) return failure("missing-value");
            if (typeof key !== "number" && typeof key !== "string") return failure("type-mismatch");
            if (typeof key === "number" && !Number.isFinite(key)) return failure("type-mismatch");
            if (keyType !== undefined && keyType !== typeof key) return failure("type-mismatch");
            keyType = typeof key;
            pairs.push({ item, sourceKey, key, order: i });
          }
          pairs.sort((a, b) => {
            // The list-display block uses natural Japanese collation for text
            // (so "2" precedes "10"), while numeric fields use arithmetic.
            let order = typeof a.key === "number" && typeof b.key === "number"
              ? a.key - b.key
              : String(a.key).localeCompare(String(b.key), "ja", { numeric: true });
            if (step.direction === "desc") order *= -1;
            return order || a.order - b.order;
          });
          // A dictionary cannot preserve arbitrary sort order in numeric-like keys.
          // Return explicit key/value rows; an array retains its original element shape.
          current = array ? pairs.map((p) => p.item) :
            pairs.map((p) => ({ "キー": p.sourceKey, "値": p.item }));
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
