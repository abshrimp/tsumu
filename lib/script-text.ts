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
    case "contains":
      return tr("{subject}が {v} を含む", { subject, v });
    case "starts-with":
      return tr("{subject}が {v} で始まる", { subject, v });
    case "ends-with":
      return tr("{subject}が {v} で終わる", { subject, v });
    case "gt":
      return tr("{subject}が {v} より大きい", { subject, v });
    case "gte":
      return tr("{subject}が {v} 以上", { subject, v });
    case "lt":
      return tr("{subject}が {v} より小さい", { subject, v });
    case "lte":
      return tr("{subject}が {v} 以下", { subject, v });
    case "empty":
      return tr("{subject}が空", { subject });
    default:
      return tr("{subject}が {v} と同じ", { subject, v });
  }
}

export function condText(c: ScriptCond): string {
  const t = targetText(c.target);
  const negate = (phrase: string) => c.not ? tr("{phrase}ではない", { phrase }) : phrase;
  switch (c.subject) {
    case "var":
      return negate(opText(tr("「{value}」", { value: c.left ?? "" }), c.op, c.value ?? ""));
    case "value":
      return negate(opText(tr("{t} の値", { t }), c.op, c.value ?? ""));
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
    case "set-state":
      return tr("{target}を{state}にする", {
        target: targetText(st.target), state: st.state || tr("既定"),
      });
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
    case "list-display": {
      if (st.mode === "clear") return st.no !== undefined
        ? tr("リスト{p1}の絞り込み{no}を解除する", { p1: arrayText(st.array), no: st.no })
        : tr("リスト{p1}のすべての絞り込みを解除する", { p1: arrayText(st.array) });
      if (st.mode === "sort") return st.dir === "desc"
        ? tr("リスト{array}を {field} の大きい順に並べ替える", { array: arrayText(st.array), field: st.field || tr("（項目未選択）") })
        : tr("リスト{array}を {field} の小さい順に並べ替える", { array: arrayText(st.array), field: st.field || tr("（項目未選択）") });
      const conds = [{ field: st.field, op: st.op, value: st.value, not: st.not }, ...(st.or ?? [])]
        .map((c, i) => {
          const detail = opText(c.field || tr("（項目未選択）"), c.op, c.value);
          return `${i ? ("and" in c && c.and ? tr(" かつ ") : tr(" または ")) : ""}${c.not ? tr("{phrase}ではない", { phrase: detail }) : detail}`;
        })
        .join("");
      const head = `${st.no !== undefined ? tr("絞り込み{no}: ", { no: st.no }) : ""}${st.join === "or" ? tr("（ほかの絞り込みと「または」）") : ""}`;
      return tr("{head}リスト{p2}を {conds} ものに絞り込む", { head, p2: arrayText(st.array), conds });
    }
    case "store-save":
      return st.shared
        ? tr("共有ストレージの「{key}」に「{value}」を保存する", { key: st.key || tr("キー未入力"), value: st.value })
        : tr("ストレージの「{key}」に「{value}」を保存する", { key: st.key || tr("キー未入力"), value: st.value });
    case "store-load":
      return st.shared
        ? tr("共有ストレージの「{key}」を読み込んで変数 {{into}} とする", { key: st.key || tr("キー未入力"), into: st.into || "?" })
        : tr("ストレージの「{key}」を読み込んで変数 {{into}} とする", { key: st.key || tr("キー未入力"), into: st.into || "?" });
    case "copy":
      return tr("「{value}」をコピーする", { value: st.value });
    case "set-var":
      return tr("「{value}」を変数 {{p2}} とする", { value: st.value, p2: st.into || "?" });
    case "transform":
      return tr("変数{source}を加工して変数{into}に入れる", {
        source: st.source || tr("（未選択）"), into: st.into || "?",
      });
    case "repeat":
      return st.times === 0 ? tr("ずっとくり返す…") : tr("{times}回くり返す…", { times: st.times });
    case "for-each":
      return tr("リスト{p1}の要素ごとにくり返す…", { p1: arrayText(st.array) });
    case "wait":
      return tr("{seconds}秒待つ", { seconds: st.seconds });
    case "fetch":
      return tr("{p1} のデータを取得して「{p2}」とする", { p1: st.url || tr("URL未入力"), p2: st.as || "?" });
    case "if":
      return tr("もし {p1} なら…", { p1: condText(st.cond) });
  }
}

function arrayText(name: string): string {
  return name ? tr("［{name}］", { name }) : tr("（未選択）");
}
