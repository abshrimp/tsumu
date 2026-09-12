/**
 * 保存するオブジェクトのマップと、差分の保存に使う正規の識別子。
 * 文書内のすべてのパスが、同じ文法に従う。
 */
export const DOCUMENT_ID_RE = /^[a-zA-Z0-9_-]{1,200}$/;

export function isDocumentId(value: unknown): value is string {
  return typeof value === "string" && DOCUMENT_ID_RE.test(value) &&
    !["__proto__", "constructor", "prototype"].includes(value) &&
    !Object.hasOwn(Object.prototype, value);
}
