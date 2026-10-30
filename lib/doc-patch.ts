import type { SiteDoc } from "./types";

/** 設定は項目単位、ページ・要素・画像・コンポーネントはID単位で置き換える。 */
export type DocPatchOp =
  | { path: string[]; value: unknown }
  | { path: string[]; remove: true };
export type DocPatch = DocPatchOp[];
// D1 のバインド数上限内に収める。大規模な置き換えは従来の全体保存を使う。
export const MAX_PATCH_OPS = 32;
const COLLECTIONS = new Set(["pages", "nodes", "assets", "components"]);
const REQUIRED = new Set(["pages", "nodes", "assets", "pageOrder", "siteName"]);
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const safeKey = (key: unknown): key is string => typeof key === "string" &&
  /^[a-zA-Z0-9_-]{1,200}$/.test(key) && !["__proto__", "constructor", "prototype"].includes(key);

export function isDocPatch(value: unknown): value is DocPatch {
  if (!Array.isArray(value) || !value.length || value.length > MAX_PATCH_OPS) return false;
  const paths: string[][] = [];
  for (const op of value) {
    if (!record(op) || !Array.isArray(op.path) || !op.path.every(safeKey)) return false;
    const path = op.path as string[];
    if (path.length !== 1 && !(path.length === 2 && COLLECTIONS.has(path[0]))) return false;
    // 同じ場所や親子を同時に操作させず、SQLとブラウザで適用順が変わらないようにする。
    if (paths.some((other) => other[0] === path[0] &&
      (other.length === 1 || path.length === 1 || other[1] === path[1]))) return false;
    paths.push(path);
    if (op.remove === true) {
      if (Object.hasOwn(op, "value") || (path.length === 1 && REQUIRED.has(path[0]))) return false;
    } else {
      if (Object.hasOwn(op, "remove") || !Object.hasOwn(op, "value") || op.value === undefined) return false;
      if (path.length === 1) {
        if (COLLECTIONS.has(path[0]) && !record(op.value)) return false;
        // ページが1つも無いデータは開けなくなるため、並びを空にする差分は受け付けない
        if (path[0] === "pageOrder" && (!Array.isArray(op.value) || !op.value.length)) return false;
        if (path[0] === "siteName" && typeof op.value !== "string") return false;
      }
    }
  }
  return true;
}

/** null は全体保存へのフォールバック、空配列は変更なし。 */
export function createDocPatch(base: SiteDoc, next: SiteDoc): DocPatch | null {
  const ops: DocPatch = [];
  const diff = (before: Record<string, unknown>, after: Record<string, unknown>, prefix: string[] = []) => {
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (before[key] === after[key]) continue;
      if (ops.length > MAX_PATCH_OPS) return;
      const path = [...prefix, key];
      if (!prefix.length && COLLECTIONS.has(key) && record(before[key]) && record(after[key])) {
        diff(before[key], after[key], path);
      } else if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
        ops.push(after[key] === undefined ? { path, remove: true } : { path, value: after[key] });
      }
    }
  };
  diff(base as unknown as Record<string, unknown>, next as unknown as Record<string, unknown>);
  return !ops.length || isDocPatch(ops) ? ops : null;
}

/** 入力の同期ベース・履歴を変更せず、差分の対象だけコピーする。 */
export function applyDocPatch(base: SiteDoc, patch: DocPatch): SiteDoc {
  if (!isDocPatch(patch)) throw new Error("Invalid document patch");
  const out = { ...base } as unknown as Record<string, unknown>;
  const copied = new Set<string>();
  for (const op of patch) {
    let target = out;
    if (op.path.length === 2) {
      const parent = op.path[0];
      if (!record(out[parent])) throw new Error("Missing patch collection");
      if (!copied.has(parent)) {
        out[parent] = { ...out[parent] };
        copied.add(parent);
      }
      target = out[parent] as Record<string, unknown>;
    }
    const key = op.path[op.path.length - 1];
    if ("remove" in op) delete target[key];
    else target[key] = op.value;
  }
  return out as unknown as SiteDoc;
}

/** 版が一致する場合だけ適用する。通知の欠落・逆順は全体の再取得で解消する。 */
export function applyDocPatchAtRevision(
  doc: SiteDoc | null, rev: string | null, base: string, patch: DocPatch
): SiteDoc | null {
  if (!doc || rev !== base) return null;
  try { return applyDocPatch(doc, patch); } catch { return null; }
}
