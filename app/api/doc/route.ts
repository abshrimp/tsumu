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
  InvalidDocPatchError,
  validateDocValue,
} from "../../../lib/doc-storage";
import {
  readSiteDocument,
  readSiteDocumentMeta,
  saveSiteDocumentWithTarget,
  patchSiteDocumentWithTarget,
} from "../../../lib/site-document-service";
import { getSite } from "../../../lib/sites";
import { userMessage } from "../../../lib/errors";
import { isDocPatch } from "../../../lib/doc-patch";
import type { SiteDoc } from "../../../lib/types";
import { JsonBodyTooLargeError, JsonContentTypeError, readJsonLimited } from "../../../lib/api-json";

export const maxDuration = 30;

// Large documents remain supported, but a malformed client cannot stream an unbounded body.
const MAX_DOC_REQUEST_BYTES = 64 * 1024 * 1024;
const PRIVATE_CACHE = { "Cache-Control": "private, no-store" } as const;

/**
 * Cloudflare上の編集データはサイトごとのDocumentRoom内SQLiteに保存する。
 * revは単調増加し、メタデータと変更行を同期トランザクションで確定する。
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
    if (!(await getSite(db, siteId))) {
      return NextResponse.json({ error: tr("サイトが見つかりません") }, { status: 404 });
    }
    if (metaOnly) {
      const meta = await readSiteDocumentMeta(db, siteId);
      if (!meta) return NextResponse.json({ exists: false }, { headers: PRIVATE_CACHE });
      return NextResponse.json({ exists: true, rev: meta.rev, savedAt: meta.savedAt }, { headers: PRIVATE_CACHE });
    }

    const cur = await readSiteDocument(db, siteId);
    if (!cur) return NextResponse.json({ exists: false }, { headers: PRIVATE_CACHE });
    // body は保存済みJSONなので、パースし直さず文字列結合で返す
    //（Workers無料プランのCPU時間制限対策）
    return new NextResponse(
      `{"exists":true,"rev":"${cur.rev}","savedAt":${cur.savedAt},"doc":${cur.body}}`,
      { headers: { "Content-Type": "application/json", ...PRIVATE_CACHE } }
    );
  } catch {
    // 例外には保存済みの本文や接続情報が含まれ得るため、ログにも応答にも渡さない。
    console.error("[api/doc GET] document read failed");
    return NextResponse.json(
      { error: tr("読み込めませんでした") },
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

  let input: unknown;
  try {
    input = await readJsonLimited(req, MAX_DOC_REQUEST_BYTES);
  } catch (error) {
    const status = error instanceof JsonBodyTooLargeError ? 413
      : error instanceof JsonContentTypeError ? 415 : 400;
    return NextResponse.json({
      error: tr(status === 413
        ? "ドキュメントが大きすぎて、保存先に入りきりません"
        : partial ? "不正なリクエスト" : "JSONが壊れています"),
    }, { status });
  }
  const patch = partial ? input : undefined;
  const validationError = partial
    ? isDocPatch(patch) ? null : "不正なリクエスト"
    : validateDocValue(input);
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
  // SQLite reads the first repeated JSON key; JSON.parse reads the last.
  // Store the same object that was validated and will be broadcast to editors.
  let raw = "";
  if (!partial) {
    try { raw = JSON.stringify(input); } catch {
      return NextResponse.json({ error: tr("不正なリクエスト") }, { status: 400 });
    }
  }
  const rawSenderId = req.headers.get("X-Collab-Client-Id") ?? "";
  const senderId = /^[a-zA-Z0-9_-]{1,100}$/.test(rawSenderId)
    ? rawSenderId
    : undefined;

  try {
    const db = await getDb();
    if (!(await getSite(db, siteId))) {
      return NextResponse.json({ error: tr("サイトが見つかりません") }, { status: 404 });
    }
    const { result, roomKey } = partial && isDocPatch(patch)
      ? await patchSiteDocumentWithTarget(db, siteId, patch, base!)
      : await saveSiteDocumentWithTarget(db, siteId, raw, base);
    if (result.kind === "missing") {
      return NextResponse.json({ error: tr("サイトが見つかりません") }, { status: 404 });
    }
    if (result.kind === "conflict") {
      const cur = result.current;
      return new NextResponse(
        `{"conflict":true,"rev":"${cur.rev}","savedAt":${cur.savedAt},"doc":${cur.body}}`,
        { status: 409, headers: { "Content-Type": "application/json", ...PRIVATE_CACHE } }
      );
    }
    // 右下の「保存」にホバーしたときに出す、最近編集した人
    await recordActivity(db, siteId, "edit", await sessionUser().catch(() => null), result.savedAt);
    const metadata = {
      rev: result.rev,
      savedAt: result.savedAt,
      senderId,
    };
    // 保存した世代だけに通知し、通知の失敗で確定済みの保存を失敗扱いにしない。
    try {
      if (db.backend !== "d1" || roomKey) {
        notifyDocUpdated(siteId, partial && isDocPatch(patch)
          ? { ...metadata, type: "doc-patched", base: base!, patch }
          : { ...metadata, type: "doc-updated", doc: input as SiteDoc }, roomKey ?? undefined);
      }
    } catch {
      console.error("[api/doc] document notification failed");
    }
    return NextResponse.json({
      ok: true,
      rev: result.rev,
      savedAt: result.savedAt,
    });
  } catch (e) {
    if (e instanceof InvalidDocPatchError ||
      (e instanceof Error && /^(不正なリクエスト|JSONが壊れています)$/.test(e.message))) {
      return NextResponse.json({ error: tr("不正なリクエスト") }, { status: 400 });
    }
    // 大きさの上限は決め打ちせず、保存先が拒んだときに返す
    if (e instanceof DocTooLargeError ||
      (e instanceof Error && /too big|大きすぎ|SQLITE_TOOBIG/i.test(e.message))) {
      return NextResponse.json({ error: tr("ドキュメントが大きすぎて、保存先に入りきりません") }, { status: 413 });
    }
    // 例外には保存済みの本文や接続情報が含まれ得るため、ログにも応答にも渡さない。
    console.error("[api/doc] document save failed");
    return NextResponse.json(
      { error: tr("保存できませんでした") },
      { status: 502 }
    );
  }
}
