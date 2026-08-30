/** 既存の幅IDの表記を保ち、通常のオブジェクトの継承プロパティだけを除外する。 */
export function isBreakpointId(value: unknown): value is string {
  return typeof value === "string" &&
    !["__proto__", "constructor", "prototype"].includes(value) &&
    !Object.hasOwn(Object.prototype, value);
}
