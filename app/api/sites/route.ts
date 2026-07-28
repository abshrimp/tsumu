import { NextResponse } from "next/server";
import { dbUnavailable } from "../../../lib/unavailable";
import { serverTr } from "../../../lib/i18n-server";
import { requireAuth } from "../../../lib/server";
import { dbConfigured, getDb } from "../../../lib/db";
import { userMessage } from "../../../lib/errors";
import { readCurrentDoc, saveCurrentDoc } from "../../../lib/doc-storage";
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

  const input = (await req.json().catch(() => null)) as (SiteInput & { copyFrom?: unknown }) | null;
  if (!input || typeof input !== "object") {
    return NextResponse.json({ error: tr("リクエストが正しくありません") }, { status: 400 });
  }
  const copyFrom = input.copyFrom;
  if (copyFrom !== undefined && !isSiteId(copyFrom)) {
    return NextResponse.json({ error: tr("リクエストが正しくありません") }, { status: 400 });
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
    // Capture the source before creating the destination. A missing document is
    // valid only for an existing, never-opened site, not one deleted mid-copy.
    const src = copyFrom ? await readCurrentDoc(db, copyFrom) : null;
    if (copyFrom && !src && !(await getSite(db, copyFrom))) {
      return NextResponse.json({ error: tr("複製するサイトが見つかりません") }, { status: 404 });
    }
    const id = newSiteId();
    await insertSite(db, id, parsed.value);
    if (copyFrom) {
      try {
        if (src) {
          const saved = await saveCurrentDoc(db, id, src.body, null);
          if (saved.kind !== "saved") throw new Error("作成できませんでした");
        }
      } catch (e) {
        await deleteSite(db, id).catch(() => {});
        throw e;
      }
    }
    return NextResponse.json({ site: await getSite(db, id) });
  } catch (e) {
    return NextResponse.json({ error: tr(userMessage(e, "作成できませんでした")) }, { status: 502 });
  }
}
