/**
 * Lightweight language metadata for middleware and the browser.
 * Add lib/locales/<BCP-47>.ts; scripts/sync-locales.mjs discovers it.
 * Source English needs no file. Missing translations fall back to English.
 */
import { REGISTERED_LANGUAGES } from "./locales/languages.generated";

export const LANGUAGES = REGISTERED_LANGUAGES;

export type Lang = keyof typeof LANGUAGES;

/** The source strings in tr() are written in English. */
export const SOURCE_LANG: Lang = "en";

/** 対応していない言語の人に出す言語。訳が無い文もこの言語の訳を使う */
export const FALLBACK_LANG: Lang = "en";

/** サーバー（APIのエラー文）にも言語を伝えるクッキー */
export const LANG_COOKIE = "tsumu-lang";

export function isLang(v: unknown): v is Lang {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(LANGUAGES, v);
}

/** 優先する順の言語コード（"zh-TW" など）から、対応している言語を選ぶ */
export function pickLang(prefs: readonly string[]): Lang {
  for (const p of prefs) {
    let code: string;
    try {
      code = Intl.getCanonicalLocales(p.trim())[0].toLowerCase();
    } catch {
      continue;
    }
    // A script- or region-specific dictionary can also match a more specific tag.
    for (;;) {
      if (isLang(code)) return code;
      const hyphen = code.lastIndexOf("-");
      if (hyphen < 0) break;
      code = code.slice(0, hyphen);
    }
  }
  return FALLBACK_LANG;
}

/** Accept-Language を優先順（q の大きい順）の言語コードにする */
export function parseAcceptLanguage(header: string | null | undefined): string[] {
  return (header ?? "")
    .split(",")
    .map((part, i) => {
      const [code, ...params] = part.trim().split(";");
      const q = Number(params.find((x) => x.trim().startsWith("q="))?.trim().slice(2) ?? 1);
      return { code, q: Number.isFinite(q) ? q : 0, i };
    })
    .filter((x) => x.code && x.code !== "*" && x.q > 0 && x.q <= 1)
    .sort((a, b) => b.q - a.q || a.i - b.i)
    .map((x) => x.code);
}

/** リクエストのクッキー・Accept-Language から言語を決める（サーバー側） */
export function langOfRequest(req: Request): Lang {
  const cookie = req.headers.get("cookie") ?? "";
  const m = new RegExp(`(?:^|;\\s*)${LANG_COOKIE}=([\\w-]+)`).exec(cookie);
  if (m && isLang(m[1])) return m[1];
  return pickLang(parseAcceptLanguage(req.headers.get("accept-language")));
}
