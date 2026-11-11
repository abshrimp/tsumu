import { NextResponse } from "next/server";
import { dbUnavailable } from "../../../lib/unavailable";
import { serverTr } from "../../../lib/i18n-server";
import { requireAuth } from "../../../lib/server";
import { dbConfigured, getDb } from "../../../lib/db";
import { userMessage } from "../../../lib/errors";
import { IMPORT_LIMITS, validateImportedDoc } from "../../../lib/site-import-format";
import { readTextLimited, TooLargeError } from "../../../lib/safe-fetch";
import {
  readSiteDocument, saveSiteDocument, eraseSiteDocument, cleanupAbandonedDocuments,
} from "../../../lib/site-document-service";
import {
  DEFAULT_BRANCH,
  DEFAULT_PREVIEW_BRANCH,
  getSite,
  insertSite,
  deleteSite,
  isSiteId,
  listSites,
  newSiteId,
  normalizeSiteInput,
  type SiteInput,
} from "../../../lib/sites";

export const maxDuration = 30;

/** サイトの一覧（最近編集した順）。D1 が無ければ 503（ブラウザ内の一覧を使う） */
export async function GET() {
  const tr = await serverTr();
  const denied = await requireAuth();
  if (denied) return denied;
  if (!dbConfigured()) return await dbUnavailable();
  try {
    const db = await getDb();
    await cleanupAbandonedDocuments(db, 1).catch(() => undefined);
    return NextResponse.json({ sites: await listSites(db) }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (e) {
    return NextResponse.json({ error: tr(userMessage(e, "Couldn't load")) }, { status: 502 });
  }
}

/**
 * 通常のサイトは最初に開いたときに保存し、インポート時は初版と同時に作成する。
 * copyFrom にサイトIDがあれば、そのサイトの編集データを複製する（公開先は受け取った値を使う）
 */
export async function POST(req: Request) {
  const tr = await serverTr();
  const denied = await requireAuth();
  if (denied) return denied;
  if (!dbConfigured()) return await dbUnavailable();

  let input: SiteInput & { copyFrom?: unknown; importId?: unknown; initialDoc?: unknown };
  try {
    const raw = await readTextLimited(new Response(req.body, { headers: req.headers }), IMPORT_LIMITS.docBytes + 1024);
    input = JSON.parse(raw);
  } catch (error) {
    const status = error instanceof TooLargeError ? 413 : 400;
    return NextResponse.json({ error: tr(status === 413 ? "The import file is too large." : "Invalid request") }, { status });
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return NextResponse.json({ error: tr("Invalid request", "invalid_request_variant_1") }, { status: 400 });
  }
  const { copyFrom, importId, initialDoc } = input;
  const importing = importId !== undefined || initialDoc !== undefined;
  if (copyFrom !== undefined && (!isSiteId(copyFrom) || importing)) {
    return NextResponse.json({ error: tr("Invalid request", "invalid_request_variant_1") }, { status: 400 });
  }
  let initialBody: string | undefined;
  if (importing) {
    if (typeof importId !== "string" || !/^[a-z0-9]{10}$/.test(importId)) {
      return NextResponse.json({ error: tr("Invalid request", "invalid_request_variant_1") }, { status: 400 });
    }
    try {
      const doc = validateImportedDoc(initialDoc);
      if (doc.siteName !== input.name) throw new Error("リクエストが正しくありません");
      initialBody = JSON.stringify(doc);
      if (new TextEncoder().encode(initialBody).byteLength > IMPORT_LIMITS.docBytes) {
        return NextResponse.json({ error: tr("The edit data exceeds the size limit.") }, { status: 413 });
      }
    } catch (error) {
      return NextResponse.json({ error: tr(userMessage(error, "Invalid request")) }, { status: 400 });
    }
  }
  const parsed = normalizeSiteInput(input, {
    name: "",
    repo: null,
    branch: DEFAULT_BRANCH,
    previewBranch: DEFAULT_PREVIEW_BRANCH,
    siteUrl: null,
    previewUrl: null,
  });
  if (!parsed.ok) return NextResponse.json({ error: tr(parsed.error) }, { status: 400 });
  let createdSite: { id: string; db: Awaited<ReturnType<typeof getDb>>; roomKey: string | null } | null = null;
  try {
    const db = await getDb();
    if (copyFrom && !(await getSite(db, copyFrom))) {
      return NextResponse.json({ error: tr("The site to duplicate was not found") }, { status: 404 });
    }
    // Capture the source before creating the destination. A missing document is
    // valid only for an existing, never-opened site, not one deleted mid-copy.
    const src = copyFrom ? await readSiteDocument(db, copyFrom) : null;
    if (copyFrom && !src && !(await getSite(db, copyFrom))) {
      return NextResponse.json({ error: tr("The site to duplicate was not found") }, { status: 404 });
    }
    const id = typeof importId === "string" ? importId : newSiteId();
    if (importing && await getSite(db, id)) {
      return NextResponse.json({ error: tr("Could not create the site.") }, { status: 409 });
    }
    // The D1 site record and DO document are different transactional stores.
    // If document initialization fails, delete the newly created site record.
    const roomKey = await insertSite(db, id, parsed.value);
    createdSite = { id, db, roomKey };
    const content = initialBody ?? src?.body;
    if (content !== undefined) {
      const saved = await saveSiteDocument(db, id, content, null, roomKey ?? undefined);
      if (saved.kind !== "saved") throw new Error("初期ドキュメントを保存できませんでした");
    }
    const site = await getSite(db, id, roomKey ?? undefined);
    if (!site) throw new Error("サイトを作成できませんでした。");
    return NextResponse.json({ site });
  } catch (e) {
    if (createdSite) {
      await deleteSite(createdSite.db, createdSite.id, createdSite.roomKey ?? undefined).catch(() => undefined);
      await eraseSiteDocument(createdSite.roomKey).catch(() => undefined);
      await cleanupAbandonedDocuments(createdSite.db, 1).catch(() => undefined);
    }
    if (e instanceof Error && /SQLITE_TOOBIG|too big/i.test(e.message)) {
      return NextResponse.json({ error: tr("The document is too large for the storage") }, { status: 413 });
    }
    if (importing && e instanceof Error && /UNIQUE constraint failed: sites\.id/i.test(e.message)) {
      return NextResponse.json({ error: tr("Could not create the site.") }, { status: 409 });
    }
    // 複製元の本文や保存先の接続情報を含む例外をログや応答に渡さない。
    console.error("[api/sites POST] site creation failed");
    return NextResponse.json({ error: tr("Couldn't create it") }, { status: 502 });
  }
}
