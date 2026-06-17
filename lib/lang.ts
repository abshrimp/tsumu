/**
 * 表示言語の一覧と、リクエストから言語を決める処理（辞書を含まないので middleware でも使える）。
 *
 * 言語を足すときは:
 * 1. 下の LANGUAGES に1行足す（キーは BCP 47 の言語コード。例: zh, ko, fr）
 * 2. lib/locales/<コード>.ts に「日本語の原文 → 訳」の辞書を作る（en.ts を写して訳すと早い）
 * 3. lib/locales/index.ts の LOCALES に読み込みを足す
 * 訳の無い文は英語（FALLBACK_LANG）、それも無ければ日本語で出る
 */

export const LANGUAGES = {
  ja: { label: "日本語" },
  en: { label: "English" },
} as const;

export type Lang = keyof typeof LANGUAGES;

/** 画面の文言を書いている言語（辞書のキー） */
export const SOURCE_LANG: Lang = "ja";

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
    const code = p.trim().toLowerCase();
    if (isLang(code)) return code;
    const base = code.split("-")[0];
    if (isLang(base)) return base;
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
    .filter((x) => x.code && x.code !== "*")
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
