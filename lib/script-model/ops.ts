import type { Eval, Expr, Json, Lambda, OpExpr, OpName, OperationFields, Path } from "./types";
import { actualType, Budget, equalJson, fail, missing, readPath, requireArray, requireString, requireValue, snapshot, updatePath, value } from "./values";

export interface OperationContext {
  readonly budget: Budget;
  readonly path: string;
  evaluate(expression: Expr, path: string): Eval;
  bind(lambda: Lambda, item: Json, index: number, path: string): Eval;
}
type FieldSpec<T> = [T] extends [Expr] ? "expr" : [T] extends [Lambda] ? "lambda" : [T] extends [Path] ? "path" : readonly T[];
type Definition<K extends OpName> = {
  fields: { readonly [F in keyof OperationFields[K]]: FieldSpec<OperationFields[K][F]> };
  evaluate(expression: Extract<OpExpr, { op: K }>, context: OperationContext): Eval;
};
type Registry = { readonly [K in OpName]: Definition<K> };

function input(expression: Expr, field: string, context: OperationContext): Json {
  const path = `${context.path}/${field}`;
  return requireValue(context.evaluate(expression, path), path);
}
function transform(expression: Extract<OpExpr, { op: "array.map" | "array.filter" | "array.find" }>, context: OperationContext): Eval {
  const source = requireArray(input(expression.source, "source", context), `${context.path}/source`);
  const out: Json[] = [];
  for (let index = 0; index < source.length; index++) {
    context.budget.tick(context.path);
    const path = `${context.path}/lambda/body`;
    const result = requireValue(context.bind(expression.lambda, source[index], index, path), path);
    if (expression.op === "array.map") out.push(result);
    else {
      if (typeof result !== "boolean") fail("type-mismatch", path, "boolean", actualType(result));
      if (result && expression.op === "array.find") return value(source[index]);
      if (result) out.push(source[index]);
    }
  }
  return expression.op === "array.find" ? missing : value(out);
}

/** Single closed table pairs every named operand schema with its typed evaluator. */
export const operations = {
  formatScalar: {
    fields: { source: "expr" },
    evaluate(expression, context) {
      const source = input(expression.source, "source", context);
      if (typeof source !== "string" && typeof source !== "number" && typeof source !== "boolean") fail("type-mismatch", `${context.path}/source`, "string, number or boolean", actualType(source));
      const text = String(source);
      context.budget.text(text.length, context.path);
      return value(text);
    },
  },
  parseJson: {
    fields: { source: "expr" },
    evaluate(expression, context) {
      const source = requireString(input(expression.source, "source", context), `${context.path}/source`);
      context.budget.tick(context.path, source.length);
      context.budget.text(source.length, context.path);
      let parsed: unknown;
      try { parsed = JSON.parse(source); } catch { fail("invalid-json", context.path); }
      return value(snapshot(parsed, context.budget, context.path));
    },
  },
  stringifyJson: {
    fields: { source: "expr" },
    evaluate(expression, context) {
      // Preflight expanded aliases/depth/size before native serialization allocates a string.
      const source = snapshot(input(expression.source, "source", context), context.budget, context.path);
      const text = JSON.stringify(source);
      context.budget.text(text.length, context.path);
      return value(text);
    },
  },
  isMissing: {
    fields: { source: "expr" },
    evaluate(expression, context) {
      const result = context.evaluate(expression.source, `${context.path}/source`);
      return result.kind === "error" ? result : value(result.kind === "missing");
    },
  },
  defaultIfMissing: {
    fields: { source: "expr", fallback: "expr" },
    evaluate(expression, context) {
      const result = context.evaluate(expression.source, `${context.path}/source`);
      return result.kind === "missing" ? context.evaluate(expression.fallback, `${context.path}/fallback`) : result;
    },
  },
  defaultIfNullish: {
    fields: { source: "expr", fallback: "expr" },
    evaluate(expression, context) {
      const result = context.evaluate(expression.source, `${context.path}/source`);
      return result.kind === "missing" || (result.kind === "value" && result.value === null)
        ? context.evaluate(expression.fallback, `${context.path}/fallback`) : result;
    },
  },
  equal: {
    fields: { left: "expr", right: "expr" },
    evaluate(expression, context) {
      return value(equalJson(input(expression.left, "left", context), input(expression.right, "right", context), context.budget, context.path));
    },
  },
  "array.length": {
    fields: { source: "expr" },
    evaluate(expression, context) { return value(requireArray(input(expression.source, "source", context), `${context.path}/source`).length); },
  },
  "array.map": { fields: { source: "expr", lambda: "lambda" }, evaluate: transform },
  "array.filter": { fields: { source: "expr", lambda: "lambda" }, evaluate: transform },
  "array.find": { fields: { source: "expr", lambda: "lambda" }, evaluate: transform },
  "object.get": {
    fields: { source: "expr", path: "path" },
    evaluate(expression, context) { return readPath(input(expression.source, "source", context), expression.path, context.budget, context.path); },
  },
  "object.has": {
    fields: { source: "expr", path: "path" },
    evaluate(expression, context) {
      return value(readPath(input(expression.source, "source", context), expression.path, context.budget, context.path).kind !== "missing");
    },
  },
  "object.set": {
    fields: { source: "expr", path: "path", value: "expr", missingParents: ["create", "error"] },
    evaluate(expression, context) {
      return value(updatePath(input(expression.source, "source", context), expression.path, input(expression.value, "value", context), expression.missingParents === "create", context.budget, context.path));
    },
  },
  "object.remove": {
    fields: { source: "expr", path: "path" },
    evaluate(expression, context) { return value(updatePath(input(expression.source, "source", context), expression.path, undefined, false, context.budget, context.path)); },
  },
} satisfies Registry;

export function evaluateOperation(expression: OpExpr, context: OperationContext): Eval {
  // The validator checks the discriminant. Registry verifies the matching operands/evaluator.
  const definition = operations[expression.op] as { evaluate(expression: OpExpr, context: OperationContext): Eval };
  return definition.evaluate(expression, context);
}
