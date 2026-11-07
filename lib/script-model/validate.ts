import { operations } from "./ops";
import type { Expr, Json, Limits, OpName, Validation } from "./types";
import { actualType, Budget, capture, fail, own, pointer, snapshot } from "./values";

type RecordValue = { readonly [key: string]: Json };
function record(value: Json, path: string): RecordValue {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail("invalid-expression", path, "object", actualType(value));
  return value as RecordValue;
}
function shape(value: RecordValue, keys: readonly string[], path: string): void {
  if (Object.keys(value).length !== keys.length || keys.some(key => !own(value, key))) fail("invalid-expression", path);
}
function identifier(value: Json, path: string): string {
  if (typeof value !== "string" || value.length === 0) fail("invalid-expression", path, "nonempty ID", actualType(value));
  return value;
}
function checkPath(value: Json, path: string, budget: Budget, allowEmpty = true): void {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) fail("invalid-expression", path, allowEmpty ? "path" : "nonempty path", actualType(value));
  if (value.length > budget.limits.maxDepth) fail("limit-exceeded", path);
  value.forEach((part, index) => {
    budget.tick(path);
    if (typeof part !== "string" && (typeof part !== "number" || !Number.isSafeInteger(part))) fail("invalid-expression", pointer(path, index), "string or safe integer", actualType(part));
  });
}

/** Internal entry shares the evaluator's budget. No document/schema-version inference. */
export function prepareExpression(input: unknown, budget: Budget): Expr {
  const tree = snapshot(input, budget, "");
  const owners = new Set<string>();
  function visit(input: Json, path: string, scopes: ReadonlySet<string>): void {
    budget.tick(path);
    const node = record(input, path);
    switch (node.kind) {
      case "literal":
        shape(node, ["kind", "value"], path);
        return; // snapshot already checked finite, dense, acyclic JSON.
      case "ref": {
        shape(node, ["kind", "root", "path"], path);
        checkPath(node.path, `${path}/path`, budget);
        const root = record(node.root, `${path}/root`);
        if (root.kind === "variable") {
          shape(root, ["kind", "symbolId"], `${path}/root`);
          identifier(root.symbolId, `${path}/root/symbolId`);
        } else if (root.kind === "binding") {
          shape(root, ["kind", "scopeId", "slot"], `${path}/root`);
          const scope = identifier(root.scopeId, `${path}/root/scopeId`);
          if (root.slot !== "item" && root.slot !== "index") fail("invalid-expression", `${path}/root/slot`);
          if (!scopes.has(scope)) fail("unbound-scope", `${path}/root`);
        } else fail("invalid-expression", `${path}/root`);
        return;
      }
      case "template":
        shape(node, ["kind", "parts"], path);
        if (!Array.isArray(node.parts)) fail("invalid-expression", `${path}/parts`, "array", actualType(node.parts));
        node.parts.forEach((part, index) => {
          if (typeof part !== "string") visit(part, `${path}/parts/${index}`, scopes);
        });
        return;
      case "op": {
        if (typeof node.op !== "string" || !own(operations, node.op)) fail("invalid-expression", `${path}/op`);
        const fields = operations[node.op as OpName].fields;
        shape(node, ["kind", "op", ...Object.keys(fields)], path);
        for (const [key, spec] of Object.entries(fields)) {
          const operandPath = pointer(path, key);
          const operand = node[key];
          if (spec === "expr") visit(operand, operandPath, scopes);
          else if (spec === "path") checkPath(operand, operandPath, budget, node.op !== "object.set" && node.op !== "object.remove");
          else if (spec === "lambda") {
            const lambda = record(operand, operandPath);
            shape(lambda, ["scopeId", "body"], operandPath);
            const id = identifier(lambda.scopeId, `${operandPath}/scopeId`);
            if (owners.has(id)) fail("duplicate-scope", `${operandPath}/scopeId`);
            owners.add(id);
            visit(lambda.body, `${operandPath}/body`, new Set([...scopes, id]));
          } else if (!spec.includes(operand as never)) fail("invalid-expression", operandPath);
        }
        return;
      }
      default: fail("invalid-expression", `${path}/kind`);
    }
  }
  visit(tree, "", new Set());
  return tree as Expr;
}

export function validateExpression(input: unknown, limits?: Partial<Limits>): Validation {
  const result = capture(() => prepareExpression(input, new Budget(limits)));
  return result.kind === "error" ? { ok: false, error: result } : { ok: true, expression: result };
}
