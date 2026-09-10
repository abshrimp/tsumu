import type { ScriptOp } from "./types";
import type { ValueTransform } from "./script-model/compose";

const record = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === "string";
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const optional = (v: unknown, test: (v: unknown) => boolean) => v === undefined || test(v);
const bool = (v: unknown) => typeof v === "boolean";
const oneOf = (v: unknown, choices: readonly string[]) => str(v) && choices.includes(v);
const scriptOps: readonly ScriptOp[] = [
  "eq", "contains", "starts-with", "ends-with", "gt", "gte", "lt", "lte", "empty", "has-key", "in",
];
const validCond = (v: unknown, joined = false): boolean =>
  record(v) && oneOf(v.subject, ["value", "checked", "visible", "hovered", "var"]) &&
  str(v.target) && optional(v.left, str) && optional(v.op, x => oneOf(x, scriptOps)) &&
  optional(v.value, str) && optional(v.not, bool) && (!joined || bool(v.and));
const validFilter = (v: unknown): boolean =>
  record(v) && str(v.field) && oneOf(v.op, scriptOps) && str(v.value) &&
  optional(v.not, bool) && optional(v.and, bool);
const validHeader = (v: unknown): boolean =>
  record(v) && str(v.name) && str(v.value);
const finiteOrString = (v: unknown) => finite(v) || str(v);

function validTransform(v: unknown): v is ValueTransform {
  if (!record(v)) return false;
  switch (v.kind) {
    case "field": return str(v.key);
    case "length": case "stringify": case "parse": return true;
    case "fallback": return str(v.text) && optional(v.when, x => oneOf(x, ["missing", "nullish"]));
    case "math": return oneOf(v.operation, ["add", "subtract", "multiply", "divide", "remainder"]) &&
      finiteOrString(v.operand) && optional(v.operandType, x => oneOf(x, ["number", "variable"]));
    case "split": case "join": return str(v.separator);
    case "replace": return str(v.find) && str(v.replacement) && bool(v.regex);
    case "sort": return str(v.field) && oneOf(v.direction, ["asc", "desc"]);
    case "append": return str(v.operand) &&
      oneOf(v.operandType, ["text", "number", "boolean", "null", "variable"]);
    default: return false;
  }
}

function validSteps(value: unknown, depth: number, count: { value: number }): boolean {
  if (!Array.isArray(value) || depth > 64) return false;
  for (const step of value) {
    if (!record(step) || !str(step.id) || !step.id || ++count.value > 100_000) return false;
    let valid = false;
    switch (step.kind) {
      case "show": case "hide": case "toggle": case "scroll-to":
        valid = str(step.target); break;
      case "set-state":
        valid = str(step.target) && str(step.state); break;
      case "open-page":
        valid = str(step.pageId) && optional(step.newTab, bool); break;
      case "open-url":
        valid = str(step.url) && optional(step.newTab, bool); break;
      case "set-value":
        valid = str(step.target) && str(step.value); break;
      case "set-enabled":
        valid = str(step.target) && oneOf(step.op, ["enable", "disable", "toggle"]); break;
      case "list-display":
        valid = oneOf(step.mode, ["filter", "sort", "clear"]) &&
          str(step.array) && str(step.field) && oneOf(step.op, scriptOps) &&
          str(step.value) && optional(step.not, bool) &&
          optional(step.or, x => Array.isArray(x) && x.every(validFilter)) &&
          optional(step.no, finite) && optional(step.join, x => oneOf(x, ["and", "or"])) &&
          oneOf(step.dir, ["asc", "desc"]); break;
      case "store-save":
        valid = str(step.key) && str(step.value) && optional(step.shared, bool); break;
      case "store-load":
        valid = str(step.key) && str(step.into) && optional(step.shared, bool); break;
      case "set-list-item":
        valid = str(step.list) && str(step.key) && str(step.value); break;
      case "break-loop":
        valid = true; break;
      case "set-var":
        valid = str(step.value) && str(step.into); break;
      case "transform":
        valid = str(step.source) && str(step.into) && validTransform(step.transform); break;
      case "copy":
        valid = str(step.value); break;
      case "wait":
        valid = finiteOrString(step.seconds); break;
      case "repeat":
        valid = finiteOrString(step.times) && validSteps(step.then, depth + 1, count); break;
      case "for-each":
        valid = str(step.array) && validSteps(step.then, depth + 1, count); break;
      case "fetch":
        valid = str(step.url) && optional(step.method, x => oneOf(x, ["GET", "POST", "PUT", "PATCH", "DELETE"])) &&
          optional(step.headers, x => Array.isArray(x) && x.every(validHeader)) &&
          optional(step.body, str) && optional(step.as, str) &&
          optional(step.preview, x => record(x) &&
            optional(x.fetchedAt, finite) &&
            optional(x.totals, y => record(y) && Object.values(y).every(finite))) &&
          Object.keys(step).every(key =>
            ["id", "kind", "url", "method", "headers", "body", "as", "preview"].includes(key)); break;
      case "if":
        valid = validCond(step.cond) && optional(step.conditions,
          x => Array.isArray(x) && x.every(c => validCond(c, true))) &&
          validSteps(step.then, depth + 1, count) &&
          optional(step.else, x => validSteps(x, depth + 1, count)); break;
    }
    if (!valid) return false;
  }
  return true;
}

export function validDocumentScripts(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  const count = { value: 0 };
  for (const script of value) {
    if (!record(script) || !str(script.id) || !script.id ||
        !record(script.pos) || !finite(script.pos.x) || !finite(script.pos.y) ||
        !optional(script.trigger, x => oneOf(x, [
          "click", "hover-start", "hover-end", "change", "load", "in-view",
        ])) || !optional(script.keepOnShown, bool) ||
        !validSteps(script.steps, 0, count)) return false;
  }
  return true;
}
