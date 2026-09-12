import { NextResponse } from "next/server";
import { dbUnavailable } from "../../../lib/unavailable";
import { serverTr } from "../../../lib/i18n-server";
import { dbConfigured, getDb } from "../../../lib/db";
import { requireAuth } from "../../../lib/server";
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
import { isDocPatch } from "../../../lib/doc-patch";
import type { SiteDoc } from "../../../lib/types";
import { JsonBodyTooLargeError, JsonContentTypeError, readJsonLimited } from "../../../lib/api-json";

export const maxDuration = 30;

// 大きな文書も受け付けるが、不正なクライアントが際限なく本文を送り続けることは許さない。
const MAX_DOC_REQUEST_BYTES = 64 * 1024 * 1024;
const PRIVATE_CACHE = { "Cache-Control": "private, no-store" } as const;

/**
 * Cloudflare 上の編集データは、サイトごとの DocumentRoom 内の SQLite に保存する。
 * rev は単調に増え、メタデータと変更した行は同期トランザクションで同時に確定する。
 */

/**
 * 最新の文書を返す（なければ exists: false）。
 * ?meta=1 のときは本体を除いた版の情報だけを返す（通知を受けた後の確認や、代替の取得に使う）
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
      return NextResponse.json({ error: tr("Site not found") }, { status: 404 });
    }
    if (metaOnly) {
      const meta = await readSiteDocumentMeta(db, siteId);
      if (!meta) return NextResponse.json({ exists: false }, { headers: PRIVATE_CACHE });
      return NextResponse.json({ exists: true, rev: meta.rev, savedAt: meta.savedAt }, { headers: PRIVATE_CACHE });
    }

    const cur = await readSiteDocument(db, siteId);
    if (!cur) return NextResponse.json({ exists: false }, { headers: PRIVATE_CACHE });
    // body は保存済みの JSON なので、パースし直さずに文字列をつないで返す
    //（Workers 無料プランの CPU 時間の制限への対策）
    return new NextResponse(
      `{"exists":true,"rev":"${cur.rev}","savedAt":${cur.savedAt},"doc":${cur.body}}`,
      { headers: { "Content-Type": "application/json", ...PRIVATE_CACHE } }
    );
  } catch {
    // 例外には保存済みの本文や接続情報が含まれることがあるため、ログにも応答にも出さない。
    console.error("[api/doc GET] document read failed");
    return NextResponse.json(
      { error: tr("Couldn't load") },
      { status: 502 }
    );
  }
}

/**
 * 文書を保存する。base が無い場合は新規作成だけを受け付ける。既存のデータの保存には ?base=<rev> が必要で、
 * 最新の版が base と異なれば保存せず、409 で最新の文書を返す
 * （クライアントがマージしてから保存し直す）
 */
export async function PUT(req: Request) {
  return save(req, false);
}

export async function PATCH(req: Request) {
  return save(req, true);
}

async function save(req: Request, partial: boolean) {
  const tr = await serverTr();
  const user = await requireAuth("user");
  if (user instanceof NextResponse) return user;
  if (!dbConfigured()) return await dbUnavailable();

  let input: unknown;
  try {
    input = await readJsonLimited(req, MAX_DOC_REQUEST_BYTES);
  } catch (error) {
    const status = error instanceof JsonBodyTooLargeError ? 413
      : error instanceof JsonContentTypeError ? 415 : 400;
    return NextResponse.json({
      error: tr(status === 413
        ? "The document is too large for the storage"
        : partial ? "Invalid request" : "Invalid JSON"),
    }, { status });
  }
  const patch = partial ? input : undefined;
  const validationError = partial
    ? isDocPatch(patch) ? null : "不正なリクエスト"
    : validateDocValue(input);
  if (validationError) {
    return NextResponse.json({ error: tr("Invalid request") }, { status: 400 });
  }
  const params = new URL(req.url).searchParams;
  const siteId = await siteIdOf(params.get("site"));
  if (siteId instanceof NextResponse) return siteId;
  const base = params.get("base");
  if (partial && (!base || !/^[1-9]\d*$/.test(base) || !Number.isSafeInteger(Number(base)))) {
    return NextResponse.json({ error: tr("Invalid request") }, { status: 400 });
  }
  // キーが重複した JSON では、SQLite は最初の値を、JSON.parse は最後の値を読む。
  // 食い違わないよう、検証済みでエディタに配信するのと同じオブジェクトを保存する。
  let raw = "";
  if (!partial) {
    try { raw = JSON.stringify(input); } catch {
      return NextResponse.json({ error: tr("Invalid request") }, { status: 400 });
    }
  }
  const rawSenderId = req.headers.get("X-Collab-Client-Id") ?? "";
  const senderId = /^[a-zA-Z0-9_-]{1,100}$/.test(rawSenderId)
    ? rawSenderId
    : undefined;

  try {
    const db = await getDb();
    if (!(await getSite(db, siteId))) {
      return NextResponse.json({ error: tr("Site not found") }, { status: 404 });
    }
    const { result, roomKey } = partial && isDocPatch(patch)
      ? await patchSiteDocumentWithTarget(db, siteId, patch, base!)
      : await saveSiteDocumentWithTarget(db, siteId, raw, base);
    if (result.kind === "missing") {
      return NextResponse.json({ error: tr("Site not found") }, { status: 404 });
    }
    if (result.kind === "conflict") {
      const cur = result.current;
      return new NextResponse(
        `{"conflict":true,"rev":"${cur.rev}","savedAt":${cur.savedAt},"doc":${cur.body}}`,
        { status: 409, headers: { "Content-Type": "application/json", ...PRIVATE_CACHE } }
      );
    }
    // 右下の「保存」にホバーしたときに表示する、最近編集した人を記録する
    await recordActivity(db, siteId, "edit", user, result.savedAt, roomKey);
    const metadata = {
      rev: result.rev,
      savedAt: result.savedAt,
      senderId,
    };
    // 保存した世代だけに通知する。通知に失敗しても、確定した保存を失敗扱いにはしない。
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
      (e instanceof Error && /^(不正なリクエスト|JSONが壊れています|Invalid request|Invalid JSON)$/.test(e.message))) {
      return NextResponse.json({ error: tr("Invalid request") }, { status: 400 });
    }
    // 大きさの上限はここでは決めず、保存先が拒否したときにそのエラーを返す
    if (e instanceof DocTooLargeError ||
      (e instanceof Error && /too big|大きすぎ|SQLITE_TOOBIG/i.test(e.message))) {
      return NextResponse.json({ error: tr("The document is too large for the storage") }, { status: 413 });
    }
    // 例外には保存済みの本文や接続情報が含まれることがあるため、ログにも応答にも出さない。
    console.error("[api/doc] document save failed");
    return NextResponse.json(
      { error: tr("Couldn't save") },
      { status: 502 }
    );
  }
}
