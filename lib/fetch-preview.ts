/** エディタのテスト実行だけで使う値の確認。公開サイトでの値の差し込み方は変えない。 */
import { sendsBody, type FetchOptions } from "./fetch-request";
import { extractVars, lookupVar, type Vars } from "./vars";

export function fetchPreviewInputs(url: string, options: FetchOptions, vars: Vars) {
  const text = new Set([
    ...extractVars(url),
    ...(options.headers ?? []).filter((h) => h.name.trim()).flatMap((h) => extractVars(h.value)),
  ]);
  const names = new Set([...text, ...extractVars(sendsBody(options.method) ? options.body ?? "" : "")]);
  return [...names].map((name) => {
    const value = lookupVar(vars, name);
    return {
      name, value,
      // null やオブジェクトを URL の空文字にせず、そのテストで使う値を求める。
      missing: value === undefined || (text.has(name) && (value === null || typeof value === "object")),
    };
  });
}
