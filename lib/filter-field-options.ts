import type { ScriptOp } from "./types";

/** A fetch preview is a hint for the editor, not a schema for runtime values. */
export type FilterFieldKind = "record" | "array" | "scalar" | "unknown";

export function filterFieldKind(sample: unknown): FilterFieldKind {
  if (sample === undefined) return "unknown";
  if (Array.isArray(sample)) return "array";
  if (sample !== null && typeof sample === "object") return "record";
  return "scalar";
}

/** Only relevant comparisons for structured values. Unknown and scalar values keep all operators. */
export function filterFieldOperators(sample: unknown): readonly ScriptOp[] | undefined {
  switch (filterFieldKind(sample)) {
    case "record": return ["has-key", "empty", "eq"];
    case "array": return ["contains", "empty", "eq"];
    default: return undefined;
  }
}

/** Choosing a different JSON kind changes the default predicate without modifying its runtime meaning. */
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
