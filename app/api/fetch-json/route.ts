import { NextResponse } from "next/server";
import { serverTr } from "../../../lib/i18n-server";
import { requireAuth } from "../../../lib/server";
import { BlockedUrlError, fetchPublic, readTextLimited, TooLargeError } from "../../../lib/safe-fetch";

export const maxDuration = 30;

const MAX_BYTES = 5 * 1024 * 1024;

/** エディタからのデータソース取得（CORS回避のためサーバー経由） */
export async function POST(req: Request) {
  const tr = await serverTr();
  const denied = await requireAuth();
  if (denied) return denied;

  let url: string;
  let method: string | undefined;
  let headers: unknown;
  let body: unknown;
  try {
    ({ url, method, headers, body } = await req.json());
  } catch {
    return NextResponse.json({ error: tr("リクエストが正しくありません") }, { status: 400 });
  }
  // メソッド・ヘッダー・本文（データの取得ブロックの「リクエストの設定」）
  const verb = (method ?? "GET").toUpperCase();
  if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(verb)) {
    return NextResponse.json({ error: tr("リクエストが正しくありません") }, { status: 400 });
  }
  const sendHeaders: Record<string, string> = { Accept: "application/json" };
  if (headers && typeof headers === "object") {
    const entries = Object.entries(headers as Record<string, unknown>).slice(0, 50);
    for (const [k, v] of entries) {
      // 中継先の決め方に関わるヘッダーは送らない
      if (typeof v !== "string" || !/^[\w!#$%&'*+.^`|~-]+$/.test(k)) continue;
      if (["host", "content-length", "connection", "transfer-encoding"].includes(k.toLowerCase())) continue;
      sendHeaders[k] = v;
    }
  }
  const sendBody = typeof body === "string" && verb !== "GET" && verb !== "DELETE" ? body : undefined;
  if (sendBody && sendBody.length > 1024 * 1024) {
    return NextResponse.json({ error: tr("送る本文が大きすぎます（1MBまで）") }, { status: 400 });
  }
  if (typeof url !== "string" || !/^https?:\/\//i.test(url)) {
    return NextResponse.json(
      { error: tr("http(s) のURLを指定してください") },
      { status: 400 }
    );
  }

  try {
    // SSRF対策: 内部の宛先（リダイレクト先・名前解決した先も）には送らない。本文は上限まで読む
    const res = await fetchPublic(url, {
      method: verb,
      cache: "no-store",
      headers: sendHeaders,
      ...(sendBody !== undefined ? { body: sendBody } : {}),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      return NextResponse.json(
        { error: tr("読み込めませんでした（HTTP {status}）", { status: res.status }) },
        { status: 502 }
      );
    }
    const text = await readTextLimited(res, MAX_BYTES);
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return NextResponse.json(
        { error: tr("JSONとして読み取れませんでした") },
        { status: 502 }
      );
    }
    return NextResponse.json({ ok: true, json });
  } catch (e) {
    if (e instanceof BlockedUrlError) {
      return NextResponse.json(
        { error: tr("このホストへのアクセスは許可されていません") },
        { status: 400 }
      );
    }
    if (e instanceof TooLargeError) {
      return NextResponse.json({ error: tr("JSONが大きすぎます（5MBまで）") }, { status: 502 });
    }
    return NextResponse.json(
      {
        error:
          e instanceof Error && e.name === "TimeoutError"
            ? tr("読み込みがタイムアウトしました（15秒）")
            : tr("読み込めませんでした"),
      },
      { status: 502 }
    );
  }
}
