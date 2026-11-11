import type { ScriptOp } from "./types";
import { filterFieldOperators, filterFieldSelection } from "./filter-field-options";
import { singleValueReference } from "./variable-choice";
import { lookupVar } from "./vars";
import { parseValueLiteral } from "./value-semantics";

/** A sample informs the editor's choices; unknown runtime variables are not restricted. */
export function ifVariableSample(input: string, samples: Record<string, unknown>): unknown {
  const ref = singleValueReference(input);
  if (ref !== null) return lookupVar(samples, ref);
  const source = input.trim();
  if (source.startsWith("[") || source.startsWith("{")) return parseValueLiteral(source);
  return undefined;
}

export function ifVariableOperators(input: string, samples: Record<string, unknown>): readonly ScriptOp[] | undefined {
  return filterFieldOperators(ifVariableSample(input, samples));
}

/** Changing the condition's left side should select a meaningful operation for lists. */
export function changeIfVariableLeft(
  condition: { left?: string; op?: ScriptOp; value?: string },
  nextLeft: string,
  samples: Record<string, unknown>,
): { left: string; op: ScriptOp; value: string } {
  const previousLeft = condition.left ?? "";
  const choice = filterFieldSelection(
    { field: previousLeft, op: condition.op ?? "eq", value: condition.value ?? "" },
    nextLeft,
    ifVariableSample(previousLeft, samples),
    ifVariableSample(nextLeft, samples),
  );
  return { left: choice.field, op: choice.op, value: choice.value };
}
