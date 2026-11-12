/**
 * tr("Save")、tr("Delete {name}?", { name })、trc("context", "Save") のように、英語の原文を使う。
 * 翻訳は lib/locales/{lang}.ts に置く。
 * 選んだ言語はエディタより先に読み込み、言語を切り替えるとページを読み込み直す。
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
let dicts: Dict[] = [];
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

/** 言語の辞書を、予備の言語の分も含めて読み込む */
export async function loadDicts(lang: Lang): Promise<Dict[]> {
  // 英語は原文の言語なので、対応表は必要ない。
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

function lookup(list: Dict[], key: string): string | undefined {
  for (const d of list) {
    if (!Object.hasOwn(d, key)) continue;
    const v = d[key];
    if (v) return v;
  }
  return undefined;
}

/** 訳した文（userMessage が「自分たちで書いた案内文」を見分けるため） */
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

/** 英語の原文を訳す。文脈を区別することもできる。 */
type Vars = Record<string, string | number>;

export function tr(key: string, varsOrContext?: Vars | string, contextVars?: Vars): string {
  const context = typeof varsOrContext === "string" ? varsOrContext : undefined;
  const vars = typeof varsOrContext === "string" ? contextVars : varsOrContext;
  const value = (context ? lookup(dicts, `${context}\u0004${key}`) : undefined) ?? lookup(dicts, key) ?? key;
  return remember(format(value, vars));
}

/** サーバーでの描画と API の応答で、同じ探し方の規則を使う。 */
export function translate(
  lang: Lang,
  list: Dict[],
  key: string,
  varsOrContext?: Vars | string,
  contextVars?: Vars
): string {
  const context = typeof varsOrContext === "string" ? varsOrContext : undefined;
  const vars = typeof varsOrContext === "string" ? contextVars : varsOrContext;
  const value = (context ? lookup(list, `${context}\u0004${key}`) : undefined) ?? lookup(list, key) ?? key;
  return remember(format(value, vars));
}

/** 訳文に React のノードを差し込む: trNodes("Run {cmd}", { cmd: <code>…</code> }) */
export function trNodes(key: string, nodes: Record<string, ReactNode>, context?: string): ReactNode[] {
  return (context ? tr(key, context) : tr(key))
    .split(/\{(\w+)\}/)
    // 配列で返すため、差し込んだ要素にも key を付ける（React の警告が出ないように）
    .map((part, i) => (i % 2 ? createElement(Fragment, { key: i }, nodes[part] ?? `{${part}}`) : part));
}

/** 同じ英語の原文を、文脈ごとに別の訳にする。 */
export function trc(context: string, key: string, vars?: Record<string, string | number>): string {
  return tr(key, context, vars);
}
