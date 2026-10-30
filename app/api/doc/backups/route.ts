import { NextResponse } from "next/server";
import { dbUnavailable } from "../../../../lib/unavailable";
import { serverTr } from "../../../../lib/i18n-server";
import { dbConfigured, getDb } from "../../../../lib/db";
import { requireAuth } from "../../../../lib/server";
import { userMessage } from "../../../../lib/errors";
import { siteIdOf } from "../../../../lib/site-server";

/**
 * サーバーに自動で残している日ごとのバックアップ（サイトごと・曜日ごとに7世代）。
 * ?site= のサイトの一覧、&day=0〜6 でその日の編集データを返す
 */
export async function GET(req: Request) {
  const tr = await serverTr();
  const denied = await requireAuth();
  if (denied) return denied;
  if (!dbConfigured()) return await dbUnavailable();

  const params = new URL(req.url).searchParams;
  const siteId = await siteIdOf(params.get("site"));
  if (siteId instanceof NextResponse) return siteId;
  const dayParam = params.get("day");
  try {
    const db = await getDb();
    if (dayParam !== null) {
      const day = Number(dayParam);
      if (!Number.isInteger(day) || day < 0 || day > 6) {
        return NextResponse.json({ error: tr("指定が正しくありません") }, { status: 400 });
      }
      const rs = await db.execute({
        sql: "SELECT body FROM site_backups WHERE site_id = ? AND day = ?",
        args: [siteId, day],
      });
      const row = rs.rows[0];
      if (!row) {
        return NextResponse.json({ error: tr("バックアップが見つかりません") }, { status: 404 });
      }
      // 保存済みのJSONをパースし直さずに返す（Workers無料プランのCPU時間制限対策）
      return new NextResponse(String(row.body), {
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }
    const rs = await db.execute({
      sql: "SELECT day, saved_at, length(CAST(body AS BLOB)) AS size FROM site_backups WHERE site_id = ? ORDER BY saved_at DESC",
      args: [siteId],
    });
    return NextResponse.json({
      backups: rs.rows.map((r) => ({
        day: Number(r.day),
        savedAt: Number(r.saved_at),
        bytes: Number(r.size),
      })),
    });
  } catch (e) {
    return NextResponse.json(
      { error: tr(userMessage(e, "読み込めませんでした")) },
      { status: 502 }
    );
  }
}
