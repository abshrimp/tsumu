import { NextResponse } from "next/server";
import { dbUnavailable } from "../../../lib/unavailable";
import { serverTr } from "../../../lib/i18n-server";
import { dbConfigured, getDb } from "../../../lib/db";
import { requireAuth } from "../../../lib/server";
import { requireSiteAccess } from "../../../lib/site-access";
import { siteIdOf } from "../../../lib/site-server";
import { readActivity } from "../../../lib/activity";
import { userMessage } from "../../../lib/errors";

/** サイトの最近の編集と最後の公開（?site=）。右下の「保存」「公開」にホバーしたときに表示する */
export async function GET(req: Request) {
  const tr = await serverTr();
  const denied = await requireAuth();
  if (denied) return denied;
  if (!dbConfigured()) return await dbUnavailable();
  const siteId = await siteIdOf(new URL(req.url).searchParams.get("site"));
  if (siteId instanceof NextResponse) return siteId;
  const siteDenied = await requireSiteAccess(siteId, "view");
  if (siteDenied) return siteDenied;
  try {
    return NextResponse.json(await readActivity(await getDb(), siteId), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (e) {
    return NextResponse.json({ error: tr(userMessage(e, "Couldn't load")) }, { status: 502 });
  }
}
