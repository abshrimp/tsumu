import { NextResponse } from "next/server";
import { dbUnavailable } from "../../../lib/unavailable";
import { serverTr } from "../../../lib/i18n-server";
import { dbConfigured, getDb } from "../../../lib/db";
import { requireAuth } from "../../../lib/server";
import { siteIdOf } from "../../../lib/site-server";
import { readActivity } from "../../../lib/activity";
import { userMessage } from "../../../lib/errors";

/** サイトの最近の編集・最後の公開（?site=。右下の「保存」「公開」にホバーしたときに出す） */
export async function GET(req: Request) {
  const tr = await serverTr();
  const denied = await requireAuth();
  if (denied) return denied;
  if (!dbConfigured()) return await dbUnavailable();
  const siteId = await siteIdOf(new URL(req.url).searchParams.get("site"));
  if (siteId instanceof NextResponse) return siteId;
  try {
    return NextResponse.json(await readActivity(await getDb(), siteId));
  } catch (e) {
    return NextResponse.json({ error: tr(userMessage(e, "読み込めませんでした")) }, { status: 502 });
  }
}
