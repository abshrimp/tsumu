import type { Db } from "./db";
import type { KVLikeNamespace } from "./kv";
import { planAssetGc, type GcCandidate } from "./asset-gc-plan";

/**
 * Non-destructive Workers KV inventory. Never call KV.delete() here.
 *
 * Cloudflare documents live in DO SQLite while published doc.json snapshots
 * can be restored from GitHub at any time. There is no transaction that fences
 * new DO writes against KV deletion. Until both histories and concurrent
 * writes are protected, these candidates are telemetry, not deletion permits.
 */
export interface AssetGcDocumentNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): { gcAssetReferences(): Promise<string[]> };
}

export interface AssetGcDependencies {
  db: Db;
  kv: KVLikeNamespace;
  rooms: AssetGcDocumentNamespace;
  now?: number;
  graceDays?: number;
  maxDeletes?: number;
}

export interface AssetGcReport {
  status: "ok";
  dryRun: true;
  sweepSupported: false;
  kvKeysScanned: number;
  referenced: number;
  candidates: number;
  candidateBytesKnown: number;
  scanComplete: boolean;
  /** Only a bounded, tentative preview. Not permission to delete. */
  potentialDeletePaths: string[];
  potentialDeleteBytesKnown: number;
  previewTruncated: boolean;
}

export class AssetGcAbortedError extends Error {
  constructor(message: string) { super(message); this.name = "AssetGcAbortedError"; }
}

function positiveInteger(value: number | undefined, fallback: number, max: number, name: string): number {
  const n = value ?? fallback;
  if (!Number.isSafeInteger(n) || n < 1 || n > max) throw new RangeError("Invalid " + name);
  return n;
}

type SiteRoom = { site: string; key: string };
async function siteRoomMapping(db: Db): Promise<SiteRoom[]> {
  const rs = await db.execute(
    "SELECT s.id AS site, r.room_key AS room_key FROM sites s LEFT JOIN site_document_rooms r ON r.site_id=s.id ORDER BY s.id"
  );
  return rs.rows.map(row => {
    if (typeof row.site !== "string" || typeof row.room_key !== "string" || !row.room_key) {
      throw new AssetGcAbortedError("Site has no readable document room");
    }
    return { site: row.site, key: row.room_key };
  });
}

/** Read every current DO document and every restorable daily backup.
 * Never return a partial Set on failure or if a site's generation changed.
 */
export async function collectAllAssetReferences(
  db: Db, rooms: AssetGcDocumentNamespace,
): Promise<Set<string>> {
  if (db.backend !== "d1") throw new AssetGcAbortedError("Cloudflare D1 required");
  const before = await siteRoomMapping(db);
  const referenced = new Set<string>();
  for (let offset = 0; offset < before.length; offset += 4) {
    const chunk = before.slice(offset, offset + 4);
    const refs = await Promise.all(chunk.map(async ({ key }) =>
      rooms.get(rooms.idFromName(key)).gcAssetReferences()
    ));
    for (const paths of refs) {
      if (!Array.isArray(paths) || paths.some(path =>
        typeof path !== "string" || !path.startsWith("assets/"))) {
        throw new AssetGcAbortedError("Invalid document reference response");
      }
      for (const path of paths) referenced.add(path);
    }
  }
  const after = await siteRoomMapping(db);
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    throw new AssetGcAbortedError("Site list or document generation changed during scan");
  }
  return referenced;
}

async function finishRun(db: Db, id: number, fields: {
  status: "ok" | "aborted" | "failed";
  now: number; kvKeys: number; referenced: number; candidates: number;
  error?: string | null;
}) {
  await db.execute({
    sql: `UPDATE asset_gc_runs SET finished_at=?, status=?, kv_keys=?, referenced=?,
      candidates=?, deleted=0, deleted_bytes=0, dry_run=1, error=? WHERE id=?`,
    args: [fields.now, fields.status, fields.kvKeys, fields.referenced,
      fields.candidates, fields.error ?? null, id],
  });
}

const PAGE_LIMIT = 500;
const PAGES_PER_INVOCATION = 2;
const PREVIEW_LIMIT = 2000;
const LEASE_MS = 20 * 60 * 1000;

/** Continues a KV inventory cursor from D1. It cannot delete any KV object. */
export async function runAssetGc({
  db, kv, rooms, now = Date.now(), graceDays, maxDeletes,
}: AssetGcDependencies): Promise<AssetGcReport> {
  if (db.backend !== "d1" || !kv.list) throw new AssetGcAbortedError("D1 and Workers KV list binding required");
  if (!Number.isSafeInteger(now)) throw new RangeError("Invalid clock");
  const grace = positiveInteger(graceDays, 30, 3650, "ASSET_GC_GRACE_DAYS") * 86_400_000;
  const max = positiveInteger(maxDeletes, 500, 500, "ASSET_GC_MAX_DELETES");
  const opened = await db.execute({
    sql: "INSERT INTO asset_gc_runs(started_at,status,dry_run) VALUES(?,'aborted',1) RETURNING id",
    args: [now],
  });
  const id = Number(opened.rows[0]?.id);
  if (!Number.isSafeInteger(id)) throw new Error("Unable to log GC run");
  const token = crypto.randomUUID();
  let locked = false, scanned = 0, referencedCount = 0, candidateCount = 0;
  let stage: "collect" | "list" | "summary" = "collect";
  try {
    const lock = await db.execute({
      sql: `UPDATE asset_gc_state SET lease_until=?, lease_token=?
        WHERE id=1 AND lease_until < ? RETURNING scan_cursor, scan_started_at`,
      args: [now + LEASE_MS, token, now],
    });
    if (!lock.rows.length) throw new AssetGcAbortedError("Another GC inventory is running");
    locked = true;
    // A failed DO read aborts before any KV listing or candidate writes.
    const refs = await collectAllAssetReferences(db, rooms);
    referencedCount = refs.size;
    stage = "list";
    const start = lock.rows[0];
    let cursor = typeof start.scan_cursor === "string" ? start.scan_cursor : "";
    const scanStarted = typeof start.scan_started_at === "number" && start.scan_started_at > 0
      ? start.scan_started_at : now;
    let scanComplete = false;
    for (let pageIndex = 0; pageIndex < PAGES_PER_INVOCATION; pageIndex++) {
      const page = await kv.list({ prefix: "assets/", limit: PAGE_LIMIT, ...(cursor ? { cursor } : {}) });
      if (!page || !Array.isArray(page.keys) || typeof page.list_complete !== "boolean") {
        throw new Error("Invalid KV listing response");
      }
      const used = new Set<string>();
      const unreferenced: Array<{ path: string; bytes: number | null }> = [];
      const protectedPaths: string[] = [];
      for (const item of page.keys) {
        const path = item?.name;
        if (typeof path !== "string" || !path.startsWith("assets/") || used.has(path)) {
          throw new Error("Invalid or duplicated KV key");
        }
        used.add(path);
        if (refs.has(path)) {
          protectedPaths.push(path);
        } else {
          const bytes = item.metadata?.bytes;
          unreferenced.push({
            path,
            bytes: typeof bytes === "number" && Number.isSafeInteger(bytes) && bytes >= 0 ? bytes : null,
          });
        }
      }
      scanned += page.keys.length;
      scanComplete = page.list_complete;
      const next = scanComplete ? null : (page.cursor ?? null);
      if (!scanComplete && (!next || next === cursor)) throw new Error("KV pagination did not advance");
      // Candidate writes and the cursor are committed in one D1 transaction.
      await db.batch([
        {
          sql: `INSERT INTO asset_gc_candidates(path,first_unreferenced_at,last_seen_at,bytes)
            SELECT json_extract(value,'$.path'), ?, ?, json_extract(value,'$.bytes')
              FROM json_each(?) WHERE true
            ON CONFLICT(path) DO UPDATE SET last_seen_at=excluded.last_seen_at,
              bytes=COALESCE(excluded.bytes,asset_gc_candidates.bytes)`,
          args: [now, now, JSON.stringify(unreferenced)],
        },
        {
          sql: "DELETE FROM asset_gc_candidates WHERE path IN (SELECT value FROM json_each(?))",
          args: [JSON.stringify(protectedPaths)],
        },
        {
          sql: `UPDATE asset_gc_state SET scan_cursor=?, scan_started_at=?
            WHERE id=1 AND lease_token=?`,
          args: [next, scanComplete ? null : scanStarted, token],
        },
      ]);
      if (scanComplete) {
        // Remove candidates not observed in this completed scan. This is only
        // book-keeping: KV contents are never changed.
        await db.execute({
          sql: "DELETE FROM asset_gc_candidates WHERE last_seen_at < ?",
          args: [scanStarted],
        });
        break;
      }
      cursor = next!;
    }
    stage = "summary";
    const counts = await db.execute(
      "SELECT COUNT(*) AS total, COALESCE(SUM(bytes),0) AS bytes FROM asset_gc_candidates"
    );
    candidateCount = Number(counts.rows[0]?.total ?? 0);
    const rows = await db.execute({
      sql: "SELECT path,first_unreferenced_at,last_seen_at,bytes FROM asset_gc_candidates ORDER BY first_unreferenced_at,path LIMIT ?",
      args: [PREVIEW_LIMIT + 1],
    });
    const limited = rows.rows.slice(0, PREVIEW_LIMIT);
    const candidates = new Map<string, GcCandidate>(limited.map(row => {
      const path = String(row.path);
      return [path, {
        path,
        firstUnreferencedAt: Number(row.first_unreferenced_at),
        lastSeenAt: Number(row.last_seen_at),
        bytes: row.bytes === null ? null : Number(row.bytes),
      }];
    }));
    const planned = planAssetGc({
      kvKeys: limited.map(row => ({ name: String(row.path), bytes: row.bytes as number | null })),
      candidates, referenced: refs, now, graceMs: grace, maxDeletes: max,
    });
    await finishRun(db, id, {
      status: "ok", now: Date.now(), kvKeys: scanned,
      referenced: referencedCount, candidates: candidateCount,
    });
    // A partial scan cannot report deletion candidates as eligible.
    const eligible = scanComplete ? planned.eligible : [];
    return {
      status: "ok", dryRun: true, sweepSupported: false,
      kvKeysScanned: scanned, referenced: referencedCount,
      candidates: candidateCount, candidateBytesKnown: Number(counts.rows[0]?.bytes ?? 0),
      scanComplete, potentialDeletePaths: eligible.map(c => c.path),
      potentialDeleteBytesKnown: eligible.reduce((sum, c) => sum + (c.bytes ?? 0), 0),
      previewTruncated: rows.rows.length > PREVIEW_LIMIT || planned.remainingEligible > 0,
    };
  } catch (error) {
    const aborted = stage === "collect" || error instanceof AssetGcAbortedError;
    await finishRun(db, id, {
      status: aborted ? "aborted" : "failed", now: Date.now(),
      kvKeys: scanned, referenced: referencedCount, candidates: candidateCount,
      error: aborted ? "Reference scan or exclusive lease unavailable" : "KV inventory or D1 update failed",
    }).catch(() => {});
    throw new AssetGcAbortedError(aborted ? "Asset GC safely aborted" : "Asset GC inventory failed");
  } finally {
    if (locked) await db.execute({
      sql: "UPDATE asset_gc_state SET lease_until=0,lease_token=NULL WHERE id=1 AND lease_token=?",
      args: [token],
    }).catch(() => {});
  }
}
