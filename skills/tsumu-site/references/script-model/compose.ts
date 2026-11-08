/** Recipes are pure transformations; set-var remains a separate script action. */
export type NumericOperation = "add" | "subtract" | "multiply" | "divide" | "remainder";
export type CompareOperation = "eq" | "gt" | "gte" | "lt" | "lte" | "contains" | "starts-with" | "ends-with" | "in" | "empty";
export interface ValueCondition {
  readonly field: string;
  readonly operation: CompareOperation;
  readonly operand: string;
  readonly not?: boolean;
  /** Join with the preceding condition: true is AND, false/undefined is OR. */
  readonly and?: boolean;
  /** False for an unfinished editor row; absent is treated as enabled for saved data. */
  readonly configured?: boolean;
}
export type SortDirection = "asc" | "desc";
export type ValueOperandType = "text" | "number" | "boolean" | "null" | "variable";

/**
 * Use one editable text field for list-operation values. A whole {variable}
 * reference retains its actual runtime type, and mixed text is interpolated.
 * Numeric, boolean and null literals are inferred rather than selected.
 * JSON-quoted strings disambiguate strings like "123", "true" and "null".
 */

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
  | { readonly kind: "object-entries"; readonly keyField: string; readonly valueField: string }
  | { readonly kind: "map-field"; readonly field: string }
  | { readonly kind: "map-set"; readonly field: string; readonly operand: string; readonly operandType: ValueOperandType }
  | { readonly kind: "sort"; readonly field: string; readonly direction: SortDirection }
  | { readonly kind: "append" | "remove"; readonly operand: string; readonly operandType: ValueOperandType }
  | { readonly kind: "remove-at"; readonly index: number };
export type ValueTransformKind = ValueTransform["kind"];
