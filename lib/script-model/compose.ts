import type { Expr, Json } from "./types";

/** Recipes are pure transformations. Older set-var steps keep their value string. */
export type NumericOperation = "add" | "subtract" | "multiply" | "divide" | "remainder";
export type CompareOperation = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "contains" | "starts-with" | "ends-with";
export type SortDirection = "asc" | "desc";
export type ValueOperandType = "text" | "number" | "boolean" | "null";
export type ValueTransform =
  | { readonly kind: "field" | "has"; readonly key: string }
  | { readonly kind: "index"; readonly index: number }
  | { readonly kind: "length" | "format" | "stringify" | "parse" | "not" }
  | { readonly kind: "fallback" | "fallback-nullish"; readonly text: string }
  | { readonly kind: "math"; readonly operation: NumericOperation; readonly operand: number }
  | { readonly kind: "compare"; readonly operation: CompareOperation; readonly operand: string; readonly operandType: ValueOperandType }
  | { readonly kind: "split" | "join"; readonly separator: string }
  | { readonly kind: "replace"; readonly find: string; readonly replacement: string; readonly regex: boolean }
  | { readonly kind: "find" | "filter"; readonly field: string; readonly operation: CompareOperation; readonly operand: string; readonly operandType: ValueOperandType }
  | { readonly kind: "map-field"; readonly field: string }
  | { readonly kind: "map-set"; readonly field: string; readonly operand: string; readonly operandType: ValueOperandType }
  | { readonly kind: "sort"; readonly field: string; readonly direction: SortDirection };
export interface ValueRecipe {
  readonly source: string;
  readonly steps: readonly ValueTransform[];
}

export type ValueTransformKind = ValueTransform["kind"];

export const VALUE_TRANSFORM_KINDS: readonly ValueTransformKind[] = [
  "field", "index", "length", "has", "format", "stringify", "parse", "fallback", "fallback-nullish",
  "math", "compare", "not", "split", "join", "replace", "find", "filter", "map-field", "map-set", "sort",
];

export function defaultTransform(kind: ValueTransformKind): ValueTransform {
  switch (kind) {
    case "field":
    case "has": return { kind, key: "" };
    case "index": return { kind, index: 0 };
    case "fallback":
    case "fallback-nullish": return { kind, text: "" };
    case "math": return { kind, operation: "add", operand: 1 };
    case "compare": return { kind, operation: "eq", operand: "", operandType: "text" };
    case "split": return { kind, separator: "," };
    case "join": return { kind, separator: "、" };
    case "replace": return { kind, find: "", replacement: "", regex: false };
    case "find":
    case "filter": return { kind, field: "", operation: "eq", operand: "", operandType: "text" };
    case "map-field": return { kind, field: "" };
    case "map-set": return { kind, field: "", operand: "", operandType: "text" };
    case "sort": return { kind, field: "", direction: "asc" };
    default: return { kind };
  }
}

/**
 * Wrap a source with each operation in order.
 * An object key such as "meta.name" is a *single* segment, never a dotted path.
 * Inputs are not mutated. No conversion to a legacy ScriptStep is implied.
 */
export function composeValueExpression(source: string, transforms: readonly ValueTransform[]): Expr {
  let expression: Expr = {
    kind: "ref",
    root: { kind: "variable", symbolId: source },
    path: [],
  };

  for (const transform of transforms) {
    switch (transform.kind) {
      case "field":
        expression = { kind: "op", op: "object.get", source: expression, path: [transform.key] };
        break;
      case "has":
        expression = { kind: "op", op: "object.has", source: expression, path: [transform.key] };
        break;
      case "index":
        expression = { kind: "op", op: "object.get", source: expression, path: [transform.index] };
        break;
      case "length":
        expression = { kind: "op", op: "array.length", source: expression };
        break;
      case "format":
        expression = { kind: "op", op: "formatScalar", source: expression };
        break;
      case "stringify":
        expression = { kind: "op", op: "stringifyJson", source: expression };
        break;
      case "parse":
        expression = { kind: "op", op: "parseJson", source: expression };
        break;
      case "fallback":
      case "fallback-nullish": {
        const fallback: Expr = { kind: "literal", value: transform.text as Json };
        expression = { kind: "op", op: transform.kind === "fallback" ? "defaultIfMissing" : "defaultIfNullish", source: expression, fallback };
        break;
      }
      default:
        throw new Error("This transformation uses the unified value-recipe evaluator instead of the experimental expression AST");
    }
  }
  return expression;
}
