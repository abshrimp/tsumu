import { NextResponse } from "next/server";
import { requireAuth, sessionUser } from "../../../../lib/server";

/**
 * カスタムWorkerがWebSocket接続を受け入れる前に呼ぶ認証専用API。
 * ログインしている人を返す（Worker が部屋へ渡し、保存した人として記録する）
 */
export async function GET() {
  const denied = await requireAuth();
  if (denied) return denied;
  return NextResponse.json({ user: await sessionUser().catch(() => null) });
}
