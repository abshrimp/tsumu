import type { Db } from "./db";
import type { KVLikeNamespace } from "./kv";
import { assetUploadedAt } from "./asset-gc-plan";
import { AssetGcAbortedError, collectAllAssetReferences, type AssetGcDocumentNamespace } from "./asset-gc";

const LEASE_MS = 20 * 60 * 1000;

type PermanentTrashResult = "deleted" | "missing" | "in-use" | "busy";

/**
 * Permanently remove exactly one trashed object. Share the existing GC lease
 * with the scheduled sweep, and fail closed when any site cannot be inspected.
 * The seven-day timer is not consulted for this explicitly requested action.
 */
export async function permanentlyDeleteTrashedAsset({
  db, kv, rooms, path, now = Date.now(),
}: {
  db: Db;
  kv: Pick<KVLikeNamespace, "delete">;
  rooms: AssetGcDocumentNamespace;
  path: string;
  now?: number;
}): Promise<PermanentTrashResult> {
  if (db.backend !== "d1") throw new AssetGcAbortedError("Cloudflare D1 required");
  if (assetUploadedAt(path) === null || !Number.isSafeInteger(now)) throw new RangeError("Invalid asset deletion request");
  const token = crypto.randomUUID();
  const acquired = await db.execute({
    sql: `UPDATE asset_gc_state SET lease_until=?,lease_token=?
      WHERE id=1 AND lease_until < ? RETURNING id`,
    args: [now + LEASE_MS, token, now],
  });
  if (!acquired.rows.length) return "busy";
  try {
    const candidate = await db.execute({
      sql: "SELECT first_unreferenced_at FROM asset_gc_candidates WHERE path=? LIMIT 1",
      args: [path],
    });
    if (!candidate.rows.length) return "missing";
    const firstUnreferencedAt = Number(candidate.rows[0].first_unreferenced_at);
    if (!Number.isSafeInteger(firstUnreferencedAt)) throw new AssetGcAbortedError("Invalid trash candidate");

    // An asset might be shared by a different site or reintroduced by an Undo.
    // Check every current document; an unreadable site is not permission to delete.
    if ((await collectAllAssetReferences(db, rooms)).has(path)) return "in-use";
    // The first scan can take several RPCs; repeat immediately before deleting.
    if ((await collectAllAssetReferences(db, rooms)).has(path)) return "in-use";

    // The lease may have expired during a large scan, or the same asset may have
    // been moved back into trash. Neither case may delete a newly used object.
    const ready = await db.execute({
      sql: `SELECT c.first_unreferenced_at
        FROM asset_gc_candidates c JOIN asset_gc_state s ON s.id=1
        WHERE c.path=? AND s.lease_token=? AND s.lease_until > ? LIMIT 1`,
      args: [path, token, Date.now()],
    });
    if (!ready.rows.length || Number(ready.rows[0].first_unreferenced_at) !== firstUnreferencedAt)
      return "missing";

    await kv.delete(path);
    // If D1 cleanup fails, the scheduled sweep can safely retry deletion.
    await db.batch([
      { sql: "DELETE FROM asset_gc_candidates WHERE path=? AND first_unreferenced_at=?",
        args: [path, firstUnreferencedAt] },
      { sql: "DELETE FROM asset_objects WHERE path=?", args: [path] },
    ]);
    return "deleted";
  } finally {
    await db.execute({
      sql: "UPDATE asset_gc_state SET lease_until=0,lease_token=NULL WHERE id=1 AND lease_token=?",
      args: [token],
    }).catch(() => {});
  }
}
