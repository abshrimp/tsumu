import { NextResponse } from "next/server";
import { dbUnavailable } from "../../../../lib/unavailable";
import { serverTr } from "../../../../lib/i18n-server";
import { requireAuth } from "../../../../lib/server";
import { dbConfigured, getDb } from "../../../../lib/db";
import { userMessage } from "../../../../lib/errors";
import { cleanupAbandonedDocuments, eraseSiteDocument } from "../../../../lib/site-document-service";
import { JsonBodyTooLargeError, JsonContentTypeError, readJsonLimited } from "../../../../lib/api-json";
import {
  deleteSite,
  getSite,
  getSiteRoomKey,
  isSiteId,
  normalizeSiteInput,
  updateSite,
  type SiteInput,
} from "../../../../lib/sites";

export const maxDuration = 30;

type Ctx = { params: Promise<{ id: string }> };

/** 認証・D1・サイトIDを確かめ、対象のサイトを返す（確かめられなければエラーのレスポンスを返す） */
async function load(ctx: Ctx) {
  const tr = await serverTr();
  const denied = await requireAuth();
  if (denied) return denied;
  if (!dbConfigured()) return await dbUnavailable();
  const { id } = await ctx.params;
  if (!isSiteId(id)) {
    return NextResponse.json({ error: tr("Invalid site") }, { status: 400 });
  }
  const db = await getDb();
  const site = await getSite(db, id);
  if (!site) return NextResponse.json({ error: tr("Site not found") }, { status: 404 });
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
    return NextResponse.json({ error: tr(userMessage(e, "Couldn't load")) }, { status: 502 });
  }
}

/** サイト名や公開先を変更する（送られた項目だけ） */
export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const r = await load(ctx);
    if (r instanceof NextResponse) return r;
    let input: SiteInput | null;
    try {
      input = await readJsonLimited(req, 64 * 1024) as SiteInput | null;
    } catch (error) {
      return NextResponse.json({ error: r.tr("Invalid request", "invalid_request_variant_1") }, {
        status: error instanceof JsonBodyTooLargeError ? 413 : error instanceof JsonContentTypeError ? 415 : 400,
      });
    }
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      return NextResponse.json({ error: r.tr("Invalid request", "invalid_request_variant_1") }, { status: 400 });
    }
    let current = r.site;
    for (let attempt = 0; attempt < 4; attempt++) {
      const parsed = normalizeSiteInput(input, current);
      if (!parsed.ok) return NextResponse.json({ error: r.tr(parsed.error) }, { status: 400 });
      const saved = await updateSite(r.db, current.id, parsed.value, current);
      const latest = await getSite(r.db, current.id);
      if (!latest) return NextResponse.json({ error: r.tr("Site not found") }, { status: 404 });
      if (saved) return NextResponse.json({ site: latest });
      // 送られた項目だけを新しい設定に適用し直す。特に、他の人の変更と競合した後は、
      // branch と previewBranch を組み合わせて検証し直す必要がある。
      current = latest;
    }
    return NextResponse.json({ error: r.tr("Couldn't save") }, { status: 409 });
  } catch (e) {
    const tr = await serverTr();
    return NextResponse.json({ error: tr(userMessage(e, "Couldn't save")) }, { status: 502 });
  }
}

/** サイトを削除する（編集データと自動バックアップも削除する。公開済みのリポジトリはそのまま残す） */
export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const r = await load(ctx);
    if (r instanceof NextResponse) return r;
    const roomKey = await getSiteRoomKey(r.db, r.site.id);
    if (r.db.backend === "d1" && !roomKey) {
      return NextResponse.json({ error: r.tr("The site's document storage was not found.") }, { status: 409 });
    }
    // D1 のトランザクションで、この Durable Object の世代の後片付けも予約する。
    await deleteSite(r.db, r.site.id, roomKey ?? undefined);
    if (roomKey) {
      // 後片付けに失敗しても、確定したサイトの削除は取り消さない。
      await eraseSiteDocument(roomKey).catch(() => undefined);
      await cleanupAbandonedDocuments(r.db, 1).catch(() => undefined);
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    const tr = await serverTr();
    return NextResponse.json({ error: tr(userMessage(e, "Couldn't delete")) }, { status: 502 });
  }
}
