import type { Db } from "./db";
import type { KVLikeNamespace } from "./kv";
import { assetUploadedAt, planAssetGc, type GcCandidate } from "./asset-gc-plan";

/** GC only enumerates and deletes asset keys. */
export type AssetGcKv = Pick<KVLikeNamespace, "delete" | "list">;

/**
 * Deletion events register candidates immediately. The daily cron handles only
 * expired candidates; a separate weekly inventory discovers orphaned uploads
 * and assets of removed sites. Historical editor backups, GitHub history and
 * offline drafts are intentionally outside the seven-day retention policy.
 */
export interface AssetGcDocumentNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): { gcAssetReferences(): Promise<string[]> };
}

export interface AssetGcDependencies {
  db: Db;
  kv: AssetGcKv;
  rooms: AssetGcDocumentNamespace;
  now?: number;
  graceDays?: number;
  maxDeletes?: number;
  /** Explicit opt-in for physical deletion; the default is dry-run. */
  dryRun?: boolean;
  /** Weekly or manual reconciliation, not part of the daily scheduled sweep. */
  discoverUntracked?: boolean;
}

export interface AssetGcReport {
  status: "ok";
  dryRun: boolean;
  sweepSupported: true;
  kvKeysScanned: number;
  referenced: number;
  candidates: number;
  candidateBytesKnown: number;
  scanComplete: boolean;
  deleted: number;
  deletedBytesKnown: number;
  deletedPaths: string[];
  /** Eligible paths, subject to a final current-site reference recheck. */
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

/** Scan every site's current saved doc. Any RPC/generation failure aborts. */
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

/** Start/restart the seven-day clock when the editor explicitly removes an asset.
 * A failed save is harmless: the nightly sweep rechecks every current site.
 * DO NOT use this function during weekly inventory (which preserves the clock).
 */
export async function recordAssetGcCandidates(
  db: Db, paths: readonly string[], now = Date.now(),
): Promise<number> {
  if (db.backend !== "d1") return 0;
  if (!Number.isSafeInteger(now)) throw new RangeError("Invalid observation time");
  const valid = [...new Set(paths.filter(path =>
    typeof path === "string" && assetUploadedAt(path) !== null))];
  if (!valid.length) return 0;
  let registered = 0;
  // A single SQL statement records hundreds of paths without per-file D1 RPCs.
  for (let i = 0; i < valid.length; i += 200) {
    const rs = await db.execute({
      sql: `INSERT INTO asset_gc_candidates(path,first_unreferenced_at,last_seen_at,bytes)
        SELECT value, ?, ?, NULL FROM json_each(?) WHERE true
        ON CONFLICT(path) DO UPDATE SET
          first_unreferenced_at=excluded.first_unreferenced_at,
          last_seen_at=excluded.last_seen_at`,
      args: [now, now, JSON.stringify(valid.slice(i, i + 200))],
    });
    registered += rs.rowsAffected;
  }
  return registered;
}

async function finishRun(db: Db, id: number, fields: {
  status: "ok" | "aborted" | "failed";
  now: number; kvKeys: number; referenced: number; candidates: number;
  dryRun: boolean; deleted: number; deletedBytes: number;
  error?: string | null;
}) {
  await db.execute({
    sql: `UPDATE asset_gc_runs SET finished_at=?, status=?, kv_keys=?, referenced=?,
      candidates=?, deleted=?, deleted_bytes=?, dry_run=?, error=? WHERE id=?`,
    args: [fields.now, fields.status, fields.kvKeys, fields.referenced,
      fields.candidates, fields.deleted, fields.deletedBytes, fields.dryRun ? 1 : 0,
      fields.error ?? null, id],
  });
}

// Workers KV returns at most 1,000 keys per list call; one call per weekly run.
const PAGE_LIMIT = 1000;
const LEASE_MS = 20 * 60 * 1000;
const PREVIEW_LIMIT = 2000;
/**
 * Workers Free allows 1,000 subrequests to Cloudflare services (D1, KV, DO)
 * per invocation. Keep 10% for the caller (the admin route's auth checks).
 * Each physical delete costs a D1 recheck, a KV delete and a D1 delete, and
 * the run always needs its final count, run log and lease release.
 */
export const GC_INTERNAL_SUBREQUEST_BUDGET = 900;
const SUBREQUESTS_PER_DELETE = 3;
const SUBREQUESTS_TO_FINISH = 3;

/** Count every Cloudflare-service call so deletion stops inside the budget. */
function countSubrequests(db: Db, kv: AssetGcKv, rooms: AssetGcDocumentNamespace) {
  let used = 0;
  return {
    db: {
      backend: db.backend,
      execute: (stmt) => { used++; return db.execute(stmt); },
      batch: (stmts) => { used++; return db.batch(stmts); },
    } satisfies Db,
    // Call through the binding itself: platform bindings reject other receivers.
    kv: {
      delete: (key: string) => { used++; return kv.delete(key); },
      ...(kv.list ? { list: (options: Parameters<NonNullable<KVLikeNamespace["list"]>>[0]) => {
        used++; return kv.list!(options);
      } } : {}),
    } satisfies AssetGcKv,
    rooms: {
      idFromName: (name: string) => rooms.idFromName(name),
      get: (id: unknown) => {
        const stub = rooms.get(id);
        return { gcAssetReferences: () => { used++; return stub.gcAssetReferences(); } };
      },
    } satisfies AssetGcDocumentNamespace,
    used: () => used,
  };
}

function candidateFromRow(row: Record<string, unknown>): GcCandidate {
  const path = String(row.path);
  return {
    path,
    firstUnreferencedAt: Number(row.first_unreferenced_at),
    lastSeenAt: Number(row.last_seen_at),
    bytes: typeof row.bytes === "number" && Number.isSafeInteger(row.bytes)
      ? row.bytes : null,
  };
}

/** Scan one KV page for paths missed by client-side deletion events.
 * Called weekly (or explicitly by an administrator), never on daily Cron.
 */
async function discoverOrphans(
  db: Db, kv: AssetGcKv, refs: ReadonlySet<string>,
  now: number, token: string, state: Record<string, unknown>,
): Promise<{ scanned: number; complete: boolean }> {
  if (!kv.list) throw new AssetGcAbortedError("KV listing is unavailable");
  const previousCursor = typeof state.scan_cursor === "string" ? state.scan_cursor : "";
  const scanStarted = typeof state.scan_started_at === "number" && state.scan_started_at > 0
    ? state.scan_started_at : now;
  const page = await kv.list({ prefix: "assets/", limit: PAGE_LIMIT,
    ...(previousCursor ? { cursor: previousCursor } : {}) });
  if (!page || !Array.isArray(page.keys) || typeof page.list_complete !== "boolean") {
    throw new Error("Invalid KV listing response");
  }
  const seen = new Set<string>();
  const candidates: Array<{ path: string; bytes: number | null }> = [];
  // Every listed key belongs in the storage ledger, referenced or not.
  const objects: Array<{ path: string; bytes: number | null; uploadedAt: number }> = [];
  for (const item of page.keys) {
    const path = item?.name;
    if (typeof path !== "string" || !path.startsWith("assets/") || seen.has(path)) {
      throw new Error("Invalid KV key");
    }
    seen.add(path);
    const size = item.metadata?.bytes;
    const bytes = typeof size === "number" && Number.isSafeInteger(size) && size >= 0 ? size : null;
    const uploadedAt = assetUploadedAt(path);
    objects.push({ path, bytes, uploadedAt: uploadedAt ?? now });
    if (refs.has(path) || uploadedAt === null) continue;
    candidates.push({ path, bytes });
  }
  const next = page.list_complete ? null : (page.cursor ?? null);
  if (!page.list_complete && (!next || previousCursor === next)) {
    throw new Error("KV pagination did not advance");
  }
  // Inventory never resets the first-observation time from a delete action.
  // Candidate writes and cursor advancement are committed atomically.
  await db.batch([
    { sql: `INSERT INTO asset_gc_candidates(path,first_unreferenced_at,last_seen_at,bytes)
        SELECT json_extract(value,'$.path'), ?, ?, json_extract(value,'$.bytes')
        FROM json_each(?) WHERE true
        ON CONFLICT(path) DO UPDATE SET last_seen_at=excluded.last_seen_at,
          bytes=COALESCE(excluded.bytes,asset_gc_candidates.bytes)`,
      args: [now, now, JSON.stringify(candidates)] },
    { sql: `INSERT INTO asset_objects(path,bytes,uploaded_at,last_seen_at)
        SELECT json_extract(value,'$.path'), json_extract(value,'$.bytes'), json_extract(value,'$.uploadedAt'), ?
        FROM json_each(?) WHERE true
        ON CONFLICT(path) DO UPDATE SET last_seen_at=excluded.last_seen_at,
          bytes=COALESCE(excluded.bytes,asset_objects.bytes)`,
      args: [now, JSON.stringify(objects)] },
    { sql: `UPDATE asset_gc_state SET scan_cursor=?, scan_started_at=?
        WHERE id=1 AND lease_token=?`,
      args: [next, page.list_complete ? null : scanStarted, token] },
  ]);
  if (page.list_complete) {
    // Only completed inventories know which objects are no longer in KV.
    // New delete events and uploads after scan start must not be discarded.
    await db.batch([
      { sql: "DELETE FROM asset_gc_candidates WHERE last_seen_at < ? AND first_unreferenced_at < ?",
        args: [scanStarted, scanStarted] },
      { sql: "DELETE FROM asset_objects WHERE last_seen_at < ? AND uploaded_at < ?",
        args: [scanStarted, scanStarted] },
      // Keys that existed before the ledger may have been missed by a scan
      // that was already under way; only a later scan proves completeness.
      { sql: "UPDATE asset_ledger_state SET complete_at=? WHERE id=1 AND created_at <= ?",
        args: [now, scanStarted] },
    ]);
  }
  return { scanned: page.keys.length, complete: page.list_complete };
}

/** Run daily expiry cleanup; optionally reconcile a bounded KV page weekly.
 * Only expired candidates trigger a scan of all current site documents.
 * Failure to read any site aborts physical deletion.
 */
export async function runAssetGc({
  db: rawDb, kv: rawKv, rooms: rawRooms, now = Date.now(), graceDays, maxDeletes, dryRun = true,
  discoverUntracked = false,
}: AssetGcDependencies): Promise<AssetGcReport> {
  const { db, kv, rooms, used } = countSubrequests(rawDb, rawKv, rawRooms);
  if (db.backend !== "d1" || discoverUntracked && !kv.list) {
    throw new AssetGcAbortedError("Cloudflare storage is unavailable");
  }
  if (!Number.isSafeInteger(now) || typeof dryRun !== "boolean") {
    throw new RangeError("Invalid GC settings");
  }
  const grace = positiveInteger(graceDays, 7, 3650, "ASSET_GC_GRACE_DAYS") * 86_400_000;
  const max = positiveInteger(maxDeletes, 500, 500, "ASSET_GC_MAX_DELETES");
  const opened = await db.execute({
    sql: "INSERT INTO asset_gc_runs(started_at,status,dry_run) VALUES(?,'aborted',?) RETURNING id",
    args: [now, dryRun ? 1 : 0],
  });
  const id = Number(opened.rows[0]?.id);
  if (!Number.isSafeInteger(id)) throw new Error("Unable to log GC run");
  const token = crypto.randomUUID();
  let locked = false, scanned = 0, referencedCount = 0;
  let candidateCount = 0, deleted = 0, deletedBytesKnown = 0;
  let scanComplete = true;
  const deletedPaths: string[] = [];
  let stage: "start" | "references" | "inventory" | "sweep" | "finish" = "start";
  try {
    const lock = await db.execute({
      sql: `UPDATE asset_gc_state SET lease_until=?, lease_token=?
        WHERE id=1 AND lease_until < ? RETURNING scan_cursor,scan_started_at`,
      args: [now + LEASE_MS, token, now],
    });
    if (!lock.rows.length) throw new AssetGcAbortedError("Another GC run is in progress");
    locked = true;
    let refs: Set<string> | null = null;
    if (discoverUntracked) {
      stage = "references";
      try { refs = await collectAllAssetReferences(db, rooms); }
      catch { throw new AssetGcAbortedError("Unable to read current documents"); }
      referencedCount = refs.size;
      stage = "inventory";
      const inventory = await discoverOrphans(db, kv, refs, now, token, lock.rows[0]);
      scanned = inventory.scanned;
      scanComplete = inventory.complete;
    }
    // No KV.list on the daily route: only the oldest expired D1 candidates.
    const due = await db.execute({
      sql: `SELECT path,first_unreferenced_at,last_seen_at,bytes FROM asset_gc_candidates
        WHERE first_unreferenced_at <= ?
        ORDER BY first_unreferenced_at,path LIMIT ?`,
      args: [now - grace, PREVIEW_LIMIT + 1],
    });
    const limited = due.rows.slice(0, PREVIEW_LIMIT);
    const candidates = new Map<string, GcCandidate>(
      limited.map(row => [String(row.path), candidateFromRow(row)]));
    const plan = planAssetGc({
      kvKeys: limited.map(row => ({ name: String(row.path) })),
      candidates, referenced: new Set(), now, graceMs: grace, maxDeletes: max,
    });
    let eligible = plan.eligible;
    if (eligible.length) {
      stage = "references";
      // Required even in dry-run so administrators see only currently unused keys.
      // The weekly inventory just scanned every site in this run; reuse it to
      // save one Durable Object call per site. Deletion still rescans below.
      if (!refs) {
        try { refs = await collectAllAssetReferences(db, rooms); }
        catch { throw new AssetGcAbortedError("Unable to read current documents"); }
      }
      referencedCount = refs.size;
      const protectedNow = eligible.filter(item => refs!.has(item.path));
      if (protectedNow.length) {
        await db.execute({
          sql: "DELETE FROM asset_gc_candidates WHERE path IN (SELECT value FROM json_each(?))",
          args: [JSON.stringify(protectedNow.map(item => item.path))],
        });
      }
      eligible = eligible.filter(item => !refs!.has(item.path));
      if (!dryRun && eligible.length) {
        stage = "sweep";
        // Recheck after candidate selection and D1 writes, immediately before
        // the physical sweep. A site read failure prevents any new KV deletion.
        let lastRefs: Set<string>;
        try { lastRefs = await collectAllAssetReferences(db, rooms); }
        catch { throw new AssetGcAbortedError("Final reference scan failed"); }
        referencedCount = lastRefs.size;
        const recovered = eligible.filter(item => lastRefs.has(item.path));
        if (recovered.length) {
          await db.execute({
            sql: "DELETE FROM asset_gc_candidates WHERE path IN (SELECT value FROM json_each(?))",
            args: [JSON.stringify(recovered.map(item => item.path))],
          });
        }
        eligible = eligible.filter(item => !lastRefs.has(item.path));
        // KV deletion can outlive D1 logging. Retained candidates are safe to
        // retry because deleting an already-missing KV key is idempotent.
        // The site scans above cost one DO call per site, so the number of
        // deletes that fit depends on the deployment; stop before the limit.
        for (const item of eligible) {
          if (used() + SUBREQUESTS_PER_DELETE + SUBREQUESTS_TO_FINISH > GC_INTERNAL_SUBREQUEST_BUDGET) break;
          const check = await db.execute({
            sql: "SELECT first_unreferenced_at FROM asset_gc_candidates WHERE path=?",
            args: [item.path],
          });
          if (Number(check.rows[0]?.first_unreferenced_at) !== item.firstUnreferencedAt) continue;
          await kv.delete(item.path);
          deleted++;
          deletedBytesKnown += item.bytes ?? 0;
          deletedPaths.push(item.path);
          // One batch keeps the cost at three subrequests per delete.
          await db.batch([
            { sql: "DELETE FROM asset_gc_candidates WHERE path=? AND first_unreferenced_at=?",
              args: [item.path, item.firstUnreferencedAt] },
            { sql: "DELETE FROM asset_objects WHERE path=?", args: [item.path] },
          ]);
        }
      }
    }
    stage = "finish";
    const counts = await db.execute(
      "SELECT COUNT(*) AS total, COALESCE(SUM(bytes),0) AS bytes FROM asset_gc_candidates"
    );
    candidateCount = Number(counts.rows[0]?.total ?? 0);
    await finishRun(db, id, { status: "ok", now: Date.now(), kvKeys: scanned,
      referenced: referencedCount, candidates: candidateCount,
      dryRun, deleted, deletedBytes: deletedBytesKnown });
    return {
      status: "ok", dryRun, sweepSupported: true, kvKeysScanned: scanned,
      referenced: referencedCount, candidates: candidateCount,
      candidateBytesKnown: Number(counts.rows[0]?.bytes ?? 0),
      scanComplete, deleted, deletedBytesKnown, deletedPaths,
      potentialDeletePaths: eligible.map(item => item.path),
      potentialDeleteBytesKnown: eligible.reduce((sum, item) => sum + (item.bytes ?? 0), 0),
      previewTruncated: due.rows.length > PREVIEW_LIMIT || plan.remainingEligible > 0,
    };
  } catch (error) {
    const aborted = stage === "references" || error instanceof AssetGcAbortedError;
    await finishRun(db, id, { status: aborted ? "aborted" : "failed",
      now: Date.now(), kvKeys: scanned, referenced: referencedCount,
      candidates: candidateCount, dryRun, deleted, deletedBytes: deletedBytesKnown,
      error: aborted ? "Current-document scan or lease failed" : "KV inventory or sweep failed",
    }).catch(() => {});
    throw new AssetGcAbortedError(aborted ? "Asset GC safely aborted" : "Asset GC failed");
  } finally {
    if (locked) await db.execute({
      sql: "UPDATE asset_gc_state SET lease_until=0,lease_token=NULL WHERE id=1 AND lease_token=?",
      args: [token],
    }).catch(() => {});
  }
}
