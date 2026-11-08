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
    if (typeof value !== "string" || !/^-?(?:0|[1-9]\\d*)(?:\\.\\d+)?(?:[eE][+-]?\\d+)?$/.test(value.trim())) return undefined;
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
