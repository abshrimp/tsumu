import type { Db } from "./db";

/**
 * D1 ledger of the files stored in Workers KV (`asset_objects`).
 *
 * The asset tab's storage meter reads this instead of adding up the files the
 * site documents reference, because KV also holds files that no document
 * references any more: removed assets waiting for GC, failed uploads and the
 * files of deleted sites.
 */

/** Paths with unknown size returned to the browser, which may know their size. */
const UNKNOWN_PATHS_LIMIT = 1000;

export interface AssetLedgerSummary {
  /** Every key has been listed at least once since the ledger was created. */
  complete: boolean;
  count: number;
  /** Sum of known sizes. */
  bytes: number;
  /** Files whose size is unknown (uploaded before sizes were recorded). */
  unknownCount: number;
  unknownPaths: string[];
  /** Files registered for deletion by GC (removed from the editor). */
  pendingCount: number;
  pendingBytes: number;
}

/** Record an upload. Failure is repaired by the weekly KV inventory. */
export async function recordUploadedAsset(db: Db, path: string, bytes: number, now = Date.now()): Promise<void> {
  if (db.backend !== "d1") return;
  await db.execute({
    sql: `INSERT INTO asset_objects(path,bytes,uploaded_at,last_seen_at) VALUES(?,?,?,?)
      ON CONFLICT(path) DO UPDATE SET bytes=excluded.bytes`,
    args: [path, bytes, now, now],
  });
}

export async function readAssetLedger(db: Db): Promise<AssetLedgerSummary | null> {
  if (db.backend !== "d1") return null;
  const [totals, state, unknown] = await db.batch([
    `SELECT COUNT(*) AS n, COALESCE(SUM(o.bytes),0) AS bytes,
      COALESCE(SUM(o.bytes IS NULL),0) AS unknown,
      COUNT(c.path) AS pending, COALESCE(SUM(CASE WHEN c.path IS NOT NULL THEN o.bytes END),0) AS pending_bytes
      FROM asset_objects o LEFT JOIN asset_gc_candidates c ON c.path=o.path`,
    "SELECT complete_at FROM asset_ledger_state WHERE id=1",
    { sql: "SELECT path FROM asset_objects WHERE bytes IS NULL ORDER BY path LIMIT ?", args: [UNKNOWN_PATHS_LIMIT] },
  ]);
  const row = totals.rows[0] ?? {};
  return {
    complete: state.rows[0]?.complete_at != null,
    count: Number(row.n ?? 0),
    bytes: Number(row.bytes ?? 0),
    unknownCount: Number(row.unknown ?? 0),
    unknownPaths: unknown.rows.map(r => String(r.path)),
    pendingCount: Number(row.pending ?? 0),
    pendingBytes: Number(row.pending_bytes ?? 0),
  };
}
