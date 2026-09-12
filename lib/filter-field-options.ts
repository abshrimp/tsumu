import type { ScriptOp } from "./types";

/** 取得したデータのプレビューは、エディタのための手がかりであって、実行時の値の型を決めるものではない。 */
export type FilterFieldKind = "record" | "array" | "scalar" | "unknown";

export function filterFieldKind(sample: unknown): FilterFieldKind {
  if (sample === undefined) return "unknown";
  if (Array.isArray(sample)) return "array";
  if (sample !== null && typeof sample === "object") return "record";
  return "scalar";
}

/** 構造を持つ値には、意味のある比較だけを示す。不明な値と単一の値では、すべての比較を残す。 */
export function filterFieldOperators(sample: unknown): readonly ScriptOp[] | undefined {
  switch (filterFieldKind(sample)) {
    case "record": return ["has-key", "empty", "eq"];
    case "array": return ["contains", "contains-any", "empty", "eq"];
    default: return undefined;
  }
}

/** 別の JSON の種類を選ぶと既定の比較は変わるが、実行時の意味は変えない。 */
export function filterFieldSelection(
  previous: { field: string; op: ScriptOp; value: string },
  field: string,
  previousSample: unknown,
  nextSample: unknown,
): { field: string; op: ScriptOp; value: string } {
  if (field === previous.field) return { ...previous, field };
  const oldKind = filterFieldKind(previousSample);
  const nextKind = filterFieldKind(nextSample);
  if (oldKind === nextKind || nextKind === "unknown") return { ...previous, field };
  if (nextKind === "record") return { field, op: "has-key", value: "" };
  if (nextKind === "array") {
    return { field, op: "contains", value: oldKind === "scalar" ? previous.value : "" };
  }
  return { field, op: "eq", value: oldKind === "unknown" ? previous.value : "" };
}
