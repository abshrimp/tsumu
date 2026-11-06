import type { ErrorCode, Eval, EvalError, Json, Limits, Path } from "./types";

export const HARD_LIMITS: Readonly<Limits> = Object.freeze({ maxDepth: 64, maxSteps: 100_000, maxNodes: 20_000, maxTextUnits: 1_000_000 });
export const missing = Object.freeze({ kind: "missing" } as const);
export const value = (value: Json): Eval => ({ kind: "value", value });
export const own = (object: object, key: PropertyKey): boolean => Object.prototype.hasOwnProperty.call(object, key);
export const dictionary = (): Record<string, Json> => Object.create(null) as Record<string, Json>;
export const actualType = (value: unknown): string => value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
export const pointer = (path: string, key: string | number): string => `${path}/${String(key).replace(/~/g, "~0").replace(/\//g, "~1")}`;

class Failure extends Error {
  constructor(readonly result: EvalError) { super(result.code); }
}
export function fail(code: ErrorCode, exprPath: string, expected?: string, actual?: string): never {
  throw new Failure({ kind: "error", code, exprPath, ...(expected === undefined ? {} : { expected }), ...(actual === undefined ? {} : { actual }) });
}
export function capture<T>(work: () => T): T | EvalError {
  try { return work(); } catch (error) {
    if (error instanceof Failure) return error.result;
    throw error;
  }
}

/** One budget spans input snapshots, validation, execution and detached output. */
export class Budget {
  readonly limits: Readonly<Limits>;
  private steps = 0;
  private nodes = 0;
  private textUnits = 0;
  private readonly keysByObject = new WeakMap<object, readonly string[]>();
  constructor(overrides: Partial<Limits> = {}) {
    if (overrides === null || typeof overrides !== "object" || (Object.getPrototypeOf(overrides) !== Object.prototype && Object.getPrototypeOf(overrides) !== null)) fail("invalid-limits", "/limits");
    const limits = { ...HARD_LIMITS };
    for (const key of Reflect.ownKeys(overrides)) {
      const descriptor = Object.getOwnPropertyDescriptor(overrides, key)!;
      if (typeof key !== "string" || !own(limits, key) || !descriptor.enumerable || !own(descriptor, "value")) fail("invalid-limits", "/limits");
      const n: unknown = descriptor.value;
      if (typeof n !== "number" || !Number.isSafeInteger(n) || n < 1 || n > HARD_LIMITS[key as keyof Limits]) fail("invalid-limits", "/limits");
      limits[key as keyof Limits] = n;
    }
    this.limits = limits;
  }
  tick(path: string, amount = 1): void {
    this.steps += amount;
    if (this.steps > this.limits.maxSteps) fail("limit-exceeded", path);
  }
  depth(depth: number, path: string): void { if (depth > this.limits.maxDepth) fail("limit-exceeded", path); }
  node(path: string): void {
    this.tick(path);
    if (++this.nodes > this.limits.maxNodes) fail("limit-exceeded", path);
  }
  text(length: number, path: string): void {
    this.textUnits += length;
    if (this.textUnits > this.limits.maxTextUnits) fail("limit-exceeded", path);
  }
  rememberKeys(object: object, keys: readonly string[]): void { this.keysByObject.set(object, keys); }
  objectKeys(object: object, path: string): readonly string[] {
    const keys = this.keysByObject.get(object);
    // All internal records originate in a snapshot or a registered path copy.
    if (!keys) fail("invalid-json-value", path);
    this.tick(path, keys.length);
    return keys;
  }
}

/** JSON data boundary, not a sandbox for hostile JS Proxies. Never calls data getters/toJSON. */
export function snapshot(input: unknown, budget: Budget, path: string, depth = 0, ancestors = new Set<object>()): Json {
  budget.depth(depth, path);
  budget.node(path);
  if (input === null || typeof input === "boolean") return input;
  if (typeof input === "number") {
    if (!Number.isFinite(input)) fail("invalid-json-value", path, "finite number", "number");
    return input === 0 ? 0 : input;
  }
  if (typeof input === "string") { budget.text(input.length, path); return input; }
  if (typeof input !== "object") fail("invalid-json-value", path, "JSON", actualType(input));
  const array = Array.isArray(input);
  if (!array && Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null) fail("invalid-json-value", path, "plain object", "object");
  if (ancestors.has(input)) fail("invalid-json-value", path, "acyclic JSON", "object");
  const keys = Reflect.ownKeys(input);
  if (keys.length > budget.limits.maxNodes + (array ? 1 : 0)) fail("limit-exceeded", path);
  if (array && input.length > budget.limits.maxNodes) fail("limit-exceeded", path);
  if (array && keys.length !== input.length + 1) fail("invalid-json-value", path, "dense JSON array", "array");
  ancestors.add(input);
  const result: Json[] | Record<string, Json> = array ? [] : dictionary();
  for (const key of keys) {
    if (array && key === "length") continue;
    if (typeof key !== "string") fail("invalid-json-value", path, "string key", "symbol");
    if (array && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= input.length)) fail("invalid-json-value", path, "array index", "string");
    const descriptor = Object.getOwnPropertyDescriptor(input, key)!;
    if (!descriptor.enumerable || !own(descriptor, "value")) fail("invalid-json-value", path, "enumerable data property", "object");
    budget.text(key.length, path);
    // The caller supplies an expression/context location, never echo JSON payload keys.
    const child = snapshot(descriptor.value, budget, path, depth + 1, ancestors);
    if (array) (result as Json[]).push(child);
    else (result as Record<string, Json>)[key] = child;
  }
  ancestors.delete(input);
  if (!array) budget.rememberKeys(result, keys as string[]);
  return result;
}

export function requireValue(result: Eval, path: string): Json {
  if (result.kind === "error") throw new Failure(result);
  if (result.kind === "missing") fail("missing-value", path);
  return result.value;
}
export function requireArray(input: Json, path: string): readonly Json[] {
  if (!Array.isArray(input)) fail("type-mismatch", path, "array", actualType(input));
  return input;
}
export function requireString(input: Json, path: string): string {
  if (typeof input !== "string") fail("type-mismatch", path, "string", actualType(input));
  return input;
}

function segment(container: Json, part: string | number, path: string): string | number {
  if (Array.isArray(container)) {
    if (typeof part !== "number") fail("type-mismatch", path, "numeric array index", "string");
    return part < 0 ? container.length + part : part;
  }
  if (container === null || typeof container !== "object") fail("type-mismatch", path, "object or array", actualType(container));
  if (typeof part !== "string") fail("type-mismatch", path, "string object key", "number");
  return part;
}

export function readPath(input: Json, parts: Path, budget: Budget, path: string): Eval {
  let current = input;
  for (const part of parts) {
    budget.tick(path);
    const key = segment(current, part, path);
    if (!own(current as object, key)) return missing;
    current = (current as Record<string | number, Json>)[key];
  }
  return value(current);
}

/** Path-copy update. Arrays remain dense; only index === length can append. */
export function updatePath(input: Json, parts: Path, replacement: Json | undefined, create: boolean, budget: Budget, path: string, offset = 0): Json {
  budget.tick(path);
  budget.depth(offset, path);
  const key = segment(input, parts[offset], path);
  const exists = own(input as object, key);
  const array = Array.isArray(input);
  const last = offset === parts.length - 1;
  const removing = replacement === undefined;
  if (!exists && removing) return input;
  if (array && (Number(key) < 0 || Number(key) > input.length)) fail("invalid-path", path, "existing index or append position", "number");
  let next: Json;
  if (last) next = replacement ?? null; // Null is a value; undefined is internal removal only.
  else {
    if (!exists && !create) fail("missing-parent", path);
    const child = exists ? (input as Record<string | number, Json>)[key] : typeof parts[offset + 1] === "number" ? [] : dictionary();
    if (!exists && !Array.isArray(child)) budget.rememberKeys(child as object, []);
    next = updatePath(child, parts, replacement, create, budget, path, offset + 1);
  }
  if (array) {
    budget.tick(path, input.length);
    const result = [...input];
    if (last && removing) result.splice(Number(key), 1);
    else result[Number(key)] = next;
    return result;
  }
  const result = dictionary();
  const keys = budget.objectKeys(input as object, path);
  const resultKeys: string[] = [];
  for (const k of keys) {
    if (last && removing && k === key) continue;
    result[k] = (input as Record<string, Json>)[k];
    resultKeys.push(k);
  }
  if (!(last && removing)) {
    result[key] = next;
    if (!exists) resultKeys.push(String(key));
  }
  budget.rememberKeys(result, resultKeys);
  return result;
}

export function equalJson(left: Json, right: Json, budget: Budget, path: string, depth = 0): boolean {
  budget.tick(path);
  budget.depth(depth, path);
  if (typeof left === "string" && typeof right === "string") budget.tick(path, Math.max(left.length, right.length));
  if (left === right) return true;
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object" || Array.isArray(left) !== Array.isArray(right)) return false;
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) return false;
    budget.tick(path, left.length);
    return left.every((item, index) => equalJson(item, right[index], budget, path, depth + 1));
  }
  const keys = budget.objectKeys(left, path);
  if (keys.length !== budget.objectKeys(right, path).length) return false;
  return keys.every(key => own(right, key) && equalJson((left as Record<string, Json>)[key], (right as Record<string, Json>)[key], budget, path, depth + 1));
}
