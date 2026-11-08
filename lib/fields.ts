import type { DocNode, FieldContent } from "./types";
import { hasVars, interpolate } from "./vars";

/** プレビュー専用の入力値。null はセレクトの選択解除（空文字の選択肢とは別）。 */
export type FieldValues = Record<string, string | null>;

/** 最小値・最大値・刻みを持てる入力欄の type */
export const RANGED_INPUTS = new Set(["number", "range", "date", "time", "datetime-local", "month", "week"]);
/** 文字数の上限を持てる入力欄の type */
export const TEXT_INPUTS = new Set(["text", "email", "password", "tel", "url", "search"]);

/**
 * 入力欄の値の名前（送信するときの name・{変数} の名前）。
 * ラジオはグループ名、ほかは ID属性
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

/** グループ名と別のIDを持つラジオボタン（{ID} は、そのボタンを選んでいるかの true / false） */
export function isRadioItem(n: Pick<DocNode, "attrId" | "field">): boolean {
  return n.field?.kind === "radio" && !!n.attrId && n.attrId !== (n.field.group?.trim() || "");
}

/**
 * 入力欄の最初の値（{ID} 変数の値。公開サイトのブラウザでの値と同じ形）。
 * チェックボックスは「true」/「false」、ラジオはチェックしていれば表示テキスト、セレクトは初期値か最初の選択肢
 */
export function fieldInitialValue(f: FieldContent, vars?: Record<string, unknown>): string {
  switch (f.kind) {
    case "input": {
      const value = fill(f.defaultValue, vars);
      // サーバーでは文字を保ち、ブラウザでは公開サイトと同じネイティブの初期値を読む。
      // 数値・日付・色・範囲などの正規化を独自実装せず、保存値や操作済みの値は書き換えない。
      if (typeof document === "undefined") return value;
      const input = document.createElement("input");
      input.type = f.inputType ?? "text";
      if (RANGED_INPUTS.has(input.type)) {
        for (const key of ["min", "max", "step"] as const) {
          const bound = fill(f[key], vars);
          if (bound) input.setAttribute(key, bound);
        }
      }
      // value属性はrangeの刻みの基準にもなる。範囲を設定した後、空の初期値も渡す。
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
      const options = (f.options ?? []).map((option) => fill(option, vars));
      const value = fill(f.defaultValue, vars);
      // 初期値が選択肢に無ければブラウザと同じく先頭を選ぶ。変数が空に解決する場合も比較する。
      return f.defaultValue && options.includes(value) ? value : (options[0] ?? "");
    }
    case "file":
    case "submit":
      return "";
    default:
      return fill(f.defaultValue, vars);
  }
}

/** HTML IDs and radio group names may also match Object.prototype keys. */
function setFieldValue(out: Record<string, string>, name: string, value: string) {
  Object.defineProperty(out, name, { value, enumerable: true, writable: true, configurable: true });
}

/** ページの入力欄（ID付き）の最初の値（同じグループのラジオは、チェックしているボタンの値） */
export function fieldDefaults(fields: DocNode[], vars?: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const n of fields) {
    const name = fieldVarName(n);
    if (n.type !== "field" || !n.field || !name) continue;
    const v = fieldInitialValue(n.field, vars);
    if (n.field.kind === "radio") {
      // HTML radio groups select the last checked item in document order.
      // A later unchecked item must not clear that initial selection.
      if (!Object.hasOwn(out, name) || n.field.checked) setFieldValue(out, name, v);
    } else if (!Object.hasOwn(out, name) || (!out[name] && v)) {
      // 同じ名前のほかの部品は、値のあるものを優先する。
      setFieldValue(out, name, v);
    }
  }
  return out;
}

/**
 * 入力欄の状態を表す変数（{ID.checked} など）の説明。「変数を探す」の詳細に出す。
 * 値は公開サイトのブラウザでは "true" / "false"・数字の文字になる
 */
export function fieldStateNotes(fields: DocNode[], tr: (s: string) => string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const n of fields) {
    const f = n.field;
    const name = fieldVarName(n);
    if (n.type !== "field" || !f || f.kind === "submit") continue;
    if (isRadioItem(n)) out[`${n.attrId!}.disabled`] = tr("操作できない（無効）とき true");
    if (!name) continue;
    if (f.kind === "radio") out[`${name}.index`] = tr("選んだボタンの番号（1から。選んでいなければ空）");
    if (f.kind === "select") out[`${name}.index`] = tr("選んだ選択肢の番号（1から）");
    if (f.kind === "textarea" || (f.kind === "input" && TEXT_INPUTS.has(f.inputType ?? "text"))) {
      out[`${name}.length`] = tr("入力した文字数");
    }
    out[`${name}.disabled`] = tr("操作できない（無効）とき true");
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
      const at = values[name] === null ? -1 : (f.options ?? []).map((o) => fill(o, vars)).indexOf(v);
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
 * 名前は ID属性 かラジオのグループ名。グループのボタン1つには true / false で選ぶ・外す
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
  // 初期値と違い、選択肢にない値の代入は選択を外す（HTMLSelectElement.value と同じ）。
  if (hit.field?.kind === "select") {
    return { [name]: (hit.field.options ?? []).some((o) => fill(o, vars) === v) ? v : null };
  }
  return { [name]: hit.field?.kind === "checkbox" ? String(truthy(v)) : v };
}
