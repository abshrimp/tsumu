import { NextResponse } from "next/server";
import { dbUnavailable } from "../../../lib/unavailable";
import { serverTr } from "../../../lib/i18n-server";
import { requireAuth } from "../../../lib/server";
import { dbConfigured, getDb } from "../../../lib/db";
import { userMessage } from "../../../lib/errors";
import { readCurrentDoc, saveCurrentDoc, validateDocBody, DocTooLargeError } from "../../../lib/doc-storage";
import { DOCUMENT_LIMIT } from "../../../lib/url-site-import";
import {
  DEFAULT_BRANCH,
  DEFAULT_PREVIEW_BRANCH,
  deleteSite,
  getSite,
  insertSite,
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
    return NextResponse.json({ sites: await listSites(await getDb()) });
  } catch (e) {
    return NextResponse.json({ error: tr(userMessage(e, "読み込めませんでした")) }, { status: 502 });
  }
}

/**
 * サイトを作る（編集データは、初めて開いたときにエディタが保存する）。
 * copyFrom にサイトIDがあれば、そのサイトの編集データを複製する（公開先は受け取った値を使う）
 */
export async function POST(req: Request) {
  const tr = await serverTr();
  const denied = await requireAuth();
  if (denied) return denied;
  if (!dbConfigured()) return await dbUnavailable();

  const input = (await req.json().catch(() => null)) as (SiteInput & { copyFrom?: unknown; importDoc?: unknown }) | null;
  if (!input || typeof input !== "object") {
    return NextResponse.json({ error: tr("リクエストが正しくありません") }, { status: 400 });
  }
  const copyFrom = input.copyFrom;
  if (copyFrom !== undefined && !isSiteId(copyFrom)) {
    return NextResponse.json({ error: tr("リクエストが正しくありません") }, { status: 400 });
  }
  if (copyFrom !== undefined && input.importDoc !== undefined) {
    return NextResponse.json({ error: tr("リクエストが正しくありません") }, { status: 400 });
  }
  const importRaw = input.importDoc === undefined ? null : JSON.stringify(input.importDoc);
  if (importRaw !== null) {
    if (new TextEncoder().encode(importRaw).length > DOCUMENT_LIMIT) {
      return NextResponse.json({ error: tr("doc.jsonが大きすぎます（3MBまで）") },
        { status: 413 });
    }
    const invalid = validateDocBody(importRaw);
    if (invalid) {
      return NextResponse.json({ error: tr(invalid) }, { status: 400 });
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
  try {
    const db = await getDb();
    if (copyFrom && !(await getSite(db, copyFrom))) {
      return NextResponse.json({ error: tr("複製するサイトが見つかりません") }, { status: 404 });
    }
    const id = newSiteId();
    await insertSite(db, id, parsed.value);
    if (copyFrom || importRaw !== null) {
      try {
        // Imported sites are only visible after their complete document is saved.
        const src = copyFrom ? await readCurrentDoc(db, copyFrom) : null;
        const body = importRaw ?? src?.body;
        if (body) {
          const result = await saveCurrentDoc(db, id, body, null);
          if (result.kind !== "saved") throw new Error("Imported document was not saved");
        }
      } catch (e) {
        await deleteSite(db, id).catch(() => {});
        throw e;
      }
    }
    return NextResponse.json({ site: await getSite(db, id) });
  } catch (e) {
    if (e instanceof DocTooLargeError) {
      return NextResponse.json({ error: tr("ドキュメントが大きすぎて、保存先に入りきりません") }, { status: 413 });
    }
    return NextResponse.json({ error: tr(userMessage(e, "作成できませんでした")) }, { status: 502 });
  }
}
