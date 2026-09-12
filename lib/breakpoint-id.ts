/** 既存の幅の ID の表記をそのまま保ち、通常のオブジェクトが継承するプロパティ名だけを除く。 */
export function isBreakpointId(value: unknown): value is string {
  return typeof value === "string" &&
    !["__proto__", "constructor", "prototype"].includes(value) &&
    !Object.hasOwn(Object.prototype, value);
}
