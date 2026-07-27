import { NextResponse } from "next/server";
import { dbUnavailable } from "../../../lib/unavailable";
import { serverTr } from "../../../lib/i18n-server";
import { dbConfigured, getDb } from "../../../lib/db";
import { requireAuth, sessionUser } from "../../../lib/server";
import { siteIdOf } from "../../../lib/site-server";
import { listCommentPage, parseCommentCursor, parseCommentAction, runCommentAction } from "../../../lib/comments";
import { userMessage } from "../../../lib/errors";

export const maxDuration = 30;

/** サイトのコメント（?site=）。D1 が無ければ 503（ブラウザ内に保存する） */
export async function GET(req: Request) {
  const tr = await serverTr();
  const denied = await requireAuth();
  if (denied) return denied;
  if (!dbConfigured()) return await dbUnavailable();
  const siteId = await siteIdOf(new URL(req.url).searchParams.get("site"));
  if (siteId instanceof NextResponse) return siteId;
  const params = new URL(req.url).searchParams;
  const before = parseCommentCursor(params.get("before"));
  const focus = params.get("focus");
  if ((params.has("before") && !before) || (focus !== null && !/^[a-zA-Z0-9_-]{1,64}$/.test(focus))) {
    return NextResponse.json({ error: tr("リクエストが正しくありません") }, { status: 400 });
  }
  try {
    return NextResponse.json(await listCommentPage(await getDb(), siteId, before, focus));
  } catch (e) {
    return NextResponse.json({ error: tr(userMessage(e, "読み込めませんでした")) }, { status: 502 });
  }
}

/** コメントを書く・返信する・解決する・消す（lib/comments.ts の CommentAction） */
export async function POST(req: Request) {
  const tr = await serverTr();
  const denied = await requireAuth();
  if (denied) return denied;
  if (!dbConfigured()) return await dbUnavailable();
  const siteId = await siteIdOf(new URL(req.url).searchParams.get("site"));
  if (siteId instanceof NextResponse) return siteId;
  const params = new URL(req.url).searchParams;
  const before = parseCommentCursor(params.get("before"));
  const focus = params.get("focus");
  if ((params.has("before") && !before) || (focus !== null && !/^[a-zA-Z0-9_-]{1,64}$/.test(focus))) {
    return NextResponse.json({ error: tr("リクエストが正しくありません") }, { status: 400 });
  }
  const action = parseCommentAction(await req.json().catch(() => null));
  if (!action) return NextResponse.json({ error: tr("リクエストが正しくありません") }, { status: 400 });
  try {
    const db = await getDb();
    const ok = await runCommentAction(db, siteId, action, await sessionUser().catch(() => null));
    if (ok === "site-missing") {
      return NextResponse.json({ error: tr("サイトが見つかりません"), code: "comment_site_missing" }, { status: 404 });
    }
    if (ok === "missing") {
      return NextResponse.json({ error: tr("返信先のスレッドは削除されています"), code: "comment_thread_missing" }, { status: 404 });
    }
    if (ok === "message-missing") {
      return NextResponse.json({ error: tr("編集するコメントは削除されています"), code: "comment_message_missing" }, { status: 404 });
    }
    if (ok === "conflict") {
      return NextResponse.json({ error: tr("コメントのIDが重複しています。もう一度送信してください"), code: "comment_id_conflict" }, { status: 409 });
    }
    if (!ok) {
      return NextResponse.json({ error: tr("ほかの人のコメントは変更できません") }, { status: 403 });
    }
    // 新規投稿は最新の一覧に戻し、競合する投稿が多くても自身の詳細を返す。
    return NextResponse.json(await listCommentPage(db, siteId, action.action === "create" ? null : before, action.action === "create" ? action.id : focus));
  } catch (e) {
    return NextResponse.json({ error: tr(userMessage(e, "保存できませんでした")) }, { status: 502 });
  }
}
