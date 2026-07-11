import type { FetchHeader, FetchMethod } from "./types";
import { interpolate, interpolateJson, type Vars } from "./vars";

/** データの取得ブロックで選べるHTTPメソッド */
export const FETCH_METHODS: FetchMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];

/** 取得ブロックの、URL以外のリクエストの設定 */
export interface FetchOptions {
  method?: FetchMethod;
  headers?: FetchHeader[];
  body?: string;
}

/** 実際に送るリクエストの設定（すべて既定なら undefined） */
export interface FetchRequest {
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

/** {変数} を値にした、送るリクエストの設定 */
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

/** 本文が JSON として読めなければ true（{変数} は値が決まるまで分からないため null として確かめる） */
export function bodyJsonError(body: string | undefined): boolean {
  if (!body?.trim()) return false;
  try {
    JSON.parse(interpolateJson(body, {}));
    return false;
  } catch {
    return true;
  }
}
