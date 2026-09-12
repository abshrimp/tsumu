import { appendAssetSuffix } from "./zip-references";

/** アセットの識別子は変えずに、クエリとフラグメントだけを残す。 */
export function validAssetSuffix(value: unknown): value is string {
  return typeof value === "string" && (value === "" || /^[?#][^\u0000-\u001f\u007f]*$/.test(value));
}

/** 埋め込んだデータにはクエリを足さず、SVG のビューや再生の区間は残す。 */
export function assetMediaUrl(base: string, suffix: unknown): string {
  return base && validAssetSuffix(suffix) ? appendAssetSuffix(base, suffix) : base;
}
