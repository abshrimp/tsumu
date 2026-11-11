import { NextResponse } from "next/server";
import { dbUnavailable } from "../../../lib/unavailable";
import { serverTr } from "../../../lib/i18n-server";
import { dbConfigured, getDb } from "../../../lib/db";
import { requireAuth } from "../../../lib/server";
import { siteIdOf } from "../../../lib/site-server";
import { listCommentPage, parseCommentCursor, parseCommentAction, runCommentAction } from "../../../lib/comments";
import { userMessage } from "../../../lib/errors";
import { JsonBodyTooLargeError, JsonContentTypeError, readJsonLimited } from "../../../lib/api-json";

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
    return NextResponse.json({ error: tr("Invalid request", "invalid_request_variant_1") }, { status: 400 });
  }
  try {
    return NextResponse.json(await listCommentPage(await getDb(), siteId, before, focus), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (e) {
    return NextResponse.json({ error: tr(userMessage(e, "Couldn't load")) }, { status: 502 });
  }
}

/** コメントを書く・返信する・解決する・消す（lib/comments.ts の CommentAction） */
export async function POST(req: Request) {
  const tr = await serverTr();
  const user = await requireAuth("user");
  if (user instanceof NextResponse) return user;
  if (!dbConfigured()) return await dbUnavailable();
  const siteId = await siteIdOf(new URL(req.url).searchParams.get("site"));
  if (siteId instanceof NextResponse) return siteId;
  const params = new URL(req.url).searchParams;
  const before = parseCommentCursor(params.get("before"));
  const focus = params.get("focus");
  if ((params.has("before") && !before) || (focus !== null && !/^[a-zA-Z0-9_-]{1,64}$/.test(focus))) {
    return NextResponse.json({ error: tr("Invalid request", "invalid_request_variant_1") }, { status: 400 });
  }
  // 本文は5000文字以内のコメント1件のみ。処理するJSONもストリーム全体で制限する。
  let value: unknown;
  try {
    value = await readJsonLimited(req, 64 * 1024);
  } catch (error) {
    return NextResponse.json({ error: tr("Invalid request", "invalid_request_variant_1") }, {
      status: error instanceof JsonBodyTooLargeError ? 413 : error instanceof JsonContentTypeError ? 415 : 400,
    });
  }
  const action = parseCommentAction(value);
  if (!action) return NextResponse.json({ error: tr("Invalid request", "invalid_request_variant_1") }, { status: 400 });
  try {
    const db = await getDb();
    const ok = await runCommentAction(db, siteId, action, user);
    if (ok === "site-missing") {
      return NextResponse.json({ error: tr("Site not found"), code: "comment_site_missing" }, { status: 404 });
    }
    if (ok === "missing") {
      return NextResponse.json({ error: tr("The discussion you are replying to has been deleted."), code: "comment_thread_missing" }, { status: 404 });
    }
    if (ok === "message-missing") {
      return NextResponse.json({ error: tr("The comment you are editing has been deleted."), code: "comment_message_missing" }, { status: 404 });
    }
    if (ok === "conflict") {
      return NextResponse.json({ error: tr("This comment ID is already in use. Please send again."), code: "comment_id_conflict" }, { status: 409 });
    }
    if (!ok) {
      return NextResponse.json({ error: tr("You can't change other people's comments") }, { status: 403 });
    }
    // 新規投稿は最新の一覧に戻し、競合する投稿が多くても自身の詳細を返す。
    return NextResponse.json(await listCommentPage(db, siteId, action.action === "create" ? null : before, action.action === "create" ? action.id : focus));
  } catch (e) {
    return NextResponse.json({ error: tr(userMessage(e, "Couldn't save")) }, { status: 502 });
  }
}
