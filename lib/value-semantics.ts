/**
 * Predicate rules shared by the editor, pre-render evaluation and published scripts.
 * Keep this function self-contained: the browser runtime embeds its source.
 * Lists expose own enumerable key/value pairs, but preserve their JSON shape.
 */
export function matchesValueCondition(left: unknown, operator: string, right: unknown): boolean {
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
    // Non-finite numbers are not valid JSON values; never treat infinity as
    // an equal or contained script value just because JS says it is equal.
    if (typeof a === "number" && !Number.isFinite(a) ||
        typeof b === "number" && !Number.isFinite(b)) return false;
    if (a === b) return true;
    // Compare numbers and booleans with their exact text forms, without JS ==.
    // Preserve null, missing values, scalar-kind differences, and numeric spelling.
    if (typeof a === "string" && (typeof b === "boolean" ||
        (typeof b === "number" && Number.isFinite(b)))) return a === String(b);
    if (typeof b === "string" && (typeof a === "boolean" ||
        (typeof a === "number" && Number.isFinite(a)))) return String(a) === b;
    if (!record(a) || !record(b) || depth >= 16) return false;
    const aa = Object.keys(a), bb = Object.keys(b);
    if (aa.length !== bb.length || aa.length > 10000) return false;
    return aa.every((key) => owns(b, key) && same(
      (a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], depth + 1));
  };
  if (operator === "has-key") {
    if (!record(left) || record(right) || right === undefined || right === null) return false;
    return Object.prototype.propertyIsEnumerable.call(left, String(right));
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
    return right.split(",").some((part) => same(left, part.trim()));
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

/** Infer only unambiguous JSON literals. Other text remains text. */
export function parseValueLiteral(text: string): unknown {
  const source = text.trim();
  if (source === "true" || source === "false" || source === "null" ||
      source.startsWith("[") || source.startsWith("{") ||
      /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(source) ||
      (source.length >= 2 && source.startsWith('"') && source.endsWith('"'))) {
    try { return JSON.parse(source); } catch { /* Ordinary text. */ }
  }
  return text;
}

/** Budget the expanded JSON shape without serializing shared subtrees. */
export function withinScriptValueLimit(value: unknown): boolean {
  // The fetch transports also cap JSON responses at 5 MiB. This counts string
  // code units and container overhead, bounding expansion before serialization.
  const limit = 5 * 1024 * 1024;
  if (value === undefined || value === null) return true;
  if (typeof value !== "object") {
    if (typeof value === "number") return Number.isFinite(value);
    if (typeof value === "string") return value.length <= limit;
    return typeof value === "boolean";
  }
  const sizes = new WeakMap<object, { cost: number; height: number }>();
  const measure = (item: unknown, depth: number): { cost: number; height: number } => {
    if (depth > 64) return { cost: Infinity, height: 0 };
    if (item === null || item === undefined) return { cost: 8, height: 0 };
    if (typeof item !== "object") {
      if (typeof item === "number" && !Number.isFinite(item) ||
          typeof item !== "number" && typeof item !== "string" &&
          typeof item !== "boolean") return { cost: Infinity, height: 0 };
      return { cost: typeof item === "string" ? item.length + 2 : 8, height: 0 };
    }
    const cached = sizes.get(item);
    if (cached) return depth + cached.height <= 64 ? cached : { cost: Infinity, height: 0 };
    // A reference to an active ancestor is a cycle.
    sizes.set(item, { cost: Infinity, height: 0 });
    if (Array.isArray(item) && item.length > limit) return { cost: Infinity, height: 0 };
    let cost = Array.isArray(item) ? 2 + item.length : 2;
    let height = 0;
    for (const key of Object.keys(item)) {
      const child = measure((item as Record<string, unknown>)[key], depth + 1);
      cost += key.length + 4 + child.cost;
      height = Math.max(height, child.height + 1);
      if (cost > limit) return { cost: Infinity, height: 0 };
    }
    const measured = { cost, height };
    sizes.set(item, measured);
    return measured;
  };
  return measure(value, 0).cost <= limit;
}

/** 変数に値を入れる（"記事.tags" のような入れ子は、元の値を変えずに途中を複製して入れる） */
export function setVarPath(vars: Record<string, unknown>, name: string, value: unknown,
  accept?: (candidate: unknown) => boolean): string | undefined {
  if (typeof name !== "string" || !name) return undefined;
  const owns = (obj: object, key: string | number) =>
    Object.prototype.hasOwnProperty.call(obj, key);
  // Object.defineProperty writes __proto__ as a normal own key, not as a
  // prototype mutation. Only own keys may shadow a path.
  const write = (key: string, next: unknown) => {
    if (accept && !accept(next)) return undefined;
    Object.defineProperty(vars, key, { value: next, writable: true, enumerable: true, configurable: true });
    return key;
  };
  if (owns(vars, name) || !name.includes(".")) {
    return write(name, value);
  }
  let invalidPath = false;
  const put = (cur: unknown, keys: string[]): unknown => {
    if (!keys.length) return value;
    const [k, ...rest] = keys;
    if (Array.isArray(cur)) {
      // A nested array path must update an existing slot or append one item.
      // Never turn a list into a dictionary or construct a sparse million-slot
      // list from an accidental index (set-list-item follows the same rule).
      if (!/^(0|[1-9][0-9]*)$/.test(k)) { invalidPath = true; return cur; }
      const index = Number(k);
      if (!Number.isSafeInteger(index) || index > cur.length ||
          (index === cur.length && cur.length >= 10000)) {
        invalidPath = true;
        return cur;
      }
      const copy = cur.slice();
      copy[index] = put(owns(cur, index) ? cur[index] : undefined, rest);
      return copy;
    }
    const obj = cur && typeof cur === "object" ? cur as Record<string, unknown> : {};
    return { ...obj, [k]: put(owns(obj, k) ? obj[k] : undefined, rest) };
  };
  const [root, ...rest] = name.split(".");
  if (rest.length > 64) return undefined;
  const candidate = put(owns(vars, root) ? vars[root] : undefined, rest);
  return invalidPath ? undefined : write(root, candidate);
}
