import { NextResponse } from "next/server";
import { serverTr } from "./i18n-server";
import { auth, authConfigured } from "../auth";
import { anonymousAllowed } from "./anonymous";
import { parseActivityUser, recordActivity, type ActivityUser } from "./activity";
import { dbConfigured, getDb } from "./db";

/**
 * 認可に失敗したときは、レスポンスを返す。"user" を指定したときは、認可に使ったセッションの
 * 利用者を返す。この場合の null は、明示的に許可した匿名のアクセスだけを表す。
 */
export function requireAuth(): Promise<NextResponse | null>;
export function requireAuth(mode: "user"): Promise<NextResponse | ActivityUser | null>;
export async function requireAuth(mode?: "user"): Promise<NextResponse | ActivityUser | null> {
  // middleware と同じ判定（middleware を通らない呼び出しでも、許可なくログインなしでは動かさない）
  if (!authConfigured()) {
    if (anonymousAllowed()) return null;
    const tr = await serverTr();
    return NextResponse.json({ error: tr("Sign-in is not configured") }, { status: 503 });
  }
  const session = await auth();
  // Google で検証済みのメールアドレスが無いセッションを、ログイン済みとはみなさない。
  // NextAuth 側でセッションの形が変わった場合も、API の認可は拒否する側に倒す。
  const user = parseActivityUser(session?.user);
  if (!user) {
    const tr = await serverTr();
    return NextResponse.json({ error: tr("You need to sign in") }, { status: 401 });
  }
  return mode === "user" ? user : null;
}

/** ログインしている人（Google 認証を使っていなければ null） */
export async function sessionUser(): Promise<ActivityUser | null> {
  if (!authConfigured()) return null;
  const session = await auth();
  return parseActivityUser(session?.user);
}

/** 公開（ロールバックを含む）したことと、公開した人を記録する（右下の「公開」にホバーしたときに表示する） */
export async function recordPublish(siteId: string, target: "production" | "test", expectedRoomKey?: string | null): Promise<void> {
  if (!dbConfigured()) return;
  try {
    await recordActivity(
      await getDb(),
      siteId,
      target === "test" ? "publish-test" : "publish",
      await sessionUser().catch(() => null),
      Date.now(),
      expectedRoomKey
    );
  } catch {
    // 記録は表示のためだけのものなので、失敗しても公開は成功として扱う
  }
}
