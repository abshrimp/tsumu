/**
 * サーバー側（APIのエラー文・ログイン画面）の文言を、リクエストの言語にする
 */

import { cookies, headers } from "next/headers";
import { LANG_COOKIE, loadDicts, translate, type Dict, type Lang } from "./i18n";
import { isLang, parseAcceptLanguage, pickLang } from "./lang";

export type Tr = (ja: string, vars?: Record<string, string | number>) => string;

const cache = new Map<Lang, Promise<Dict[]>>();

async function trOf(lang: Lang): Promise<Tr> {
  let dicts = cache.get(lang);
  if (!dicts) {
    dicts = loadDicts(lang);
    cache.set(lang, dicts);
  }
  const list = await dicts;
  return (ja, vars) => translate(lang, list, ja, vars);
}

/** サーバーコンポーネント・API ルート用 */
export async function serverLang(): Promise<Lang> {
  const v = (await cookies()).get(LANG_COOKIE)?.value;
  if (isLang(v)) return v;
  return pickLang(parseAcceptLanguage((await headers()).get("accept-language")));
}

export async function serverTr(): Promise<Tr> {
  return trOf(await serverLang());
}
