import { evaluateOperation } from "./ops";
import type { Eval, Expr, Json, Limits } from "./types";
import { prepareExpression } from "./validate";
import { actualType, Budget, capture, fail, missing, own, readPath, requireString, requireValue, snapshot, value } from "./values";

type Bindings = ReadonlyMap<string, { readonly item: Json; readonly index: number }>;

/** Pure entry point for synthetic expressions. No IO, callbacks or legacy coercion. */
export function evaluateExpression(input: unknown, variables: unknown = {}, limits?: Partial<Limits>): Eval {
  return capture(() => {
    const budget = new Budget(limits);
    const expression = prepareExpression(input, budget);
    const environment = snapshot(variables, budget, "/variables");
    if (environment === null || typeof environment !== "object" || Array.isArray(environment)) fail("invalid-context", "/variables", "object", actualType(environment));
    const table = environment as Record<string, Json>;

    function evaluate(node: Expr, path: string, bindings: Bindings, depth: number): Eval {
      budget.tick(path);
      budget.depth(depth, path);
      switch (node.kind) {
        case "literal": return value(node.value);
        case "ref": {
          let root: Json;
          if (node.root.kind === "variable") {
            if (!own(table, node.root.symbolId)) return missing;
            root = table[node.root.symbolId];
          } else {
            const binding = bindings.get(node.root.scopeId);
            if (!binding) fail("unbound-scope", `${path}/root`);
            root = binding[node.root.slot];
          }
          return readPath(root, node.path, budget, path);
        }
        case "template": {
          const parts: string[] = [];
          budget.tick(path, node.parts.length);
          node.parts.forEach((part, index) => {
            const childPath = `${path}/parts/${index}`;
            const text = typeof part === "string" ? part : requireString(requireValue(evaluate(part, childPath, bindings, depth + 1), childPath), childPath);
            budget.text(text.length, path);
            parts.push(text);
          });
          return value(parts.join(""));
        }
        case "op": return evaluateOperation(node, {
          budget, path,
          evaluate: (child, childPath) => evaluate(child, childPath, bindings, depth + 1),
          bind: (lambda, item, index, childPath) => evaluate(lambda.body, childPath, new Map([...bindings, [lambda.scopeId, { item, index }]]), depth + 1),
        });
        default: {
          const exhaustive: never = node;
          return exhaustive;
        }
      }
    }
    const result = evaluate(expression, "", new Map(), 0);
    // Expanded aliases are counted here; callers never receive references into their inputs.
    return result.kind === "value" ? value(snapshot(result.value, budget, "")) : result;
  });
}
