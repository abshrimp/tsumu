import type { DocNode, FieldContent } from "./types";
import { hasVars, interpolate } from "./vars";

/** プレビュー専用の入力値。null はセレクトの選択の解除（空文字の選択肢とは別）を表す。 */
export type FieldValues = Record<string, string | null>;

/** 最小値・最大値・刻みを持てる入力欄の type */
export const RANGED_INPUTS = new Set(["number", "range", "date", "time", "datetime-local", "month", "week"]);
/** 文字数の上限を持てる入力欄の type */
export const TEXT_INPUTS = new Set(["text", "email", "password", "tel", "url", "search"]);

/**
 * 入力欄の値の名前（送信するときの name と、{変数} の名前）。
 * ラジオはグループ名、他は ID 属性
 */
export function fieldVarName(n: Pick<DocNode, "attrId" | "field">): string {
  if (n.field?.kind === "radio") return n.field.group?.trim() || "";
  return n.attrId || "";
}

/** 入力欄が提供する {変数} の名前（ラジオはグループ名と、グループのボタン1つの ID） */
export function fieldVarNames(n: Pick<DocNode, "attrId" | "field">): string[] {
  const name = fieldVarName(n);
  const out = name ? [name] : [];
  if (isRadioItem(n) && n.attrId) out.push(n.attrId);
  return out;
}

const fill = (v: string | undefined, vars?: Record<string, unknown>) =>
  v && vars && hasVars(v) ? interpolate(v, vars) : (v ?? "");

/** 真偽として読む（空・off・false・0・no はオフ。公開サイトのランタイムと同じ） */
export function truthy(v: unknown): boolean {
  const t = String(v ?? "").trim().toLowerCase();
  return t !== "" && t !== "off" && t !== "false" && t !== "0" && t !== "no";
}

/** グループ名とは別の ID を持つラジオボタン（{ID} は、そのボタンを選んでいるかの true / false） */
export function isRadioItem(n: Pick<DocNode, "attrId" | "field">): boolean {
  return n.field?.kind === "radio" && !!n.attrId && n.attrId !== (n.field.group?.trim() || "");
}

/**
 * 入力欄の最初の値（{ID} の変数の値。公開サイトのブラウザでの値と同じ形）。
 * チェックボックスは「true」/「false」、ラジオはチェックしていれば表示テキスト、セレクトは初期値か最初の選択肢
 */
export function fieldInitialValue(f: FieldContent, vars?: Record<string, unknown>): string {
  switch (f.kind) {
    case "input": {
      const value = fill(f.defaultValue, vars);
      // サーバーでは文字のまま保ち、ブラウザでは公開サイトと同じ標準の初期値を読む。
      // 数値・日付・色・範囲などの正規化を独自に実装せず、保存した値や操作した後の値は書き換えない。
      if (typeof document === "undefined") return value;
      const input = document.createElement("input");
      input.type = f.inputType ?? "text";
      if (RANGED_INPUTS.has(input.type)) {
        for (const key of ["min", "max", "step"] as const) {
          const bound = fill(f[key], vars);
          if (bound) input.setAttribute(key, bound);
        }
      }
      // value 属性は range の刻みの基準にもなる。範囲を設定した後に、空の初期値も渡す。
      input.defaultValue = value;
      return input.value;
    }
    case "textarea": {
      const value = fill(f.defaultValue, vars);
      if (typeof document === "undefined") return value;
      const input = document.createElement("textarea");
      input.defaultValue = value;
      return input.value;
    }
    case "checkbox":
      return f.checked ? "true" : "false";
    case "radio":
      return f.checked ? fill(f.label, vars) : "";
    case "select": {
      const options = (f.options ?? []).map((option) => fill(option.value, vars));
      const value = fill(f.defaultValue, vars);
      // 初期値が選択肢に無ければ、ブラウザと同じく先頭を選ぶ。変数が空に解決される場合も比べる。
      return f.defaultValue && options.includes(value) ? value : (options[0] ?? "");
    }
    case "file":
    case "submit":
      return "";
    default:
      return fill(f.defaultValue, vars);
  }
}

/** HTML の ID やラジオのグループ名は、Object.prototype のキーと同じ名前のこともある。 */
function setFieldValue(out: Record<string, string>, name: string, value: string) {
  Object.defineProperty(out, name, { value, enumerable: true, writable: true, configurable: true });
}

/** ページの入力欄（ID 付き）の最初の値（同じグループのラジオは、チェックしているボタンの値） */
export function fieldDefaults(fields: DocNode[], vars?: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const n of fields) {
    const name = fieldVarName(n);
    if (n.type !== "field" || !n.field || !name) continue;
    const v = fieldInitialValue(n.field, vars);
    if (n.field.kind === "radio") {
      // HTML のラジオのグループでは、文書の順で最後にチェックされた項目が選ばれる。
      // 後にあるチェックされていない項目で、その最初の選択を消してはいけない。
      if (!Object.hasOwn(out, name) || n.field.checked) setFieldValue(out, name, v);
    } else if (!Object.hasOwn(out, name) || (!out[name] && v)) {
      // 同じ名前の他の部品は、値のあるものを優先する。
      setFieldValue(out, name, v);
    }
  }
  return out;
}

/**
 * 入力欄の状態を表す変数（{ID.checked} など）の説明。「変数を探す」の詳細に表示する。
 * 値は公開サイトのブラウザでは "true" / "false" か、数字の文字になる
 */
export function fieldStateNotes(fields: DocNode[], tr: (s: string) => string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const n of fields) {
    const f = n.field;
    const name = fieldVarName(n);
    if (n.type !== "field" || !f || f.kind === "submit") continue;
    if (isRadioItem(n)) out[`${n.attrId!}.disabled`] = tr("true when disabled");
    if (!name) continue;
    if (f.kind === "radio") out[`${name}.index`] = tr("Number of the chosen button (from 1; empty if none)");
    if (f.kind === "select") out[`${name}.index`] = tr("Number of the chosen option (from 1)");
    if (f.kind === "textarea" || (f.kind === "input" && TEXT_INPUTS.has(f.inputType ?? "text"))) {
      out[`${name}.length`] = tr("Number of characters entered");
    }
    out[`${name}.disabled`] = tr("true when disabled");
  }
  return out;
}

/** 入力欄の状態の変数の値（エディタのプレビュー用。values は入力欄の値） */
export function fieldStateValues(
  fields: DocNode[],
  values: Record<string, unknown>,
  vars?: Record<string, unknown>
): Record<string, string> {
  const out: Record<string, string> = {};
  const text = (name: string) => String(Object.hasOwn(values, name) ? (values[name] ?? "") : "");
  for (const n of fields) {
    const f = n.field;
    const name = fieldVarName(n);
    if (n.type !== "field" || !f || f.kind === "submit") continue;
    const v = name ? text(name) : "";
    if (f.kind === "radio") {
      // グループのボタン1つの {ID} は、そのボタンを選んでいるか
      if (isRadioItem(n)) {
        setFieldValue(out, n.attrId!, String(name ? !!v && v === fill(f.label, vars) : !!f.checked));
        out[`${n.attrId!}.disabled`] = String(!!f.disabled);
      }
      if (!name) continue;
      const group = fields.filter((x) => x.field?.kind === "radio" && fieldVarName(x) === name);
      const at = group.findIndex((x) => fill(x.field!.label, vars) === v);
      out[`${name}.index`] = at < 0 ? "" : String(at + 1);
    }
    if (!name) continue;
    if (f.kind === "select") {
      const at = values[name] === null ? -1 : (f.options ?? []).map((o) => fill(o.value, vars)).indexOf(v);
      setFieldValue(out, name, at < 0 ? "" : v);
      out[`${name}.index`] = String(at + 1);
    }
    out[`${name}.length`] = String(v.length);
    out[`${name}.disabled`] = String(!!f.disabled);
  }
  return out;
}

/**
 * プレビューで、スクリプトが {名前} の入力欄に値を入れたときの、入力欄の値の変化（無ければ null）。
 * 名前は ID 属性か、ラジオのグループ名。グループのボタン1つには、true / false で選択・解除する
 */
export function fieldValuePatch(
  fields: DocNode[],
  name: string,
  v: string,
  values: FieldValues,
  vars?: Record<string, unknown>
): FieldValues | null {
  const item = fields.find((n) => n.type === "field" && isRadioItem(n) && n.attrId === name);
  if (item) {
    const group = fieldVarName(item);
    if (!group) return null;
    const label = fill(item.field!.label, vars);
    if (truthy(v)) return { [group]: label };
    return values[group] === label ? { [group]: "" } : {};
  }
  const hit = fields.find((n) => n.type === "field" && fieldVarName(n) === name);
  if (!hit) return null;
  // 初期値と違い、選択肢に無い値を代入すると選択を外す（HTMLSelectElement.value と同じ）。
  if (hit.field?.kind === "select") {
    return { [name]: (hit.field.options ?? []).some((o) => fill(o.value, vars) === v) ? v : null };
  }
  return { [name]: hit.field?.kind === "checkbox" ? String(truthy(v)) : v };
}
