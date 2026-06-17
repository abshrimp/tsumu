import { NextResponse } from "next/server";
import { serverTr } from "./i18n-server";
import { auth, authConfigured } from "../auth";
import { anonymousAllowed } from "./anonymous";
import { parseActivityUser, recordActivity, type ActivityUser } from "./activity";
import { dbConfigured, getDb } from "./db";

/**
 * APIの認可チェック。通れば null、弾く場合はレスポンスを返す。
 * Google認証が未設定なら、ログインなしで使える
 */
export async function requireAuth(): Promise<NextResponse | null> {
  // middleware と同じ判定（middleware を通らない呼び出しでも、許可なくログインなしで動かさない）
  if (!authConfigured()) {
    if (anonymousAllowed()) return null;
    const tr = await serverTr();
    return NextResponse.json({ error: tr("ログインが設定されていません") }, { status: 503 });
  }
  const session = await auth();
  if (!session) {
    const tr = await serverTr();
    return NextResponse.json({ error: tr("ログインが必要です") }, { status: 401 });
  }
  return null;
}

/** ログインしている人（Google認証を使っていなければ null） */
export async function sessionUser(): Promise<ActivityUser | null> {
  if (!authConfigured()) return null;
  const session = await auth();
  const u = session?.user;
  if (!u?.email) return null;
  return parseActivityUser({ email: u.email, name: u.name, image: u.image });
}

/** 公開（ロールバックも含む）したことと、公開した人を記録する（右下の「公開」にホバーしたときに出す） */
export async function recordPublish(siteId: string, target: "production" | "test"): Promise<void> {
  if (!dbConfigured()) return;
  try {
    await recordActivity(
      await getDb(),
      siteId,
      target === "test" ? "publish-test" : "publish",
      await sessionUser().catch(() => null)
    );
  } catch {
    // 記録は表示のためだけなので、失敗しても公開は成功させる
  }
}
