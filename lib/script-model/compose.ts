/** Recipes are pure transformations. Older set-var steps keep their value string. */
export type NumericOperation = "add" | "subtract" | "multiply" | "divide" | "remainder";
export type CompareOperation = "eq" | "gt" | "gte" | "lt" | "lte" | "contains" | "starts-with" | "ends-with" | "in" | "empty";
export interface ValueCondition {
  readonly field: string;
  readonly operation: CompareOperation;
  readonly operand: string;
  readonly not?: boolean;
  /** Join with the preceding condition: true is AND, false/undefined is OR. */
  readonly and?: boolean;
}
export type SortDirection = "asc" | "desc";
export type ValueOperandType = "text" | "number" | "boolean" | "null" | "variable";

/**
 * Use one editable text field for list-operation values. A whole {variable}
 * reference retains its actual runtime type, and mixed text is interpolated.
 * Numeric, boolean and null literals are inferred rather than selected.
 * JSON-quoted strings disambiguate strings like "123", "true" and "null".
 */
const NUMERIC_LITERAL = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
const inferredLiteral = (text: string) =>
  text === "null" || text === "true" || text === "false" ||
  (NUMERIC_LITERAL.test(text) && Number.isFinite(Number(text)));

export function parseValueOperandInput(input: string): { operand: string; operandType: ValueOperandType } {
  if (input.startsWith('"') && input.endsWith('"')) {
    try {
      const literal: unknown = JSON.parse(input);
      if (typeof literal === "string") return { operand: literal, operandType: "text" };
    } catch { /* Invalid JSON quotes remain literal text. */ }
  }
  if (input === "null") return { operand: "", operandType: "null" };
  if (input === "true" || input === "false") return { operand: input, operandType: "boolean" };
  if (NUMERIC_LITERAL.test(input) && Number.isFinite(Number(input)))
    return { operand: input, operandType: "number" };
  return { operand: input, operandType: "text" };
}

export function formatValueOperandInput(operand: string, operandType: ValueOperandType): string {
  if (operandType === "variable") return `{${operand}}`;
  if (operandType === "null") return "null";
  if (operandType === "text" && (inferredLiteral(operand) || operand.startsWith('"')))
    return JSON.stringify(operand);
  return operand;
}

export type ValueTransform =
  | { readonly kind: "field" | "has"; readonly key: string }
  | { readonly kind: "index"; readonly index: number }
  | { readonly kind: "length" | "format" | "stringify" | "parse" | "not" }
  | { readonly kind: "fallback" | "fallback-nullish"; readonly text: string }
  | { readonly kind: "math"; readonly operation: NumericOperation; readonly operand: number | string; readonly operandType?: "number" | "variable" }
  | { readonly kind: "compare"; readonly operation: CompareOperation; readonly operand: string; readonly not?: boolean; readonly conditions?: readonly ValueCondition[] }
  | { readonly kind: "split" | "join"; readonly separator: string }
  | { readonly kind: "replace"; readonly find: string; readonly replacement: string; readonly regex: boolean }
  | { readonly kind: "find" | "filter"; readonly field: string; readonly operation: CompareOperation; readonly operand: string; readonly not?: boolean; readonly conditions?: readonly ValueCondition[] }
  | { readonly kind: "map-field"; readonly field: string }
  | { readonly kind: "map-set"; readonly field: string; readonly operand: string; readonly operandType: ValueOperandType }
  | { readonly kind: "sort"; readonly field: string; readonly direction: SortDirection }
  | { readonly kind: "append" | "remove"; readonly operand: string; readonly operandType: ValueOperandType }
  | { readonly kind: "remove-at"; readonly index: number };
export type ValueTransformKind = ValueTransform["kind"];

export const VALUE_TRANSFORM_KINDS: readonly ValueTransformKind[] = [
  "field", "index", "length", "has", "format", "stringify", "parse", "fallback", "fallback-nullish",
  "math", "compare", "not", "split", "join", "replace", "find", "filter", "map-field", "map-set", "sort",
  "append", "remove", "remove-at",
];

export function defaultTransform(kind: ValueTransformKind): ValueTransform {
  switch (kind) {
    case "field":
    case "has": return { kind, key: "" };
    case "index":
    case "remove-at": return { kind, index: 0 };
    case "fallback":
    case "fallback-nullish": return { kind, text: "" };
    case "math": return { kind, operation: "add", operand: 1, operandType: "number" };
    case "compare": return { kind, operation: "eq", operand: "" };
    case "split": return { kind, separator: "," };
    case "join": return { kind, separator: "、" };
    case "replace": return { kind, find: "", replacement: "", regex: false };
    case "find":
    case "filter": return { kind, field: "", operation: "eq", operand: "" };
    case "map-field": return { kind, field: "" };
    case "map-set": return { kind, field: "", operand: "", operandType: "text" };
    case "append":
    case "remove": return { kind, operand: "", operandType: "text" };
    case "sort": return { kind, field: "", direction: "asc" };
    default: return { kind };
  }
}

