import { NextResponse } from "next/server";
import { dbUnavailable } from "../../../../lib/unavailable";
import { serverTr } from "../../../../lib/i18n-server";
import { requireAuth } from "../../../../lib/server";
import { dbConfigured, getDb } from "../../../../lib/db";
import { userMessage } from "../../../../lib/errors";
import { JsonBodyTooLargeError, readJsonLimited } from "../../../../lib/api-json";
import {
  deleteSite,
  getSite,
  isSiteId,
  normalizeSiteInput,
  updateSite,
  type SiteInput,
} from "../../../../lib/sites";

export const maxDuration = 30;

type Ctx = { params: Promise<{ id: string }> };

/** 認証・D1・サイトIDを確かめて、対象のサイトを返す（だめならレスポンス） */
async function load(ctx: Ctx) {
  const tr = await serverTr();
  const denied = await requireAuth();
  if (denied) return denied;
  if (!dbConfigured()) return await dbUnavailable();
  const { id } = await ctx.params;
  if (!isSiteId(id)) {
    return NextResponse.json({ error: tr("サイトの指定が正しくありません") }, { status: 400 });
  }
  const db = await getDb();
  const site = await getSite(db, id);
  if (!site) return NextResponse.json({ error: tr("サイトが見つかりません") }, { status: 404 });
  return { tr, db, site };
}

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const r = await load(ctx);
    if (r instanceof NextResponse) return r;
    return NextResponse.json({ site: r.site }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (e) {
    const tr = await serverTr();
    return NextResponse.json({ error: tr(userMessage(e, "読み込めませんでした")) }, { status: 502 });
  }
}

/** サイト名・公開先を変える（送った項目だけ） */
export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const r = await load(ctx);
    if (r instanceof NextResponse) return r;
    let input: SiteInput | null;
    try {
      input = await readJsonLimited(req, 64 * 1024, false) as SiteInput | null;
    } catch (error) {
      return NextResponse.json({ error: r.tr("リクエストが正しくありません") }, {
        status: error instanceof JsonBodyTooLargeError ? 413 : 400,
      });
    }
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      return NextResponse.json({ error: r.tr("リクエストが正しくありません") }, { status: 400 });
    }
    let current = r.site;
    for (let attempt = 0; attempt < 4; attempt++) {
      const parsed = normalizeSiteInput(input, current);
      if (!parsed.ok) return NextResponse.json({ error: r.tr(parsed.error) }, { status: 400 });
      const saved = await updateSite(r.db, current.id, parsed.value, current);
      const latest = await getSite(r.db, current.id);
      if (!latest) return NextResponse.json({ error: r.tr("サイトが見つかりません") }, { status: 404 });
      if (saved) return NextResponse.json({ site: latest });
      // Reapply only the submitted fields to the new settings. In particular,
      // branch/previewBranch must be validated together after a competing edit.
      current = latest;
    }
    return NextResponse.json({ error: r.tr("保存できませんでした") }, { status: 409 });
  } catch (e) {
    const tr = await serverTr();
    return NextResponse.json({ error: tr(userMessage(e, "保存できませんでした")) }, { status: 502 });
  }
}

/** サイトを消す（編集データ・自動バックアップも消える。公開済みのリポジトリはそのまま） */
export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const r = await load(ctx);
    if (r instanceof NextResponse) return r;
    await deleteSite(r.db, r.site.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const tr = await serverTr();
    return NextResponse.json({ error: tr(userMessage(e, "削除できませんでした")) }, { status: 502 });
  }
}
