/** スクリプトの「値を加工する」ブロックで使う、純粋なデータの加工。 */
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

export const VALUE_TRANSFORM_KINDS: readonly ValueTransformKind[] = [
  "field", "fallback", "math", "split", "replace", "join",
  "length", "sort", "stringify", "parse",
];

export function defaultTransform(kind: ValueTransformKind): ValueTransform {
  switch (kind) {
    case "field": return { kind, key: "" };
    case "fallback": return { kind, text: "", when: "missing" };
    case "math": return { kind, operation: "add", operand: 1, operandType: "number" };
    case "split": return { kind, separator: "," };
    case "join": return { kind, separator: "、" };
    case "replace": return { kind, find: "", replacement: "", regex: false };
    case "sort": return { kind, field: "", direction: "asc" };
    default: return { kind };
  }
}
