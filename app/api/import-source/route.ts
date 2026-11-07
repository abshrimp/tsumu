import { NextResponse } from "next/server";
import { requireAuth } from "../../../lib/server";
import { fetchPublic, BlockedUrlError, TooLargeError } from "../../../lib/safe-fetch";
import { IMPORT_LIMITS } from "../../../lib/site-import";

export const maxDuration = 30;

const limits = {
  zip: IMPORT_LIMITS.zipBytes,
  doc: IMPORT_LIMITS.docBytes,
  asset: IMPORT_LIMITS.assetBytes,
};
type Kind = keyof typeof limits;

/** The browser never fetches arbitrary third-party URLs directly. This route
 * applies the existing public-host/DNS/redirect SSRF guard and a hard byte cap. */
export async function POST(req: Request) {
  const denied = await requireAuth();
  if (denied) return denied;
  const params = await req.json().catch(() => null) as { url?: unknown; kind?: unknown } | null;
  if (!params || typeof params.url !== "string" || typeof params.kind !== "string" ||
      !Object.hasOwn(limits, params.kind) || params.url.length > 2048) {
    return NextResponse.json({ error: "取得先のURLが正しくありません。" }, { status: 400 });
  }
  const kind = params.kind as Kind;
  let target: URL;
  try { target = new URL(params.url); }
  catch { return NextResponse.json({ error: "取得先のURLが正しくありません。" }, { status: 400 }); }
  if (!/^https?:$/.test(target.protocol) || target.username || target.password) {
    return NextResponse.json({ error: "公開されているHTTP(S)のURLを指定してください。" }, { status: 400 });
  }

  const limit = limits[kind];
  try {
    const res = await fetchPublic(target.href, { method: "GET", headers: {
      Accept: kind === "zip" ? "application/zip,application/octet-stream,*/*" :
        kind === "doc" ? "application/json,text/plain,*/*" : "*/*",
    } }, 5, limit);
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      return NextResponse.json({ error: "取得先がエラーを返しました（HTTP " + res.status + "）。" },
        { status: 502 });
    }
    const len = Number(res.headers.get("content-length") || 0);
    if (len > limit) {
      await res.body?.cancel().catch(() => {});
      return NextResponse.json({ error: "取得するファイルが容量上限を超えています。" }, { status: 413 });
    }
    const reader = res.body?.getReader();
    if (!reader) return NextResponse.json({ error: "ファイルが空です。" }, { status: 400 });
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel().catch(() => {});
        return NextResponse.json({ error: "取得するファイルが容量上限を超えています。" }, { status: 413 });
      }
      chunks.push(value);
    }
    if (!total) return NextResponse.json({ error: "ファイルが空です。" }, { status: 400 });
    const output = new Uint8Array(total);
    let at = 0;
    for (const chunk of chunks) { output.set(chunk, at); at += chunk.byteLength; }
    return new NextResponse(new Blob([output as Uint8Array<ArrayBuffer>]), {
      headers: {
        "Content-Type": "application/octet-stream",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof TooLargeError) {
      return NextResponse.json({ error: "取得するファイルが容量上限を超えています。" }, { status: 413 });
    }
    if (error instanceof BlockedUrlError) {
      return NextResponse.json({ error: "安全上の理由でこのURLからは取得できません。" }, { status: 400 });
    }
    return NextResponse.json({ error: "外部URLから取得できませんでした。URLと公開設定を確認してください。" }, { status: 502 });
  }
}
