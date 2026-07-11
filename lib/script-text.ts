/**
 * スクリプトの動作・条件を、画面に出す説明文にする
 */

import {
  SELF_TARGET,
  type ScriptCond,
  type ScriptOp,
  type ScriptStep,
  type SiteDoc,
} from "./types";
import { fieldLabel } from "./data";
import { tr } from "./i18n";

/* ---------- 表示用の文 ---------- */

function targetText(t: string): string {
  return t === SELF_TARGET ? tr("この要素") : t ? `#${t}` : tr("（未選択）");
}

/** 「〜が「値」と同じ」などの比較の文 */
function opText(subject: string, op: ScriptOp | undefined, value: string): string {
  const v = tr("「{value}」", { value });
  switch (op) {
    case "neq":
      return tr("{subject}が {v} と違う", { subject, v });
    case "contains":
      return tr("{subject}が {v} を含む", { subject, v });
    case "not-contains":
      return tr("{subject}が {v} を含まない", { subject, v });
    case "starts-with":
      return tr("{subject}が {v} で始まる", { subject, v });
    case "ends-with":
      return tr("{subject}が {v} で終わる", { subject, v });
    case "gt":
      return tr("{subject}が {v} より大きい", { subject, v });
    case "lt":
      return tr("{subject}が {v} より小さい", { subject, v });
    case "empty":
      return tr("{subject}が空", { subject });
    case "not-empty":
      return tr("{subject}が空でない", { subject });
    default:
      return tr("{subject}が {v} と同じ", { subject, v });
  }
}

export function condText(c: ScriptCond): string {
  const t = targetText(c.target);
  switch (c.subject) {
    case "var":
      return opText(tr("「{value}」", { value: c.left ?? "" }), c.op, c.value ?? "");
    case "value":
      return opText(tr("{t} の値", { t }), c.op, c.value ?? "");
    case "checked":
      return c.not ? tr("{t} がチェックされていない", { t }) : tr("{t} がチェックされている", { t });
    case "visible":
      return c.not ? tr("{t} が隠れている", { t }) : tr("{t} が表示されている", { t });
    case "hovered":
      return c.not ? tr("{t} にホバーしていない", { t }) : tr("{t} にホバーしている", { t });
  }
}

export function stepText(st: ScriptStep, doc: SiteDoc): string {
  switch (st.kind) {
    case "show":
      return tr("{p1} を表示する", { p1: targetText(st.target) });
    case "hide":
      return tr("{p1} を隠す", { p1: targetText(st.target) });
    case "toggle":
      return tr("{p1} の表示を切り替える", { p1: targetText(st.target) });
    case "open-page":
      return tr("ページ「{p1}」を開く", { p1: doc.pages[st.pageId]?.name ?? tr("未選択") });
    case "open-url":
      return tr("{p1} を開く", { p1: st.url || tr("URL未入力") });
    case "scroll-to":
      return tr("{p1} までスクロールする", { p1: targetText(st.target) });
    case "set-value":
      return tr("{p1} に「{value}」を入れる", { p1: targetText(st.target), value: st.value });
    case "set-enabled":
      return st.op === "disable"
        ? tr("{p1} を無効にする", { p1: targetText(st.target) })
        : st.op === "toggle"
          ? tr("{p1} の有効・無効を切り替える", { p1: targetText(st.target) })
          : tr("{p1} を有効にする", { p1: targetText(st.target) });
    case "filter-array": {
      const conds = [{ field: st.field, op: st.op, value: st.value }, ...(st.or ?? [])]
        .map((c, i) =>
          `${i ? ("and" in c && c.and ? tr(" かつ ") : tr(" または ")) : ""}${opText(c.field || tr("（項目未選択）"), c.op, c.value)}`
        )
        .join("");
      const head = `${st.no !== undefined ? tr("絞り込み{no}: ", { no: st.no }) : ""}${st.join === "or" ? tr("（ほかの絞り込みと「または」）") : ""}`;
      return tr("{head}配列{p2}を {conds} ものに絞り込む", { head, p2: arrayText(st.array), conds });
    }
    case "unfilter-array":
      return st.no !== undefined
        ? tr("配列{p1}の絞り込み{no}を解除する", { p1: arrayText(st.array), no: st.no })
        : tr("配列{p1}のすべての絞り込みを解除する", { p1: arrayText(st.array) });
    case "sort-array":
      return st.dir === "desc"
        ? tr("配列{array}を {field} の大きい順に並べ替える", { array: arrayText(st.array), field: st.field || tr("（項目未選択）") })
        : tr("配列{array}を {field} の小さい順に並べ替える", { array: arrayText(st.array), field: st.field || tr("（項目未選択）") });
    case "store-save":
      return st.shared
        ? tr("共有ストレージの「{key}」に「{value}」を保存する", { key: st.key || tr("キー未入力"), value: st.value })
        : tr("ストレージの「{key}」に「{value}」を保存する", { key: st.key || tr("キー未入力"), value: st.value });
    case "store-load":
      return st.shared
        ? tr("共有ストレージの「{key}」を読み込んで変数 {{into}} とする", { key: st.key || tr("キー未入力"), into: st.into || "?" })
        : tr("ストレージの「{key}」を読み込んで変数 {{into}} とする", { key: st.key || tr("キー未入力"), into: st.into || "?" });
    case "split":
      return tr("「{source}」を「{p2}」で分解して配列{p3}とする", { source: st.source, p2: st.sep || ",", p3: arrayText(st.into) });
    case "array-find":
      return tr("配列{p1}の要素のうち、{p2} が「{value}」のものを変数 {{p4}} とする", { p1: arrayText(st.array), p2: st.field ? fieldLabel(st.field) : tr("（項目未選択）"), value: st.value, p4: st.into || "?" });
    case "array-field":
      return tr("配列{p1}の「{value}」を項目 {p3} として格納する", { p1: arrayText(st.array), value: st.value, p3: st.field || tr("（項目名未入力）") });
    case "count":
      return tr("配列{p1}の件数を変数 {{p2}} とする", { p1: arrayText(st.array), p2: st.into || "?" });
    case "copy":
      return tr("「{value}」をコピーする", { value: st.value });
    case "set-var":
      return tr("「{value}」を変数 {{p2}} とする", { value: st.value, p2: st.into || "?" });
    case "list-edit":
      {
        const vars = { into: st.into || "?", sep: st.sep || ",", value: st.value };
        return st.op === "remove"
          ? tr("変数 {{into}}（「{sep}」区切り）から「{value}」を取り除く", vars)
          : st.op === "add"
            ? tr("変数 {{into}}（「{sep}」区切り）に「{value}」を足す", vars)
            : tr("変数 {{into}}（「{sep}」区切り）で「{value}」を切り替える", vars);
      }
    case "repeat":
      return st.times > 0 ? tr("{times}回くり返す…", { times: st.times }) : tr("ずっとくり返す…");
    case "for-each":
      return tr("配列{p1}の要素ごとにくり返す…", { p1: arrayText(st.array) });
    case "join":
      return st.field
        ? tr("配列{array}の {field} を「{sep}」でつないで変数 {{into}} とする", { array: arrayText(st.array), field: fieldLabel(st.field), sep: st.sep, into: st.into || "?" })
        : tr("配列{array}を「{sep}」でつないで変数 {{into}} とする", { array: arrayText(st.array), sep: st.sep, into: st.into || "?" });
    case "wait":
      return tr("{seconds}秒待つ", { seconds: st.seconds });
    case "fetch":
      return tr("{p1} のデータを取得して「{p2}」とする", { p1: st.url || tr("URL未入力"), p2: st.as || "?" });
    case "calc":
      return tr("「{expr}」を計算して変数 {{p2}} とする", { expr: st.expr, p2: st.into || "?" });
    case "replace":
      return st.regex
        ? tr("「{source}」の正規表現「{find}」を「{to}」に置き換えて変数 {{into}} とする", { source: st.source, find: st.find, to: st.to, into: st.into || "?" })
        : tr("「{source}」の「{find}」を「{to}」に置き換えて変数 {{into}} とする", { source: st.source, find: st.find, to: st.to, into: st.into || "?" });
    case "if":
      return tr("もし {p1} なら…", { p1: condText(st.cond) });
  }
}

function arrayText(name: string): string {
  return name ? tr("［{name}］", { name }) : tr("（未選択）");
}
