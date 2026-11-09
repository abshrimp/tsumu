import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { Db } from "./db";
import type { DocPatch } from "./doc-patch";
import { getSiteRoomKey } from "./sites";
import {
  readCurrentDoc as readLocalDocument,
  saveCurrentDoc as saveLocalDocument,
  saveDocPatch as patchLocalDocument,
  type CurrentDoc, type SaveDocResult,
} from "./doc-storage";

/**
 * The site ID is a public identifier; the per-creation room key is private to
 * storage routing. Cloudflare uses row-structured DO SQLite, Node uses SQLite.
 * Neither backend reads data from the other backend's storage representation.
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
    return null; // Node/Docker environment
  }
  if (env.DB && !env.DOC_STORE) throw new Error("DOC_STORE binding is required");
  return (env.DOC_STORE as DocumentNamespace | undefined) ?? null;
}

function byKey(key: string): DocumentStub | null {
  const namespace = cloudNamespace();
  return namespace ? namespace.get(namespace.idFromName(key)) : null;
}

async function forSite(db: Db, siteId: string):
  Promise<{ stub: DocumentStub; roomKey: string } | null> {
  const namespace = cloudNamespace();
  if (!namespace) return null;
  const roomKey = await getSiteRoomKey(db, siteId);
  if (!roomKey) throw new Error("サイトの保存先が見つかりません");
  return { stub: namespace.get(namespace.idFromName(roomKey)), roomKey };
}

/** Revalidate the generation after an awaited RPC; a deleted site is not visible. */
async function unchangedGeneration(db: Db, siteId: string, roomKey: string): Promise<boolean> {
  return await getSiteRoomKey(db, siteId) === roomKey;
}

export function usesDocumentRooms(): boolean {
  return cloudNamespace() !== null;
}

export async function readSiteDocument(db: Db, siteId: string): Promise<CurrentDoc | null> {
  const target = await forSite(db, siteId);
  if (!target) return readLocalDocument(db, siteId);
  const doc = await target.stub.getSnapshot();
  return await unchangedGeneration(db, siteId, target.roomKey) ? doc : null;
}

export async function readSiteDocumentMeta(db: Db, siteId: string):
  Promise<{ rev: string; savedAt: number } | null> {
  const target = await forSite(db, siteId);
  if (target) {
    const meta = await target.stub.getMetadata();
    return await unchangedGeneration(db, siteId, target.roomKey) ? meta : null;
  }
  const rs = await db.execute({ sql: "SELECT rev,saved_at FROM docs WHERE id=?", args: [siteId] });
  const row = rs.rows[0];
  return row ? { rev: String(row.rev), savedAt: Number(row.saved_at) } : null;
}

/** A failed advisory timestamp update cannot undo a committed DO write. */
async function markEdited(db: Db, siteId: string, roomKey: string | null, result: SaveDocResult):
  Promise<SaveDocResult> {
  if (result.kind !== "saved") return result;
  try {
    const statement = roomKey
      ? { sql: `UPDATE sites SET updated_at=MAX(updated_at, ?) WHERE id=?
          AND EXISTS(SELECT 1 FROM site_document_rooms WHERE site_id=? AND room_key=?)`,
          args: [result.savedAt, siteId, siteId, roomKey] }
      : { sql: "UPDATE sites SET updated_at=MAX(updated_at, ?) WHERE id=?",
          args: [result.savedAt, siteId] };
    const rs = await db.execute(statement);
    if (!rs.rowsAffected) return { kind: "missing" };
  } catch {
    // The document commit succeeded; do not misreport it as an unsuccessful save.
  }
  return result;
}

export async function saveSiteDocument(db: Db, siteId: string, raw: string, base: string | null):
  Promise<SaveDocResult> {
  const target = await forSite(db, siteId);
  const result = target ? await target.stub.replaceDocument(raw, base)
    : await saveLocalDocument(db, siteId, raw, base);
  return markEdited(db, siteId, target?.roomKey ?? null, result);
}

export async function patchSiteDocument(db: Db, siteId: string, patch: DocPatch, base: string):
  Promise<SaveDocResult> {
  const target = await forSite(db, siteId);
  const result = target ? await target.stub.patchDocument(patch, base)
    : await patchLocalDocument(db, siteId, patch, base);
  return markEdited(db, siteId, target?.roomKey ?? null, result);
}

/** Seal and clear an obsolete generation, including its daily backups. */
export async function eraseSiteDocument(roomKey: string | null): Promise<void> {
  if (roomKey) await byKey(roomKey)?.eraseDocument();
}

/**
 * Deletions are queued within the D1 site-delete transaction. Failed DO
 * cleanup is retried on subsequent site-list requests; the old key is never
 * reusable even if cleanup is temporarily unavailable.
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
      if (!stub) return; // missing binding: retain tombstone queue
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
  if (!target) throw new Error("DO backup service is not available on local SQLite");
  const entries = await target.stub.listBackups();
  return await unchangedGeneration(db, siteId, target.roomKey) ? entries : [];
}

export async function readSiteDocumentBackup(db: Db, siteId: string, day: number):
  Promise<string | null> {
  const target = await forSite(db, siteId);
  if (!target) throw new Error("DO backup service is not available on local SQLite");
  const body = await target.stub.readBackup(day);
  return await unchangedGeneration(db, siteId, target.roomKey) ? body : null;
}

export async function documentAssetReferences(db: Db, siteId: string):
  Promise<Array<{ path: string; bytes: number | null }>> {
  const target = await forSite(db, siteId);
  if (target) {
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
