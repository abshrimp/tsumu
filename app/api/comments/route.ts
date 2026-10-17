import { NextResponse } from "next/server";
import { dbUnavailable } from "../../../lib/unavailable";
import { serverTr } from "../../../lib/i18n-server";
import { dbConfigured, getDb } from "../../../lib/db";
import { requireAuth, sessionUser } from "../../../lib/server";
import { siteIdOf } from "../../../lib/site-server";
import { listComments, parseCommentAction, runCommentAction } from "../../../lib/comments";
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
  try {
    return NextResponse.json({ threads: await listComments(await getDb(), siteId) });
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
  const action = parseCommentAction(await req.json().catch(() => null));
  if (!action) return NextResponse.json({ error: tr("リクエストが正しくありません") }, { status: 400 });
  try {
    const db = await getDb();
    const ok = await runCommentAction(db, siteId, action, await sessionUser().catch(() => null));
    if (!ok) {
      return NextResponse.json({ error: tr("ほかの人のコメントは変更できません") }, { status: 403 });
    }
    return NextResponse.json({ threads: await listComments(db, siteId) });
  } catch (e) {
    return NextResponse.json({ error: tr(userMessage(e, "保存できませんでした")) }, { status: 502 });
  }
}
