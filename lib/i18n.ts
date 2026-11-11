/**
 * Use English source strings in tr("Save"), tr("Delete {name}?", { name }),
 * or trc("context", "Save"). Translations live in lib/locales/{lang}.ts.
 * The selected language is loaded before the editor; switching reloads the page.
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
  // English is the source language and needs no lookup table.
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
    if (!Object.hasOwn(d, key)) continue;
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

/** Translate English source text, optionally distinguishing a context. */
type Vars = Record<string, string | number>;

export function tr(key: string, varsOrContext?: Vars | string, contextVars?: Vars): string {
  const context = typeof varsOrContext === "string" ? varsOrContext : undefined;
  const vars = typeof varsOrContext === "string" ? contextVars : varsOrContext;
  const value = (context ? lookup(dicts, `${context}\u0004${key}`) : undefined) ?? lookup(dicts, key) ?? key;
  return remember(format(value, vars));
}

/** Use the same lookup rules for server rendering and API responses. */
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

/** Insert React nodes into translated text: trNodes("Run {cmd}", { cmd: <code>…</code> }) */
export function trNodes(key: string, nodes: Record<string, ReactNode>, context?: string): ReactNode[] {
  return (context ? tr(key, context) : tr(key))
    .split(/\{(\w+)\}/)
    // 配列で返すので、差し込んだ要素にも key を付ける（React の警告が出ないように）
    .map((part, i) => (i % 2 ? createElement(Fragment, { key: i }, nodes[part] ?? `{${part}}`) : part));
}

/** Different translations of the same English source in different contexts. */
export function trc(context: string, key: string, vars?: Record<string, string | number>): string {
  return tr(key, context, vars);
}
