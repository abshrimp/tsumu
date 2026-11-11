import type { SiteDoc } from "./types";

/**
 * 編集前後の文書を、ページ・要素・アセット・コンポーネントは1件ずつ、それ以外は項目ごとに比べる。
 * 内容の比較は保存される形（JSON）で行う。同じ参照どうしは直列化せずに読み飛ばすため、
 * 参照を共有している文書どうし（履歴・同期の基準）の比較は、変わった件数に比例した時間で終わる
 */

const COLLECTIONS = new Set(["pages", "nodes", "assets", "components"]);

type Rec = Record<string, unknown>;

const isRecord = (value: unknown): value is Rec =>
  !!value && typeof value === "object" && !Array.isArray(value);

/**
 * 直列化せずに「確実に同じ JSON になる」と言えるか。配列と素のオブジェクトを、キーの並びも含めて
 * 順にたどる。false は「違う」ではなく「この方法では分からない」を表し、呼び出し側が直列化して確かめる
 *（NaN と null、undefined の項目の有無のように、値は違っても同じ JSON になる組があるため）
 */
function surelySameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!surelySameJson(a[i], b[i])) return false;
    return true;
  }
  if (Array.isArray(b)) return false;
  const proto = Object.getPrototypeOf(a);
  if ((proto !== Object.prototype && proto !== null) || Object.getPrototypeOf(b) !== proto) return false;
  const keys = Object.keys(a);
  const others = Object.keys(b);
  if (keys.length !== others.length) return false;
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (key !== others[i] || !surelySameJson((a as Rec)[key], (b as Rec)[key])) return false;
  }
  return true;
}

/** JSON に出る値どうしが同じ内容か（undefined は JSON に出ないため、どちらも undefined のときだけ同じ） */
export function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  // 変わっていない要素が大半なので、まず直列化せずに確かめる
  try {
    if (surelySameJson(a, b)) return true;
  } catch {
    // 入れ子が深すぎてたどれない値は、直列化の結果に従う
  }
  return JSON.stringify(a) === JSON.stringify(b);
}

/** JSON に出るキー（値が undefined のキーは出ない）の並び */
const visibleKeys = (record: Rec): string[] => Object.keys(record).filter((key) => record[key] !== undefined);

function sameKeyOrder(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * before と同じ内容の項目を before の参照に差し替えた record を返す。
 * すべて同じ（キーの並びも同じ）なら before そのものを返す。after は書き換えない
 */
function shareRecord(before: Rec, after: Rec, deep: (key: string) => boolean): Rec {
  if (before === after) return before;
  const keys = visibleKeys(after);
  let unchanged = sameKeyOrder(visibleKeys(before), keys);
  let shared = false;
  const out: Rec = {};
  for (const key of Object.keys(after)) {
    const next = after[key];
    let value = next;
    if (next !== undefined && Object.hasOwn(before, key)) {
      const prev = before[key];
      if (prev === next) {
        shared = true;
      } else if (deep(key) && isRecord(prev) && isRecord(next)) {
        value = shareRecord(prev, next, () => false);
        if (value === prev) shared = true;
        else unchanged = false;
      } else if (sameJson(prev, next)) {
        value = prev;
        shared = true;
      } else {
        unchanged = false;
      }
    }
    // __proto__ というキーでも、プロトタイプを書き換えずに自身の項目として持つ
    if (key === "__proto__") Object.defineProperty(out, key, { value, enumerable: true, writable: true, configurable: true });
    else out[key] = value;
  }
  if (unchanged) return before;
  return shared ? out : after;
}

/**
 * 編集後の文書のうち、編集前と内容が同じページ・要素・アセット・コンポーネント・設定を、
 * 編集前の参照に差し替えて返す。保存される内容がまったく同じなら before そのものを返す。
 *
 * 文書全体を複製してから書き換える編集（updateDoc）でも、変わっていない要素は同じ参照のまま残る。
 * これにより、元に戻す履歴（最大100件）が変わった部分だけを持ち、差分保存と同時編集のマージが
 * 変わっていない要素を直列化し直さずに済む
 */
export function shareUnchangedDoc(before: SiteDoc, after: SiteDoc): SiteDoc {
  if (!isRecord(before) || !isRecord(after)) return after;
  return shareRecord(
    before as unknown as Rec,
    after as unknown as Rec,
    (key) => COLLECTIONS.has(key)
  ) as unknown as SiteDoc;
}

/** 保存される内容が同じ文書か（JSON.stringify どうしの比較と同じ結果を、違いが見つかった時点で返す） */
export function sameDocContent(a: SiteDoc, b: SiteDoc): boolean {
  if (!isRecord(a) || !isRecord(b)) return sameJson(a, b);
  return sameRecord(a as unknown as Rec, b as unknown as Rec, (key) => COLLECTIONS.has(key));
}

function sameRecord(a: Rec, b: Rec, deep: (key: string) => boolean): boolean {
  if (a === b) return true;
  const keys = visibleKeys(a);
  if (!sameKeyOrder(keys, visibleKeys(b))) return false;
  for (const key of keys) {
    const x = a[key];
    const y = b[key];
    if (x === y) continue;
    if (deep(key) && isRecord(x) && isRecord(y)) {
      if (!sameRecord(x, y, () => false)) return false;
    } else if (!sameJson(x, y)) {
      return false;
    }
  }
  return true;
}
