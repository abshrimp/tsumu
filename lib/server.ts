import { NextResponse } from "next/server";
import { serverTr } from "./i18n-server";
import { auth, authConfigured } from "../auth";
import { anonymousAllowed } from "./anonymous";
import { parseActivityUser, recordActivity, type ActivityUser } from "./activity";
import { dbConfigured, getDb } from "./db";
import {
  DEFAULT_PUBLISHED_EXPORT_OPTIONS,
  readPublishedExportOptions,
  savePublishedExportOptions,
  type PublishedExportOptions,
} from "./publish-preferences";

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
  // Googleの検証済みメールがないセッションをログイン済みとみなさない。
  // NextAuth側でセッションの形式が変化した場合もAPIへの認可を fail-closed にする。
  if (typeof session?.user?.email !== "string" || !session.user.email.trim()) {
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

/** Return the last successful GitHub Push format from this site's database record. */
export async function getPublishOptions(siteId: string): Promise<PublishedExportOptions> {
  if (!dbConfigured()) return { ...DEFAULT_PUBLISHED_EXPORT_OPTIONS };
  return readPublishedExportOptions(await getDb(), siteId);
}

/** Record the completed publish. Rollbacks do not change the last output format. */
export async function recordPublish(
  siteId: string,
  target: "production" | "test",
  options?: PublishedExportOptions
): Promise<boolean> {
  if (!dbConfigured()) return false;
  let savedOptions = false;
  try {
    const db = await getDb();
    // This runs after GitHub confirms the commit. A DB failure must not
    // misreport an already successful GitHub publish as a failed publish.
    if (options) {
      try {
        savedOptions = await savePublishedExportOptions(db, siteId, options);
      } catch (error) {
        console.warn("Published to GitHub, but could not save export preferences", error);
      }
    }
    await recordActivity(db, siteId, target === "test" ? "publish-test" : "publish",
      await sessionUser().catch(() => null));
  } catch {
    // Activity is informational; failure must not undo a GitHub publication.
  }
  return savedOptions;
}
