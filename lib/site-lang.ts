/**
 * 公開サイトの言語（<html lang>・PWAのマニフェスト・既定の404ページの文言に使う）。
 * エディタの表示言語（lib/lang.ts）とは別で、サイトごとに選ぶ
 */

import type { SiteDoc } from "./types";

/** サイトの既定の言語 */
export const DEFAULT_SITE_LANG = "ja";

/** 選べる言語（BCP 47 の言語コードと、その言語での名前） */
export const SITE_LANGS: { value: string; label: string }[] = [
  { value: "ja", label: "日本語" },
  { value: "en", label: "English" },
  { value: "zh-Hans", label: "中文（简体）" },
  { value: "zh-Hant", label: "中文（繁體）" },
  { value: "ko", label: "한국어" },
  { value: "es", label: "Español" },
  { value: "fr", label: "Français" },
  { value: "de", label: "Deutsch" },
  { value: "it", label: "Italiano" },
  { value: "pt", label: "Português" },
  { value: "id", label: "Bahasa Indonesia" },
  { value: "th", label: "ไทย" },
  { value: "vi", label: "Tiếng Việt" },
];

/** 言語コードとして使える形か（ja / en-US / zh-Hant のような BCP 47 の形） */
export function isSiteLang(v: unknown): v is string {
  return typeof v === "string" && /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i.test(v);
}

/** サイトの言語（未設定・不正な値は既定の言語） */
export function siteLangOf(doc: Pick<SiteDoc, "lang">): string {
  const v = doc.lang?.trim();
  return isSiteLang(v) ? v : DEFAULT_SITE_LANG;
}

/** ページの言語（ページで選んでいなければサイトの言語） */
export function pageLangOf(doc: Pick<SiteDoc, "lang">, page: { lang?: string } | undefined): string {
  const v = page?.lang?.trim();
  return isSiteLang(v) ? v : siteLangOf(doc);
}

/** 公開サイトに出す、言語ごとの決まり文句（日本語以外は英語） */
export function siteText(lang: string, key: "notFound" | "loading"): string {
  const ja = lang.toLowerCase().split("-")[0] === "ja";
  switch (key) {
    case "notFound":
      return ja ? "ページが見つかりませんでした。" : "Page not found.";
    case "loading":
      return ja ? "読み込み中" : "Loading";
  }
}
