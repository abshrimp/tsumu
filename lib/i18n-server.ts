/**
 * サーバー側（API のエラー文・ログイン画面）の文言を、リクエストの言語にする
 */

import { cookies, headers } from "next/headers";
import { loadDicts, translate, type Catalog } from "./i18n";
import { isLang, LANG_COOKIE, parseAcceptLanguage, pickLang, type Lang } from "./lang";

export type Tr = (key: string, vars?: Record<string, string | number>) => string;

const cache = new Map<Lang, Promise<Catalog[]>>();

async function trOf(lang: Lang): Promise<Tr> {
  let dicts = cache.get(lang);
  if (!dicts) {
    dicts = loadDicts(lang).catch((err) => {
      cache.delete(lang);
      throw err;
    });
    cache.set(lang, dicts);
  }
  const list = await dicts;
  return (key, vars) => translate(list, key, vars);
}

/** サーバーコンポーネントと API ルート用 */
export async function serverLang(): Promise<Lang> {
  const v = (await cookies()).get(LANG_COOKIE)?.value;
  if (isLang(v)) return v;
  return pickLang(parseAcceptLanguage((await headers()).get("accept-language")));
}

export async function serverTr(): Promise<Tr> {
  return trOf(await serverLang());
}
