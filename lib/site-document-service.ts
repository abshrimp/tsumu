import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { Db } from "./db";
import type { DocPatch } from "./doc-patch";
import { getSiteRoomKey, recordSiteSavedAt } from "./sites";
import {
  readCurrentDoc as readLocalDocument,
  saveCurrentDoc as saveLocalDocument,
  saveDocPatch as patchLocalDocument,
  type CurrentDoc, type SaveDocResult,
} from "./doc-storage";

/**
 * サイトの ID は公開される識別子で、作成ごとのルームのキーは、保存先の振り分けにだけ使う非公開の値。
 * Cloudflare では行の構造を持つ Durable Object の SQLite を、Node.js では SQLite を使う。
 * どちらの保存先も、もう一方の保存先の表現からデータを読まない。
 */
interface DocumentStub {
  getSnapshot(): Promise<CurrentDoc | null>;
  getMetadata(): Promise<{ rev: string; savedAt: number } | null>;
  replaceDocument(raw: string, base: string | null): Promise<SaveDocResult>;
  patchDocument(patch: DocPatch, base: string): Promise<SaveDocResult>;
  listAssetReferences(): Promise<Array<{ path: string; bytes: number | null }>>;
  listBackups(): Promise<Array<{ day: number; savedAt: number; bytes: number }>>;
  readBackup(day: number): Promise<string | null>;
  eraseDocument(): Promise<void>;
}
interface DocumentNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): DocumentStub;
}
function cloudNamespace(): DocumentNamespace | null {
  let env: Record<string, unknown>;
  try {
    env = getCloudflareContext().env as unknown as Record<string, unknown>;
  } catch {
    return null; // Node.js・Docker の環境
  }
  if (env.DB && !env.DOC_STORE) throw new Error("DOC_STORE binding is required");
  return (env.DOC_STORE as DocumentNamespace | undefined) ?? null;
}

function byKey(key: string): DocumentStub | null {
  const namespace = cloudNamespace();
  return namespace ? namespace.get(namespace.idFromName(key)) : null;
}

type DocumentTarget =
  | { kind: "local" }
  | { kind: "missing" }
  | { kind: "room"; stub: DocumentStub; roomKey: string };

async function forSite(db: Db, siteId: string): Promise<DocumentTarget> {
  const namespace = cloudNamespace();
  if (!namespace) return { kind: "local" };
  const roomKey = await getSiteRoomKey(db, siteId);
  // 削除した Cloudflare の世代を、決してローカルの保存先で代わりに扱わない。
  if (!roomKey) return { kind: "missing" };
  return { kind: "room", stub: namespace.get(namespace.idFromName(roomKey)), roomKey };
}

/** 待機した RPC の後で、世代を確かめ直す。削除したサイトは見えない。 */
async function unchangedGeneration(db: Db, siteId: string, roomKey: string): Promise<boolean> {
  return await getSiteRoomKey(db, siteId) === roomKey;
}

export function usesDocumentRooms(): boolean {
  return cloudNamespace() !== null;
}

export async function readSiteDocument(db: Db, siteId: string): Promise<CurrentDoc | null> {
  const target = await forSite(db, siteId);
  if (target.kind === "local") return readLocalDocument(db, siteId);
  if (target.kind === "missing") return null;
  const doc = await target.stub.getSnapshot();
  return await unchangedGeneration(db, siteId, target.roomKey) ? doc : null;
}

export async function readSiteDocumentMeta(db: Db, siteId: string):
  Promise<{ rev: string; savedAt: number } | null> {
  const target = await forSite(db, siteId);
  if (target.kind === "missing") return null;
  if (target.kind === "room") {
    const meta = await target.stub.getMetadata();
    return await unchangedGeneration(db, siteId, target.roomKey) ? meta : null;
  }
  const rs = await db.execute({ sql: "SELECT rev,saved_at FROM docs WHERE id=?", args: [siteId] });
  const row = rs.rows[0];
  return row ? { rev: String(row.rev), savedAt: Number(row.saved_at) } : null;
}

/** 競合のスナップショットは読み取りとして世代で守る。コミットした後の時刻の書き込みは、参考の情報にとどまる。 */
async function finishSave(db: Db, siteId: string, roomKey: string | null, result: SaveDocResult):
  Promise<SaveDocResult> {
  if (roomKey && result.kind === "conflict") {
    return await unchangedGeneration(db, siteId, roomKey) ? result : { kind: "missing" };
  }
  if (result.kind !== "saved") return result;
  try {
    if (!await recordSiteSavedAt(db, siteId, roomKey, result.savedAt)) return { kind: "missing" };
  } catch {
    // 文書のコミットは成功している。保存に失敗したと誤って報告しない。
  }
  return result;
}

/** サーバーの中の通知用。HTTP の応答や WebSocket のメッセージには、この包みを渡さない。 */
export interface ServerDocumentMutation {
  result: SaveDocResult;
  roomKey: string | null;
}

/** 保存先の世代を必要としない呼び出し元には、保存の結果だけを返す。 */
export async function saveSiteDocument(db: Db, siteId: string, raw: string, base: string | null, expectedRoomKey?: string):
  Promise<SaveDocResult> {
  return (await saveSiteDocumentWithTarget(db, siteId, raw, base, expectedRoomKey)).result;
}

export async function saveSiteDocumentWithTarget(db: Db, siteId: string, raw: string, base: string | null, expectedRoomKey?: string):
  Promise<ServerDocumentMutation> {
  const target = await forSite(db, siteId);
  // 初期保存の対象が消えたり作り直されたりしても、別の世代を初期化しない。
  if (target.kind === "missing" || expectedRoomKey !== undefined &&
      (target.kind !== "room" || target.roomKey !== expectedRoomKey)) {
    return { result: { kind: "missing" }, roomKey: null };
  }
  const result = target.kind === "room" ? await target.stub.replaceDocument(raw, base)
    : await saveLocalDocument(db, siteId, raw, base);
  const roomKey = target.kind === "room" ? target.roomKey : null;
  const finished = await finishSave(db, siteId, roomKey, result);
  return { result: finished, roomKey: finished.kind === "saved" ? roomKey : null };
}

export async function patchSiteDocument(db: Db, siteId: string, patch: DocPatch, base: string):
  Promise<SaveDocResult> {
  return (await patchSiteDocumentWithTarget(db, siteId, patch, base)).result;
}

export async function patchSiteDocumentWithTarget(db: Db, siteId: string, patch: DocPatch, base: string):
  Promise<ServerDocumentMutation> {
  const target = await forSite(db, siteId);
  if (target.kind === "missing") return { result: { kind: "missing" }, roomKey: null };
  const result = target.kind === "room" ? await target.stub.patchDocument(patch, base)
    : await patchLocalDocument(db, siteId, patch, base);
  const roomKey = target.kind === "room" ? target.roomKey : null;
  const finished = await finishSave(db, siteId, roomKey, result);
  return { result: finished, roomKey: finished.kind === "saved" ? roomKey : null };
}

/** 使われなくなった世代を封じて消す（日ごとのバックアップを含む）。 */
export async function eraseSiteDocument(roomKey: string | null): Promise<void> {
  if (roomKey) await byKey(roomKey)?.eraseDocument();
}

/**
 * 削除は、D1 でサイトを削除するトランザクションの中でキューに入れる。Durable Object の
 * 後始末に失敗したときは、次にサイトの一覧が要求されたときに再試行する。後始末が一時的に
 * できなくても、古いキーを再び使うことは無い。
 */
export async function cleanupAbandonedDocuments(db: Db, limit = 3): Promise<void> {
  if (db.backend !== "d1") return;
  const rows = await db.execute({
    sql: "SELECT room_key FROM document_room_cleanup ORDER BY queued_at LIMIT ?",
    args: [Math.min(10, Math.max(1, limit))],
  });
  for (const row of rows.rows) {
    const key = String(row.room_key);
    try {
      const stub = byKey(key);
      if (!stub) return; // バインディングが無い: 削除の記録のキューを残す
      await stub.eraseDocument();
      await db.execute({
        sql: "DELETE FROM document_room_cleanup WHERE room_key=?",
        args: [key],
      });
    } catch (error) {
      console.error("DocumentRoom cleanup failed", error);
    }
  }
}

export async function listSiteDocumentBackups(db: Db, siteId: string):
  Promise<Array<{ day: number; savedAt: number; bytes: number }>> {
  const target = await forSite(db, siteId);
  if (target.kind === "local") throw new Error("DO backup service is not available on local SQLite");
  if (target.kind === "missing") return [];
  const entries = await target.stub.listBackups();
  return await unchangedGeneration(db, siteId, target.roomKey) ? entries : [];
}

export async function readSiteDocumentBackup(db: Db, siteId: string, day: number):
  Promise<string | null> {
  const target = await forSite(db, siteId);
  if (target.kind === "local") throw new Error("DO backup service is not available on local SQLite");
  if (target.kind === "missing") return null;
  const body = await target.stub.readBackup(day);
  return await unchangedGeneration(db, siteId, target.roomKey) ? body : null;
}

export async function documentAssetReferences(db: Db, siteId: string):
  Promise<Array<{ path: string; bytes: number | null }>> {
  const target = await forSite(db, siteId);
  if (target.kind === "missing") return [];
  if (target.kind === "room") {
    const refs = await target.stub.listAssetReferences();
    return await unchangedGeneration(db, siteId, target.roomKey) ? refs : [];
  }
  const rs = await db.execute({
    sql: "SELECT json_extract(a.value, '$.path') AS path, json_extract(a.value, '$.bytes') AS bytes FROM docs d, json_each(d.body, '$.assets') a WHERE d.id=?",
    args: [siteId],
  });
  return rs.rows.filter(row => typeof row.path === "string").map(row => ({
    path: String(row.path), bytes: row.bytes == null ? null : Number(row.bytes),
  }));
}
