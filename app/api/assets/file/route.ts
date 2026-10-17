import { NextResponse } from "next/server";
import { storeUnavailable } from "../../../../lib/unavailable";
import { serverTr } from "../../../../lib/i18n-server";
import { requireAuth } from "../../../../lib/server";
import { assetStore } from "../../../../lib/kv";
import { userMessage } from "../../../../lib/errors";
import { verifyAssetToken } from "../../../../lib/asset-token";

/** KV上のアセットを認証つきで配信する（エディタのキャンバス表示用） */
export async function GET(req: Request) {
  const tr = await serverTr();
  const params = new URL(req.url).searchParams;
  const path = params.get("path");
  // 期限付きの署名URL（HTMLページのプレビューなど、Cookie を送れない場所から読む）ならログインは問わない
  const signed = !!path && (await verifyAssetToken(path, params.get("exp"), params.get("sig")));
  if (!signed) {
    const denied = await requireAuth();
    if (denied) return denied;
  }
  const store = assetStore();
  if (!store) return await storeUnavailable();

  if (!path?.startsWith("assets/")) {
    return NextResponse.json({ error: tr("パスが正しくありません") }, { status: 400 });
  }

  try {
    const { value, metadata } = await store.getWithMetadata(path, {
      type: "stream",
    });
    if (!value) {
      return NextResponse.json({ error: tr("見つかりません") }, { status: 404 });
    }
    return new NextResponse(value, {
      headers: {
        "Content-Type": metadata?.contentType ?? "application/octet-stream",
        "Cache-Control": "private, max-age=31536000, immutable",
        // エディタと同じオリジンから配信するため、SVGなどを直接開いてもスクリプトが動かないようにする
        "Content-Security-Policy": "default-src 'none'; img-src data:; style-src 'unsafe-inline'; media-src 'self'; sandbox",
        "X-Content-Type-Options": "nosniff",
        // 署名URLは、別オリジンのプレビューからフォント・モジュールとしても読めるようにする
        ...(signed ? { "Access-Control-Allow-Origin": "*", "Cross-Origin-Resource-Policy": "cross-origin" } : {}),
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: tr(userMessage(e, "読み込めませんでした")) },
      { status: 502 }
    );
  }
}
