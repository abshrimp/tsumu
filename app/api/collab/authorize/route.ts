import { NextResponse } from "next/server";
import { requireAuth } from "../../../../lib/server";

/**
 * カスタムWorkerがWebSocket接続を受け入れる前に呼ぶ認証専用API。
 * ログインしている人を返す（Worker が部屋へ渡し、保存した人として記録する）
 */
export async function GET() {
  const user = await requireAuth("user");
  if (user instanceof NextResponse) return user;
  return NextResponse.json({ user }, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
