import { NextResponse } from "next/server";
import { dbUnavailable } from "../../../lib/unavailable";
import { serverTr } from "../../../lib/i18n-server";
import { dbConfigured, getDb } from "../../../lib/db";
import { requireAuth, sessionUser } from "../../../lib/server";
import { recordActivity } from "../../../lib/activity";
import { notifyDocUpdated } from "../../../lib/collab";
import { siteIdOf } from "../../../lib/site-server";
import {
  DocTooLargeError,
  readCurrentDoc,
  saveCurrentDoc,
  saveDocPatch,
  validateDocBody,
} from "../../../lib/doc-storage";
import { userMessage } from "../../../lib/errors";
import { isDocPatch } from "../../../lib/doc-patch";

export const maxDuration = 30;

/**
 * ドキュメントの保存先はD1（docsテーブルの1行。?site= のサイトIDの行）。
 * rev は単調増加の整数で、楽観ロックは UPDATE ... WHERE rev = ? により
 * 原子的に判定する
 */

/**
 * 最新のドキュメントを返す（なければ exists: false）。
 * ?meta=1 なら本体を除いた版情報のみ（通知後の確認・フォールバック用）
 */
export async function GET(req: Request) {
  const tr = await serverTr();
  const denied = await requireAuth();
  if (denied) return denied;
  if (!dbConfigured()) return await dbUnavailable();

  const params = new URL(req.url).searchParams;
  const siteId = await siteIdOf(params.get("site"));
  if (siteId instanceof NextResponse) return siteId;
  const metaOnly = params.get("meta") === "1";

  try {
    const db = await getDb();
    if (metaOnly) {
      const rs = await db.execute({
        sql: "SELECT rev, saved_at FROM docs WHERE id = ?",
        args: [siteId],
      });
      const row = rs.rows[0];
      if (!row) return NextResponse.json({ exists: false });
      return NextResponse.json({
        exists: true,
        rev: String(row.rev),
        savedAt: Number(row.saved_at),
      });
    }

    const cur = await readCurrentDoc(db, siteId);
    if (!cur) return NextResponse.json({ exists: false, deltaVersion: 1 });
    // body は保存済みJSONなので、パースし直さず文字列結合で返す
    //（Workers無料プランのCPU時間制限対策）
    return new NextResponse(
      `{"exists":true,"deltaVersion":1,"rev":"${cur.rev}","savedAt":${cur.savedAt},"doc":${cur.body}}`,
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (e) {
    return NextResponse.json(
      { error: tr(userMessage(e, "読み込めませんでした")) },
      { status: 502 }
    );
  }
}

/**
 * ドキュメントを保存。base が無ければ新規作成のみ。既存データには ?base=<rev> が必要:
 * 最新の版が base と違えば保存せず、409 で最新ドキュメントを返す
 * （クライアントがマージして再保存する）
 */
export async function PUT(req: Request) {
  return save(req, false);
}

export async function PATCH(req: Request) {
  return save(req, true);
}

async function save(req: Request, partial: boolean) {
  const tr = await serverTr();
  const denied = await requireAuth();
  if (denied) return denied;
  if (!dbConfigured()) return await dbUnavailable();

  // 再シリアライズは避けるが、壊れたJSONで保存データ全体が読めなくなるのを防ぐ
  const raw = (await req.text()).trim();
  let patch: unknown;
  if (partial) {
    try { patch = JSON.parse(raw); } catch { /* validation below */ }
  }
  const validationError = partial
    ? isDocPatch(patch) ? null : "不正なリクエスト"
    : validateDocBody(raw);
  if (validationError) {
    return NextResponse.json({ error: tr(validationError) }, { status: 400 });
  }
  const params = new URL(req.url).searchParams;
  const siteId = await siteIdOf(params.get("site"));
  if (siteId instanceof NextResponse) return siteId;
  const base = params.get("base");
  if (partial && (!base || !/^[1-9]\d*$/.test(base) || !Number.isSafeInteger(Number(base)))) {
    return NextResponse.json({ error: tr("不正なリクエスト") }, { status: 400 });
  }
  const rawSenderId = req.headers.get("X-Collab-Client-Id") ?? "";
  const senderId = /^[a-zA-Z0-9_-]{1,100}$/.test(rawSenderId)
    ? rawSenderId
    : undefined;

  try {
    const db = await getDb();
    const result = partial && isDocPatch(patch)
      ? await saveDocPatch(db, siteId, patch, base!)
      : await saveCurrentDoc(db, siteId, raw, base);
    if (result.kind === "missing") {
      return NextResponse.json({ error: tr("サイトが見つかりません") }, { status: 404 });
    }
    if (result.kind === "conflict") {
      const cur = result.current;
      return new NextResponse(
        `{"conflict":true,"rev":"${cur.rev}","savedAt":${cur.savedAt},"doc":${cur.body}}`,
        { status: 409, headers: { "Content-Type": "application/json" } }
      );
    }
    // 右下の「保存」にホバーしたときに出す、最近編集した人
    await recordActivity(db, siteId, "edit", await sessionUser().catch(() => null), result.savedAt);
    const metadata = {
      rev: result.rev,
      savedAt: result.savedAt,
      senderId,
    };
    notifyDocUpdated(siteId, partial && isDocPatch(patch)
      ? { ...metadata, type: "doc-patched", base: base!, patch }
      : { ...metadata, type: "doc-updated", doc: JSON.parse(raw) });
    return NextResponse.json({
      ok: true,
      rev: result.rev,
      savedAt: result.savedAt,
    });
  } catch (e) {
    // 大きさの上限は決め打ちせず、保存先が拒んだときに返す
    if (e instanceof DocTooLargeError) {
      return NextResponse.json({ error: tr("ドキュメントが大きすぎて、保存先に入りきりません") }, { status: 413 });
    }
    return NextResponse.json(
      { error: tr(userMessage(e, "保存できませんでした")) },
      { status: 502 }
    );
  }
}
