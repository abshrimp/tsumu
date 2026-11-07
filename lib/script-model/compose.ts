import type { Expr, Json } from "./types";

/** A small, reversible UI recipe. Only the preview uses it; SiteDoc stays unchanged. */
export type ValueTransform =
  | { readonly kind: "field"; readonly key: string }
  | { readonly kind: "index"; readonly index: number }
  | { readonly kind: "length" }
  | { readonly kind: "format" }
  | { readonly kind: "stringify" }
  | { readonly kind: "parse" }
  | { readonly kind: "fallback"; readonly text: string };

export type ValueTransformKind = ValueTransform["kind"];

export const VALUE_TRANSFORM_KINDS: readonly ValueTransformKind[] = [
  "field", "index", "length", "format", "stringify", "parse", "fallback",
];

export function defaultTransform(kind: ValueTransformKind): ValueTransform {
  switch (kind) {
    case "field": return { kind, key: "" };
    case "index": return { kind, index: 0 };
    case "fallback": return { kind, text: "" };
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
      case "fallback": {
        const fallback: Expr = { kind: "literal", value: transform.text as Json };
        expression = { kind: "op", op: "defaultIfMissing", source: expression, fallback };
        break;
      }
    }
  }
  return expression;
}
