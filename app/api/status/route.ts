import { NextResponse } from "next/server";
import { authConfigured } from "../../../auth";
import { requireAuth, sessionUser } from "../../../lib/server";
import { dbConfigured } from "../../../lib/db";
import { assetStore } from "../../../lib/kv";

/** サーバーの設定状況（ログインの有無・保存先）。画面の出し分けに使う */
export async function GET() {
  const denied = await requireAuth();
  if (denied) return denied;
  return NextResponse.json({
    auth: authConfigured(),
    db: dbConfigured(),
    assets: assetStore() !== null,
    // ログインしている人（コメントで、自分の書いたものを見分ける）
    user: await sessionUser().catch(() => null),
  });
}
