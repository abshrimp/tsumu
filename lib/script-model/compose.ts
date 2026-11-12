/** スクリプトの「値を加工する」ブロックで使う、純粋なデータの加工。 */
export type NumericOperation = "add" | "subtract" | "multiply" | "divide" | "remainder";
export type SortDirection = "asc" | "desc";
export type ValueOperandType = "text" | "number" | "boolean" | "null" | "variable";

/**
 * 1つの編集できる値の欄で、型のあるリテラルと変数の参照の両方を扱う。
 * 引用符で囲めば、数値に見える文字列も文字列のまま。実際の値は、実行時も型を保つ。
 */
const NUMERIC_LITERAL = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
const inferredLiteral = (text: string) =>
  text === "null" || text === "true" || text === "false" ||
  (NUMERIC_LITERAL.test(text) && Number.isFinite(Number(text)));

export function parseValueOperandInput(input: string): { operand: string; operandType: ValueOperandType } {
  if (input.startsWith('"') && input.endsWith('"')) {
    try {
      const literal: unknown = JSON.parse(input);
      if (typeof literal === "string")
        return { operand: Array.from(literal, (char) => char === "{" ? "\\{" : char).join(""), operandType: "text" };
    } catch { /* Treat invalid quoted JSON as ordinary text. */ }
  }
  if (input === "null") return { operand: "", operandType: "null" };
  if (input === "true" || input === "false") return { operand: input, operandType: "boolean" };
  if (NUMERIC_LITERAL.test(input) && Number.isFinite(Number(input)))
    return { operand: input, operandType: "number" };
  return { operand: input, operandType: "text" };
}

export function formatValueOperandInput(operand: string, operandType: ValueOperandType): string {
  if (operandType === "variable") return "{" + operand + "}";
  if (operandType === "null") return "null";
  if (operandType === "text" && (inferredLiteral(operand) || operand.startsWith('"')))
    return JSON.stringify(operand);
  return operand;
}

export type ValueTransform =
  | { readonly kind: "field"; readonly key: string }
  | { readonly kind: "length" | "stringify" | "parse" }
  | { readonly kind: "fallback"; readonly text: string; readonly when?: "missing" | "nullish" }
  | { readonly kind: "math"; readonly operation: NumericOperation; readonly operand: number | string; readonly operandType: "number" | "variable" }
  | { readonly kind: "split" | "join"; readonly separator: string }
  | { readonly kind: "replace"; readonly find: string; readonly replacement: string; readonly regex: boolean }
  | { readonly kind: "sort"; readonly field: string; readonly direction: SortDirection }
  | { readonly kind: "append"; readonly operand: string; readonly operandType: ValueOperandType };
export type ValueTransformKind = ValueTransform["kind"];

export const VALUE_TRANSFORM_KINDS: readonly ValueTransformKind[] = [
  "field", "fallback", "math", "split", "replace", "join",
  "length", "sort", "append", "stringify", "parse",
];

export function defaultTransform(kind: ValueTransformKind): ValueTransform {
  switch (kind) {
    case "field": return { kind, key: "" };
    case "fallback": return { kind, text: "", when: "missing" };
    case "math": return { kind, operation: "add", operand: 1, operandType: "number" };
    case "split": return { kind, separator: "," };
    case "join": return { kind, separator: "、" };
    case "replace": return { kind, find: "", replacement: "", regex: false };
    case "append": return { kind, operand: "", operandType: "text" };
    case "sort": return { kind, field: "", direction: "asc" };
    default: return { kind };
  }
}
