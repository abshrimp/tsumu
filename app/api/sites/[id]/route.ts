import { NextResponse } from "next/server";
import { dbUnavailable } from "../../../../lib/unavailable";
import { serverTr } from "../../../../lib/i18n-server";
import { requireAuth, sessionUser } from "../../../../lib/server";
import { requireSiteAccess, siteRole } from "../../../../lib/site-access";
import { dbConfigured, getDb } from "../../../../lib/db";
import { userMessage } from "../../../../lib/errors";
import { cleanupAbandonedDocuments, eraseSiteDocument } from "../../../../lib/site-document-service";
import { jsonErrorStatus, readJsonObjectLimited } from "../../../../lib/api-json";
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
  const deniedSite = await requireSiteAccess(id, "view");
  if (deniedSite) return deniedSite;
  return { tr, db, site };
}

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const r = await load(ctx);
    if (r instanceof NextResponse) return r;
    const role = await siteRole(r.db, r.site.id, (await sessionUser())?.email ?? null);
    return NextResponse.json({ site: { ...r.site, accessRole: role } }, {
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
    const denied = await requireAuth("editor");
    if (denied) return denied;
    const r = await load(ctx);
    if (r instanceof NextResponse) return r;
    const deniedSite = await requireSiteAccess(r.site.id, "edit");
    if (deniedSite) return deniedSite;
    let input: SiteInput;
    try {
      input = await readJsonObjectLimited(req, 64 * 1024) as SiteInput;
    } catch (error) {
      return NextResponse.json({ error: r.tr("Invalid request (request body)") }, {
        status: jsonErrorStatus(error),
      });
    }
    let current = r.site;
    for (let attempt = 0; attempt < 4; attempt++) {
      const parsed = normalizeSiteInput(input, current);
      if (!parsed.ok) return NextResponse.json({ error: r.tr(parsed.error) }, { status: 400 });
      const saved = await updateSite(r.db, current.id, parsed.value, current);
      const latest = await getSite(r.db, current.id);
      if (!latest) return NextResponse.json({ error: r.tr("Site not found") }, { status: 404 });
      if (saved) return NextResponse.json({ site: { ...latest, accessRole: await siteRole(r.db, latest.id, (await sessionUser())?.email ?? null) } });
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
    const denied = await requireAuth("editor");
    if (denied) return denied;
    const r = await load(ctx);
    if (r instanceof NextResponse) return r;
    const deniedSite = await requireSiteAccess(r.site.id, "manage");
    if (deniedSite) return deniedSite;
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
