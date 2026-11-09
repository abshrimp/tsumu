import { appendAssetSuffix } from "./zip-references";

/** アセットの識別子を変えず、クエリとフラグメントだけを保持する。 */
export function validAssetSuffix(value: unknown): value is string {
  return typeof value === "string" && (value === "" || /^[?#][^\u0000-\u001f\u007f]*$/.test(value));
}

/** 埋め込みデータにはクエリを足さず、SVGのビューや再生区間は保持する。 */
export function assetMediaUrl(base: string, suffix: unknown): string {
  return base && validAssetSuffix(suffix) ? appendAssetSuffix(base, suffix) : base;
}
