import { NextResponse } from "next/server";
import { serverTr } from "../../../lib/i18n-server";
import { requireAuth } from "../../../lib/server";
import { BlockedUrlError, fetchPublic, readTextLimited, TooLargeError } from "../../../lib/safe-fetch";
import { readJsonLimited } from "../../../lib/api-json";

export const maxDuration = 30;

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_REQUEST_BYTES = 2 * 1024 * 1024;

/** エディタからデータソースを取得する（CORS を避けるため、サーバーを経由する） */
export async function POST(req: Request) {
  const tr = await serverTr();
  const denied = await requireAuth();
  if (denied) return denied;

  let url: string;
  let method: string | undefined;
  let headers: unknown;
  let body: unknown;
  try {
    ({ url, method, headers, body } = await readJsonLimited(req, MAX_REQUEST_BYTES) as {
      url: string; method?: string; headers?: unknown; body?: unknown;
    });
  } catch (error) {
    return NextResponse.json({ error: tr("Invalid request", "invalid_request_variant_1") }, { status: error instanceof RangeError ? 413 : 400 });
  }
  // メソッド・ヘッダー・本文（データの取得ブロックの「リクエストの設定」）
  const verb = typeof method === "string" ? method.toUpperCase() : method == null ? "GET" : "";
  if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(verb)) {
    return NextResponse.json({ error: tr("Invalid request", "invalid_request_variant_1") }, { status: 400 });
  }
  const sendHeaders: Record<string, string> = { Accept: "application/json" };
  if (headers && typeof headers === "object") {
    const entries = Object.entries(headers as Record<string, unknown>).slice(0, 50);
    for (const [k, v] of entries) {
      // 中継先の決定に影響するヘッダーは送らない
      if (typeof v !== "string" || !/^[\w!#$%&'*+.^`|~-]+$/.test(k)) continue;
      if (["host", "content-length", "connection", "transfer-encoding"].includes(k.toLowerCase())) continue;
      sendHeaders[k] = v;
    }
  }
  const sendBody = typeof body === "string" && verb !== "GET" && verb !== "DELETE" ? body : undefined;
  if (sendBody && sendBody.length > 1024 * 1024) {
    return NextResponse.json({ error: tr("The request body is too large (up to 1 MB)") }, { status: 400 });
  }
  if (typeof url !== "string" || !/^https?:\/\//i.test(url)) {
    return NextResponse.json(
      { error: tr("Enter an http(s) URL") },
      { status: 400 }
    );
  }

  try {
    // SSRF 対策: 内部の宛先（リダイレクト先や、名前解決した先を含む）には送らない。本文は上限まで読む
    const res = await fetchPublic(url, {
      method: verb,
      cache: "no-store",
      headers: sendHeaders,
      ...(sendBody !== undefined ? { body: sendBody } : {}),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      // エラーを報告するときに、複製した応答のもう一方の読み手を待たないようにする。
      void res.body?.cancel().catch(() => {});
      return NextResponse.json(
        { error: tr("Couldn't load (HTTP {status})", { status: res.status }) },
        { status: 502 }
      );
    }
    const text = await readTextLimited(res, MAX_BYTES);
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return NextResponse.json(
        { error: tr("Couldn't parse it as JSON") },
        { status: 502 }
      );
    }
    return NextResponse.json({ ok: true, json });
  } catch (e) {
    if (e instanceof BlockedUrlError) {
      return NextResponse.json(
        { error: tr("Access to this host isn't allowed") },
        { status: 400 }
      );
    }
    if (e instanceof TooLargeError) {
      return NextResponse.json({ error: tr("The JSON is too large (max 5MB)") }, { status: 502 });
    }
    return NextResponse.json(
      {
        error:
          e instanceof Error && e.name === "TimeoutError"
            ? tr("Loading timed out (15 seconds)")
            : tr("Couldn't load"),
      },
      { status: 502 }
    );
  }
}
