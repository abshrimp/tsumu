import type { ScriptStep } from "./types";

/**
 * A visual choice between existing value-producing steps.
 *
 * These are not new stored operations: the editor still writes the original
 * ScriptStep kinds, which the preview, server and exported client understand.
 */
export const VALUE_OPERATION_KINDS = [
  "set-var", "count", "join", "split", "array-find", "calc", "replace",
] as const;

export type ValueOperationKind = (typeof VALUE_OPERATION_KINDS)[number];
export type ValueOperationStep = Extract<ScriptStep, { kind: ValueOperationKind }>;

export function isValueOperation(step: ScriptStep): step is ValueOperationStep {
  return (VALUE_OPERATION_KINDS as readonly string[]).includes(step.kind);
}

/**
 * Changing the visual operation is an explicit user edit. Keep the block ID
 * and its output variable (so downstream references remain valid). Carry
 * inputs only when the two operations use a compatible source; do not copy
 * stale/unknown fields into a different discriminated ScriptStep kind.
 *
 * The editor's Undo/Redo handles a change like any other block edit.
 */
export function switchValueOperation(step: ScriptStep, next: ValueOperationKind): ScriptStep {
  if (!isValueOperation(step) || step.kind === next) return step;

  const { id, into } = step;
  const ref = step.kind === "set-var" ? /^\{([^{}]+)\}$/.exec(step.value.trim())?.[1]?.trim() ?? "" : "";
  const array = "array" in step ? step.array : ref;
  const source = "source" in step ? step.source : step.kind === "set-var" ? step.value : "";
  const sep = step.kind === "join" || step.kind === "split" ? step.sep : undefined;

  switch (next) {
    case "set-var":
      return { id, into, kind: "set-var", value: source || (array ? `{${array}}` : "") };
    case "count":
      return { id, into, kind: "count", array };
    case "join":
      return {
        id, into, kind: "join", array, sep: sep ?? "、",
        ...((step.kind === "array-find" || step.kind === "join") && step.field
          ? { field: step.field } : {}),
      };
    case "split":
      return { id, into, kind: "split", source, sep: sep ?? "," };
    case "array-find":
      return {
        id, into, kind: "array-find", array,
        field: step.kind === "join" ? step.field ?? "" : "", value: "",
      };
    case "calc":
      return { id, into, kind: "calc", expr: "" };
    case "replace":
      return { id, into, kind: "replace", source, find: "", to: "" };
  }
}
