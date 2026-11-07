import { NextResponse } from "next/server";
import { requireAuth } from "../../../lib/server";
import { serverTr } from "../../../lib/i18n-server";
import { BlockedUrlError, fetchPublic, TooLargeError } from "../../../lib/safe-fetch";
import { SOURCE_LIMIT } from "../../../lib/url-site-import";

export const maxDuration = 30;

/**
 * Same-origin URL import relay. The public-URL transport validates redirects,
 * rejects private/reserved targets and prevents DNS rebinding on Node.
 * Keeping this server-side also avoids requiring CORS from the source host.
 */
export async function GET(req: Request) {
  const denied = await requireAuth();
  if (denied) return denied;
  const tr = await serverTr();
  const url = new URL(req.url).searchParams.get("url");
  if (!url || url.length > 2048 || !/^https?:\/\//i.test(url)) {
    return NextResponse.json({ error: tr("URLの指定が正しくありません") }, { status: 400 });
  }
  try {
    const response = await fetchPublic(url, {
      method: "GET",
      headers: { Accept: "application/zip,application/json,application/octet-stream;q=0.9,*/*;q=0.1" },
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      return NextResponse.json({ error: tr("取得元からファイルを読み込めませんでした") },
        { status: 502 });
    }
    const length = Number(response.headers.get("content-length") || "0");
    if (length > SOURCE_LIMIT) {
      await response.body?.cancel().catch(() => {});
      return NextResponse.json({ error: tr("URLから取得できるファイルは5MBまでです") },
        { status: 413 });
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > SOURCE_LIMIT) {
      return NextResponse.json({ error: tr("URLから取得できるファイルは5MBまでです") },
        { status: 413 });
    }
    return new Response(bytes, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof BlockedUrlError) {
      return NextResponse.json({ error: tr("安全でないURLからは取得できません") },
        { status: 400 });
    }
    if (error instanceof TooLargeError) {
      return NextResponse.json({ error: tr("URLから取得できるファイルは5MBまでです") },
        { status: 413 });
    }
    return NextResponse.json({ error: tr("URLのファイルを取得できませんでした") },
      { status: 502 });
  }
}
