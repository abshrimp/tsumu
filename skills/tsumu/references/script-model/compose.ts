/** English declaration snapshot of the canonical value-recipe model.
 * Kept in sync with lib/script-model/compose.ts.
 */
export type NumericOperation = "add" | "subtract" | "multiply" | "divide" | "remainder";
export type SortDirection = "asc" | "desc";

export type ValueTransform =
  | { readonly kind: "field"; readonly key: string }
  | { readonly kind: "length" | "stringify" | "parse" }
  | { readonly kind: "fallback"; readonly text: string; readonly when: "missing" | "nullish" }
  | { readonly kind: "math"; readonly operation: NumericOperation; readonly operand: number | string; readonly operandType: "number" | "variable" }
  | { readonly kind: "split" | "join"; readonly separator: string }
  | { readonly kind: "replace"; readonly find: string; readonly replacement: string; readonly regex: boolean }
  | { readonly kind: "sort"; readonly field: string; readonly direction: SortDirection };

export type ValueTransformKind = ValueTransform["kind"];
