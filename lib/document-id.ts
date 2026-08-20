/**
 * Canonical identifiers for persisted object maps and incremental document
 * patches. All document paths share the same grammar.
 */
export const DOCUMENT_ID_RE = /^[a-zA-Z0-9_-]{1,200}$/;

export function isDocumentId(value: unknown): value is string {
  return typeof value === "string" && DOCUMENT_ID_RE.test(value) &&
    !["__proto__", "constructor", "prototype"].includes(value) &&
    !Object.hasOwn(Object.prototype, value);
}
