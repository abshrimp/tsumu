/**
 * tr("Save")、tr("Delete {name}?", { name }) のように、英語の原文をキーにする。
 * 翻訳は lib/locales/{lang}.ts に置く。
 * 英語の表示も、原文そのままでよいものは辞書が要らない。原文と表示を変えたいものだけを
 * lib/locales/en.ts に書く。en.ts の訳は、ほかの言語で訳が無いときの予備としても使う。
 *
 * 同じ英語でも意味が違うもの（日本語では言い分けたいもの）は、使う場所ごとに別のキーにする。
 * キーは英語に括弧で補足を付けたものにして（tr("Done (tutorial step)")）、en.ts で英語に戻す。
 * 選んだ言語はエディタより先に読み込み、言語を切り替えるとページを読み込み直す。
 *
 * 数で言い方が変わる文は、ICU MessageFormat の plural の書き方で訳を書ける:
 *   "{n} pages": "{n, plural, one {# page} other {# pages}}"
 * 「=0」「=1」のような数の指定と、Intl.PluralRules の区分（zero / one / two / few / many / other）を使える。
 * # は、その数に置き換わる。other は必ず書く。
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

/** ある言語の辞書（複数形の規則を選ぶため、言語も一緒に持つ） */
export type Catalog = { lang: Lang; messages: Dict };

function detectLang(): Lang {
  if (typeof window === "undefined") return "ja";
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (isLang(saved)) return saved;
  } catch {
    // localStorage が使えない環境では、ブラウザの言語に合わせる
  }
  return pickLang(navigator.languages?.length ? navigator.languages : [navigator.language || ""]);
}

let current: Lang = detectLang();
/** 訳を探す辞書（今の言語 → 予備の言語の順） */
let dicts: Catalog[] = [];
/** 辞書の読み込み（読み込み中のものと、読み込み済みのもの） */
let loading: Promise<void> | null = null;

export function getLang(): Lang {
  return current;
}

/** 言語を変えてページを読み込み直す */
export function setLang(lang: Lang) {
  try {
    window.localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // 保存できなくても、クッキーで引き継ぐ
  }
  document.cookie = `${LANG_COOKIE}=${lang}; path=/; max-age=31536000; samesite=lax`;
  window.location.reload();
}

/**
 * 言語の辞書を、予備の言語の分も含めて読み込む。
 * 英語（原文の言語）は、原文と表示が違うものだけを en.ts に書くので、英語でも辞書を読み込む。
 */
export async function loadDicts(lang: Lang): Promise<Catalog[]> {
  const chain = [lang, FALLBACK_LANG].filter((l, i, a) => a.indexOf(l) === i);
  const out: Catalog[] = [];
  for (const l of chain) {
    const load = LOCALES[l];
    if (load) out.push({ lang: l, messages: await load() });
  }
  return out;
}

/** 今の言語の辞書を読み込む（エディタの本体より先に呼ぶ） */
export async function loadLocale(): Promise<void> {
  if (typeof document !== "undefined") {
    document.documentElement.lang = current;
    // オリジンを持たないブラウザのテスト用ページ（about:blank）では、クッキーを使えない。
    // 保存できない場合でも、翻訳は読み込めるようにする。
    try {
      document.cookie = `${LANG_COOKIE}=${current}; path=/; max-age=31536000; samesite=lax`;
    } catch {
      // 埋め込まれた文書や隔離された文書での、クッキーへのアクセスのエラーは無視する。
    }
  }
  // 何か所から同時に呼ばれても、読み込みは1回にする（失敗したら、次の呼び出しで読み込み直す）
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

type Found = { value: string; lang: Lang };

function entry(messages: Dict, key: string): string | undefined {
  return Object.hasOwn(messages, key) && messages[key] ? messages[key] : undefined;
}

/** 辞書を言語の順に探す。どの辞書にも無ければ、英語の原文をそのまま使う。 */
function lookup(list: readonly Catalog[], key: string): Found {
  for (const { lang, messages } of list) {
    const value = entry(messages, key);
    if (value) return { value, lang };
  }
  return { value: key, lang: SOURCE_LANG };
}

/** 訳した文（userMessage が「自分たちで書いた案内文」を見分けるため） */
const own = new Set<string>();
function remember(s: string): string {
  if (own.size >= 1000 && !own.has(s)) {
    const oldest = own.values().next().value;
    if (oldest !== undefined) own.delete(oldest);
  }
  own.add(s);
  return s;
}
export function isTranslatedMessage(s: string): boolean {
  return own.has(s);
}

type Vars = Record<string, string | number>;

const pluralRules = new Map<string, Intl.PluralRules>();
function pluralCategory(lang: string, n: number): string {
  let rules = pluralRules.get(lang);
  if (!rules) {
    rules = new Intl.PluralRules(lang);
    pluralRules.set(lang, rules);
  }
  return rules.select(n);
}

/** "{n, plural, " のあとの選択肢を読む。書き方が正しくなければ null（その部分は書いたとおりに表示する） */
function parsePlural(s: string, start: number): { options: Map<string, string>; end: number } | null {
  const options = new Map<string, string>();
  let i = start;
  for (;;) {
    while (/\s/.test(s[i] ?? "")) i++;
    if (s[i] === "}") return options.has("other") ? { options, end: i + 1 } : null;
    const selector = /^(?:=\d+(?:\.\d+)?|[a-z]+)/.exec(s.slice(i))?.[0];
    if (!selector) return null;
    i += selector.length;
    while (/\s/.test(s[i] ?? "")) i++;
    if (s[i] !== "{") return null;
    let depth = 0;
    let close = -1;
    for (let j = i; j < s.length; j++) {
      if (s[j] === "{") depth++;
      else if (s[j] === "}" && --depth === 0) {
        close = j;
        break;
      }
    }
    if (close < 0) return null;
    options.set(selector, s.slice(i + 1, close));
    i = close + 1;
  }
}

/** {n, plural, …} を、n の数に合う言い方にする */
function formatPlurals(s: string, vars: Vars, lang: string): string {
  const start = /\{(\w+),\s*plural,/g;
  let out = "";
  let from = 0;
  for (let m = start.exec(s); m; m = start.exec(s)) {
    const parsed = Object.hasOwn(vars, m[1]) ? parsePlural(s, start.lastIndex) : null;
    if (!parsed) continue;
    const raw = vars[m[1]];
    const n = typeof raw === "number" ? raw : Number(raw);
    const exact = Number.isFinite(n) ? parsed.options.get(`=${n}`) : undefined;
    const chosen = exact ??
      (Number.isFinite(n) ? parsed.options.get(pluralCategory(lang, n)) : undefined) ??
      parsed.options.get("other")!;
    out += s.slice(from, m.index) + formatPlurals(chosen, vars, lang).replaceAll("#", String(raw));
    from = start.lastIndex = parsed.end;
  }
  return out + s.slice(from);
}

/** {name} を値に置き換える。lang は、複数形の規則を選ぶための訳文の言語 */
export function format(s: string, vars?: Vars, lang: string = SOURCE_LANG): string {
  if (!vars) return s;
  return formatPlurals(s, vars, lang).replace(/\{(\w+)\}/g, (m, k: string) => (Object.hasOwn(vars, k) ? String(vars[k]) : m));
}

/** サーバーでの描画と API の応答で、同じ探し方の規則を使う。 */
export function translate(list: readonly Catalog[], key: string, vars?: Vars): string {
  const { value, lang } = lookup(list, key);
  return remember(format(value, vars, lang));
}

/** 英語の原文を訳す */
export function tr(key: string, vars?: Vars): string {
  return translate(dicts, key, vars);
}

/** 訳文に React のノードを差し込む: trNodes("Run {cmd}", { cmd: <code>…</code> }) */
export function trNodes(key: string, nodes: Record<string, ReactNode>): ReactNode[] {
  return tr(key)
    .split(/\{(\w+)\}/)
    // 配列で返すため、差し込んだ要素にも key を付ける（React の警告が出ないように）
    .map((part, i) => (i % 2 ? createElement(Fragment, { key: i }, Object.hasOwn(nodes, part) ? nodes[part] : `{${part}}`) : part));
}
