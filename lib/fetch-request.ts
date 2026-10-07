import type { FetchHeader, FetchMethod } from "./types";
import { interpolate, interpolateJson, type Vars } from "./vars";

/** データの取得ブロックで選べる HTTP のメソッド */
export const FETCH_METHODS: FetchMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];

/** 取得ブロックの、URL 以外のリクエストの設定 */
export interface FetchOptions {
  method?: FetchMethod;
  headers?: FetchHeader[];
  body?: string;
}

/** 実際に送るリクエストの設定（すべて既定なら undefined） */
interface FetchRequest {
  method?: FetchMethod;
  headers?: Record<string, string>;
  body?: string;
}

/** 本文を送るメソッドか */
export const sendsBody = (method: FetchMethod | undefined) => !!method && method !== "GET" && method !== "DELETE";

/** 本文を送るときの既定の Content-Type（ヘッダーで指定していなければ足す） */
export function needsJsonType(o: FetchOptions): boolean {
  return (
    sendsBody(o.method) &&
    !!o.body?.trim() &&
    !(o.headers ?? []).some((h) => h.name.trim().toLowerCase() === "content-type")
  );
}

/** {変数} を値に置き換えた、送るリクエストの設定 */
export function fetchRequestOf(o: FetchOptions, vars: Vars): FetchRequest | undefined {
  const method = o.method && o.method !== "GET" ? o.method : undefined;
  const headers: Record<string, string> = {};
  for (const h of o.headers ?? []) {
    const name = h.name.trim();
    if (name) headers[name] = interpolate(h.value, vars);
  }
  if (needsJsonType(o)) headers["Content-Type"] = "application/json";
  const body = sendsBody(method) && o.body?.trim() ? interpolateJson(o.body, vars) : undefined;
  if (!method && !Object.keys(headers).length) return undefined;
  return {
    ...(method ? { method } : {}),
    ...(Object.keys(headers).length ? { headers } : {}),
    ...(body !== undefined ? { body } : {}),
  };
}

/** 本文を JSON として読めなければ true を返す（{変数} は値が決まるまで分からないため、null とみなして確かめる） */
export function bodyJsonError(body: string | undefined): boolean {
  if (!body?.trim()) return false;
  try {
    JSON.parse(interpolateJson(body, {}));
    return false;
  } catch {
    return true;
  }
}

/**
 * Script-runtime JSON body interpolation. Keep this helper self-contained so
 * the exact same implementation can be embedded in published scripts.
 */
export function runtimeJsonBody(
  template: string,
  read: (name: string) => unknown,
  toText: (value: unknown) => string,
): string {
  const token = /\\\{|\{([^{}\s"'<>\x60]+)\}|\[slug\]/g;
  let output = "";
  let start = 0;
  let quoted = false;
  for (const match of template.matchAll(token)) {
    const prefix = template.slice(start, match.index);
    for (let i = 0; i < prefix.length; i++) {
      if (prefix[i] === "\\") i++;
      else if (prefix[i] === '"') quoted = !quoted;
    }
    output += prefix;
    start = match.index! + match[0].length;
    if (match[0] === "\\{") {
      if (quoted) {
        let slashes = 0;
        while (slashes < prefix.length && prefix[prefix.length - slashes - 1] === "\\") slashes++;
        if (slashes % 2) output = output.slice(0, -1);
      }
      output += "{";
    } else {
      const value = read(match[1] || "slug");
      output += quoted
        ? JSON.stringify(toText(value)).slice(1, -1)
        : JSON.stringify(value === undefined ? null : value);
    }
  }
  return output + template.slice(start);
}
