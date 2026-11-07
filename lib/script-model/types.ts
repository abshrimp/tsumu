/** Experimental, JSON-only expression vocabulary. Not a SiteDoc version or reader. */
export type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };
export type Path = readonly (string | number)[];
export type RefRoot =
  | { readonly kind: "variable"; readonly symbolId: string }
  | { readonly kind: "binding"; readonly scopeId: string; readonly slot: "item" | "index" };
export type Lambda = { readonly scopeId: string; readonly body: Expr };

/** Named operands, never positional any[] or arbitrary operation names. */
export interface OperationFields {
  formatScalar: { source: Expr };
  parseJson: { source: Expr };
  stringifyJson: { source: Expr };
  isMissing: { source: Expr };
  defaultIfMissing: { source: Expr; fallback: Expr };
  defaultIfNullish: { source: Expr; fallback: Expr };
  equal: { left: Expr; right: Expr };
  "array.length": { source: Expr };
  "array.map": { source: Expr; lambda: Lambda };
  "array.filter": { source: Expr; lambda: Lambda };
  "array.find": { source: Expr; lambda: Lambda };
  "object.get": { source: Expr; path: Path };
  "object.has": { source: Expr; path: Path };
  "object.set": { source: Expr; path: Path; value: Expr; missingParents: "create" | "error" };
  "object.remove": { source: Expr; path: Path };
}
export type OpName = keyof OperationFields;
export type OpExpr = { [K in OpName]: { readonly kind: "op"; readonly op: K } & Readonly<OperationFields[K]> }[OpName];
export type Expr =
  | { readonly kind: "literal"; readonly value: Json }
  | { readonly kind: "ref"; readonly root: RefRoot; readonly path: Path }
  | { readonly kind: "template"; readonly parts: readonly (string | Expr)[] }
  | OpExpr;

export type ErrorCode =
  | "invalid-expression" | "invalid-json-value" | "invalid-context" | "invalid-limits"
  | "unbound-scope" | "duplicate-scope" | "type-mismatch" | "missing-value"
  | "invalid-json" | "invalid-path" | "missing-parent" | "limit-exceeded";
export type EvalError = { readonly kind: "error"; readonly code: ErrorCode; readonly exprPath: string; readonly expected?: string; readonly actual?: string };
export type Eval = { readonly kind: "value"; readonly value: Json } | { readonly kind: "missing" } | EvalError;
export type Validation = { readonly ok: true; readonly expression: Expr } | { readonly ok: false; readonly error: EvalError };

/** Overrides may lower these hard limits, never disable or raise them. */
export interface Limits {
  maxDepth: number;
  maxSteps: number;
  maxNodes: number;
  maxTextUnits: number;
}
