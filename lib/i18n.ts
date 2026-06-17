/**
 * エディタの表示言語。
 * 画面の文言は日本語をそのまま書き、`tr("日本語")` で包む。ほかの言語の訳は
 * lib/locales/<言語>.ts に「日本語 → 訳」の対応で置く（訳が無い文は英語、それも無ければ日本語で出る）。
 * 使える言語の一覧と、言語の足し方は lib/lang.ts にある。
 * 差し込む値は `tr("{name}を削除しますか？", { name })` のように {名前} で書く。
 *
 * 言語を切り替えるとページを読み込み直す（表示中の文言を作り直さずに済むように）。
 * 訳の辞書は loadLocale() で読み込んでからエディタ本体を読み込む。
 */

import { createElement, Fragment, type ReactNode } from "react";

import {
  FALLBACK_LANG,
  isLang,
  LANG_COOKIE,
  LANGUAGES,
  pickLang,
  SOURCE_LANG,
  type Lang,
} from "./lang";
import { LOCALES } from "./locales";

export { LANG_COOKIE, type Lang } from "./lang";

export const LANGS: { value: Lang; label: string }[] = (Object.keys(LANGUAGES) as Lang[]).map(
  (value) => ({ value, label: LANGUAGES[value].label })
);

const STORAGE_KEY = "tsumu-lang";

export type Dict = Record<string, string>;

function detectLang(): Lang {
  if (typeof window === "undefined") return SOURCE_LANG;
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (isLang(saved)) return saved;
  } catch {
    // localStorage が使えない環境ではブラウザの言語に合わせる
  }
  return pickLang(navigator.languages?.length ? navigator.languages : [navigator.language || ""]);
}

let current: Lang = detectLang();
/** 訳を探す辞書（今の言語 → 予備の言語の順） */
let dicts: Dict[] = [];
/** 辞書の読み込み（読み込み中・読み込み済みのもの） */
let loading: Promise<void> | null = null;

export function getLang(): Lang {
  return current;
}

/** 言語を変えてページを読み込み直す */
export function setLang(lang: Lang) {
  try {
    window.localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // 保存できなくてもクッキーで引き継ぐ
  }
  document.cookie = `${LANG_COOKIE}=${lang}; path=/; max-age=31536000; samesite=lax`;
  window.location.reload();
}

/** 言語の辞書を、予備の言語の分も含めて読み込む */
export async function loadDicts(lang: Lang): Promise<Dict[]> {
  // 原文の言語（日本語）は辞書を使わない（予備の言語の訳まで読み込むと、原文が訳に置き換わってしまう）
  if (lang === SOURCE_LANG) return [];
  const chain = [lang, FALLBACK_LANG].filter(
    (l, i, a) => l !== SOURCE_LANG && a.indexOf(l) === i
  );
  const out: Dict[] = [];
  for (const l of chain) {
    const load = LOCALES[l];
    if (load) out.push(await load());
  }
  return out;
}

/** 今の言語の辞書を読み込む（エディタ本体より先に呼ぶ） */
export async function loadLocale(): Promise<void> {
  if (typeof document !== "undefined") {
    document.documentElement.lang = current;
    document.cookie = `${LANG_COOKIE}=${current}; path=/; max-age=31536000; samesite=lax`;
  }
  // 同時に何か所から呼ばれても読み込みは1回にする（失敗したら次の呼び出しで読み込み直す）
  loading ??= loadDicts(current).then(
    (list) => {
      dicts = list;
    },
    (error) => {
      loading = null;
      throw error;
    }
  );
  await loading;
}

function lookup(list: Dict[], key: string): string | undefined {
  for (const d of list) {
    const v = d[key];
    if (v) return v;
  }
  return undefined;
}

/** 訳した文（userMessage が「自分たちで書いた案内文」と見分けるため） */
const own = new Set<string>();
function remember(s: string): string {
  if (own.size > 1000) own.clear();
  own.add(s);
  return s;
}
export function isTranslatedMessage(s: string): boolean {
  return own.has(s);
}

export function format(s: string, vars?: Record<string, string | number>): string {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/** 画面の文言を今の言語にする */
export function tr(ja: string, vars?: Record<string, string | number>): string {
  const out = format(lookup(dicts, ja) ?? ja, vars);
  return current === SOURCE_LANG ? out : remember(out);
}

/** サーバー側: 指定した言語・辞書（loadDicts で読み込んだもの）で訳す */
export function translate(
  lang: Lang,
  list: Dict[],
  ja: string,
  vars?: Record<string, string | number>
): string {
  const out = format(lookup(list, ja) ?? ja, vars);
  return lang === SOURCE_LANG ? out : remember(out);
}

/** 文の途中に要素を差し込む: trNodes("{cmd} を実行します", { cmd: <code>…</code> }) */
export function trNodes(ja: string, nodes: Record<string, ReactNode>): ReactNode[] {
  return tr(ja)
    .split(/\{(\w+)\}/)
    // 配列で返すので、差し込んだ要素にも key を付ける（React の警告が出ないように）
    .map((part, i) => (i % 2 ? createElement(Fragment, { key: i }, nodes[part] ?? `{${part}}`) : part));
}

/** 同じ日本語でも場面で訳が変わる短い語に使う: trc("行間", "行") */
export function trc(context: string, ja: string, vars?: Record<string, string | number>): string {
  const out = format(lookup(dicts, `${context}\u0004${ja}`) ?? ja, vars);
  return current === SOURCE_LANG ? out : remember(out);
}
