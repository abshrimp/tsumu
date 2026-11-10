import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { assetUploadedAt, extractAssetReferences, planAssetGc } from "../lib/asset-gc-plan";
import { recordAssetGcCandidates, runAssetGc, type AssetGcDocumentNamespace } from "../lib/asset-gc";
import type { Db } from "../lib/db";
import type { KVLikeNamespace } from "../lib/kv";

const day = 86_400_000;
const now = Date.UTC(2026, 10, 10);
const key = (ageDays: number, suffix = "image.png") =>
  `assets/${(now - ageDays * day).toString(36)}abcdef-${suffix}`;

test("asset GC finds paths in nested doc HTML/CSS and encoded image URLs", () => {
  const a = key(60), b = key(45), c = key(90);
  const raw = JSON.stringify({
    assets: { first: { path: a } },
    nodes: { one: { styles: `url(/api/assets/file?path=${encodeURIComponent(b)})` } },
    customHtml: `<img src="/api/assets/file?path=${encodeURIComponent(encodeURIComponent(c))}">`,
  });
  const refs = extractAssetReferences(raw);
  // Conservatively retaining incidental URL segments (e.g. assets/file in
  // /api/assets/file) is harmless; losing a real reference is not.
  for (const path of [a, b, c]) assert.equal(refs.has(path), true);
  assert.throws(() => extractAssetReferences("{broken"));
});

test("asset GC requires both unreferenced and upload age to exceed grace", () => {
  const old = key(100), recent = key(4), used = key(80);
  const unknown = "assets/preexisting.png";
  const candidates = new Map([old, recent, used, unknown].map(path =>
    [path, { path, firstUnreferencedAt: now - 50 * day }] as const));
  const planned = planAssetGc({
    kvKeys: [old, recent, used, unknown].map(name => ({ name })),
    referenced: new Set([used]),
    candidates, now, graceMs: 30 * day, maxDeletes: 500,
  });
  assert.deepEqual(planned.eligible.map(c => c.path), [old]);
  assert.deepEqual(planned.release, [used]);
  assert.equal(assetUploadedAt(unknown), null);
  assert.equal(assetUploadedAt(old), now - 100 * day);
});

test("GC candidate reset, missing KV cleanup, grace period, and maximum delete cap", () => {
  const a = key(90, "a.png"), b = key(100, "b.png"), missing = key(110, "missing.png");
  const candidates = new Map([a, b, missing].map(path =>
    [path, { path, firstUnreferencedAt: now - 31 * day }] as const));
  const plan = planAssetGc({
    kvKeys: [{ name: a }, { name: b }, { name: key(1) }],
    referenced: new Set<string>(), candidates, now, graceMs: 30 * day, maxDeletes: 1,
  });
  assert.equal(plan.eligible.length, 1);
  assert.equal(plan.remainingEligible, 1);
  assert.ok(plan.release.includes(missing));
  assert.equal(plan.add.length, 1);
  const reset = planAssetGc({
    kvKeys: [{ name: a }], referenced: new Set([a]),
    candidates, now, graceMs: 30 * day, maxDeletes: 10,
  });
  assert.deepEqual(reset.eligible, []);
  assert.ok(reset.release.includes(a));
});

function fixture(roomRefs: (key: string) => Promise<string[]>, keys: string[]) {
  const sql = new DatabaseSync(":memory:");
  sql.exec(`
    CREATE TABLE sites(id TEXT PRIMARY KEY);
    CREATE TABLE site_document_rooms(site_id TEXT PRIMARY KEY,room_key TEXT NOT NULL);
    CREATE TABLE asset_gc_state(
      id INTEGER PRIMARY KEY,scan_cursor TEXT,scan_started_at INTEGER,
      lease_until INTEGER NOT NULL DEFAULT 0,lease_token TEXT
    );
    INSERT INTO asset_gc_state(id) VALUES(1);
    CREATE TABLE asset_gc_candidates(
      path TEXT PRIMARY KEY,first_unreferenced_at INTEGER NOT NULL,last_seen_at INTEGER NOT NULL,bytes INTEGER
    );
    CREATE TABLE asset_gc_runs(
      id INTEGER PRIMARY KEY AUTOINCREMENT,started_at INTEGER NOT NULL,finished_at INTEGER,
      status TEXT NOT NULL,kv_keys INTEGER NOT NULL DEFAULT 0,referenced INTEGER NOT NULL DEFAULT 0,
      candidates INTEGER NOT NULL DEFAULT 0,deleted INTEGER NOT NULL DEFAULT 0,
      deleted_bytes INTEGER NOT NULL DEFAULT 0,dry_run INTEGER NOT NULL DEFAULT 1,error TEXT
    );
    INSERT INTO sites(id) VALUES('site1');
    INSERT INTO site_document_rooms(site_id,room_key) VALUES('site1','room1');
  `);
  const execute = async (input: string | { sql: string; args: (string | number | null)[] }) => {
    const query = typeof input === "string" ? input : input.sql;
    const args = typeof input === "string" ? [] : input.args;
    const stmt = sql.prepare(query);
    if (stmt.columns().length) return { rows: stmt.all(...args) as Record<string, unknown>[], rowsAffected: 0 };
    return { rows: [] as Record<string, unknown>[], rowsAffected: Number(stmt.run(...args).changes) };
  };
  const db: Db = {
    backend: "d1", execute,
    async batch(stmts) {
      sql.exec("BEGIN");
      try {
        const results = [];
        for (const s of stmts) results.push(await execute(s));
        sql.exec("COMMIT");
        return results;
      } catch (error) {
        sql.exec("ROLLBACK");
        throw error;
      }
    },
  };
  let lists = 0, deletes = 0, failDeleteAt = Number.POSITIVE_INFINITY;
  const stored = new Set(keys);
  const kv = {
    async list() {
      lists++;
      return { keys: [...stored].map(name => ({ name, metadata: { bytes: 17 } })), list_complete: true };
    },
    async delete(path: string) {
      deletes++;
      if (deletes === failDeleteAt) throw new Error("Simulated KV failure");
      stored.delete(path);
    },
  } as unknown as KVLikeNamespace;
  const rooms: AssetGcDocumentNamespace = {
    idFromName: name => name,
    get(id) { return { gcAssetReferences: () => roomRefs(String(id)) }; },
  };
  return {
    db, kv, rooms, sql, lists: () => lists, deletes: () => deletes,
    stored, failDeleteAt: (n: number) => { failDeleteAt = n; },
  };
}

test("GC dry-run retains an asset referenced by a current document", async () => {
  const path = key(100);
  const f = fixture(async () => [path], [path]);
  try {
    f.sql.prepare("INSERT INTO asset_gc_candidates VALUES(?,?,?,?)")
      .run(path, now - 9 * day, now - day, 17);
    const report = await runAssetGc({ db: f.db, kv: f.kv, rooms: f.rooms, now });
    assert.deepEqual(report.potentialDeletePaths, []);
    assert.equal(report.candidates, 0);
    assert.equal(f.deletes(), 0);
    assert.equal(Number(f.sql.prepare("SELECT deleted FROM asset_gc_runs").get()?.deleted), 0);
  } finally { f.sql.close(); }
});

test("weekly discovery aborts before KV listing if a site cannot be read", async () => {
  const f = fixture(async () => { throw new Error("Current doc unreadable"); }, [key(100)]);
  try {
    await assert.rejects(runAssetGc({ db: f.db, kv: f.kv, rooms: f.rooms, now,
      discoverUntracked: true }));
    assert.equal(f.lists(), 0);
    assert.equal(f.deletes(), 0);
    assert.equal(Number(f.sql.prepare("SELECT count(*) AS n FROM asset_gc_candidates").get()?.n), 0);
    assert.equal(f.sql.prepare("SELECT status FROM asset_gc_runs").get()?.status, "aborted");
  } finally { f.sql.close(); }
});

test("mature candidates appear in dry-run without being deleted", async () => {
  const path = key(100);
  const f = fixture(async () => [], [path]);
  try {
    f.sql.prepare("INSERT INTO asset_gc_candidates VALUES(?,?,?,?)")
      .run(path, now - 40 * day, now - day, 17);
    const report = await runAssetGc({ db: f.db, kv: f.kv, rooms: f.rooms, now });
    assert.deepEqual(report.potentialDeletePaths, [path]);
    assert.equal(report.potentialDeleteBytesKnown, 17);
    assert.equal(report.sweepSupported, true);
    assert.equal(f.deletes(), 0);
  } finally { f.sql.close(); }
});

test("seven days after becoming unreferenced, active GC deletes a mature KV key", async () => {
  const path = key(30);
  const f = fixture(async () => [], [path]);
  try {
    f.sql.prepare("INSERT INTO asset_gc_candidates VALUES(?,?,?,?)")
      .run(path, now - 8 * day, now - day, 17);
    const report = await runAssetGc({ db: f.db, kv: f.kv, rooms: f.rooms, now, dryRun: false });
    assert.equal(report.deleted, 1);
    assert.equal(report.deletedBytesKnown, 17);
    assert.deepEqual(report.deletedPaths, [path]);
    assert.equal(report.candidates, 0);
    assert.equal(f.stored.has(path), false);
    assert.equal(f.sql.prepare("SELECT deleted FROM asset_gc_runs").get()?.deleted, 1);
    assert.equal(f.sql.prepare("SELECT dry_run FROM asset_gc_runs").get()?.dry_run, 0);
  } finally { f.sql.close(); }
});

test("recent uploads and newly unreferenced assets are never deleted", async () => {
  const recent = key(2), old = key(100);
  const f = fixture(async () => [], [recent, old]);
  try {
    f.sql.prepare("INSERT INTO asset_gc_candidates VALUES(?,?,?,?)")
      .run(recent, now - 10 * day, now - day, 17);
    f.sql.prepare("INSERT INTO asset_gc_candidates VALUES(?,?,?,?)")
      .run(old, now - 6 * day, now - day, 17);
    const report = await runAssetGc({ db: f.db, kv: f.kv, rooms: f.rooms, now, dryRun: false });
    assert.equal(report.deleted, 0);
    assert.deepEqual([...f.stored].sort(), [recent, old].sort());
  } finally { f.sql.close(); }
});

test("a newly added current-document reference cancels deletion during final recheck", async () => {
  const path = key(100);
  let reads = 0;
  const f = fixture(async () => ++reads === 1 ? [] : [path], [path]);
  try {
    f.sql.prepare("INSERT INTO asset_gc_candidates VALUES(?,?,?,?)")
      .run(path, now - 9 * day, now - day, 17);
    const report = await runAssetGc({ db: f.db, kv: f.kv, rooms: f.rooms, now, dryRun: false });
    assert.equal(reads, 2);
    assert.equal(report.deleted, 0);
    assert.equal(f.deletes(), 0);
    assert.ok(f.stored.has(path));
    assert.equal(f.sql.prepare("SELECT count(*) AS n FROM asset_gc_candidates").get()?.n, 0);
  } finally { f.sql.close(); }
});

test("failure to inspect any current doc during final recheck aborts before deleting", async () => {
  const path = key(100);
  let reads = 0;
  const f = fixture(async () => {
    if (++reads === 2) throw new Error("DO unavailable");
    return [];
  }, [path]);
  try {
    f.sql.prepare("INSERT INTO asset_gc_candidates VALUES(?,?,?,?)")
      .run(path, now - 9 * day, now - day, 17);
    await assert.rejects(runAssetGc({ db: f.db, kv: f.kv, rooms: f.rooms, now, dryRun: false }));
    assert.equal(f.deletes(), 0);
    assert.equal(f.sql.prepare("SELECT status FROM asset_gc_runs").get()?.status, "aborted");
  } finally { f.sql.close(); }
});

test("incomplete weekly KV inventory does not block daily expiry cleanup", async () => {
  const path = key(100);
  const f = fixture(async () => [], [path]);
  try {
    f.sql.prepare("INSERT INTO asset_gc_candidates VALUES(?,?,?,?)")
      .run(path, now - 9 * day, now - day, 17);
    let pageNumber = 0;
    f.kv.list = async () => ({
      keys: pageNumber++ === 0 ? [{ name: path, metadata: { bytes: 17 } }] : [],
      list_complete: false, cursor: "cursor-" + pageNumber,
    });
    const report = await runAssetGc({ db: f.db, kv: f.kv, rooms: f.rooms, now,
      dryRun: false, discoverUntracked: true });
    assert.equal(report.scanComplete, false);
    assert.equal(report.deleted, 1);
    assert.equal(f.stored.has(path), false);
  } finally { f.sql.close(); }
});

test("configured delete cap leaves other eligible keys for later GC runs", async () => {
  const keys = [key(100, "one.png"), key(100, "two.png"), key(100, "three.png")];
  const f = fixture(async () => [], keys);
  try {
    for (const path of keys) f.sql.prepare("INSERT INTO asset_gc_candidates VALUES(?,?,?,?)")
      .run(path, now - 9 * day, now - day, 17);
    const report = await runAssetGc({ db: f.db, kv: f.kv, rooms: f.rooms, now, dryRun: false, maxDeletes: 1 });
    assert.equal(report.deleted, 1);
    assert.equal(f.stored.size, 2);
    assert.equal(report.candidates, 2);
  } finally { f.sql.close(); }
});

test("a failed KV delete records previously completed deletes and retains later candidates", async () => {
  const paths = [key(100, "first.png"), key(100, "second.png")];
  const f = fixture(async () => [], paths);
  f.failDeleteAt(2);
  try {
    for (const path of paths) f.sql.prepare("INSERT INTO asset_gc_candidates VALUES(?,?,?,?)")
      .run(path, now - 9 * day, now - day, 17);
    await assert.rejects(runAssetGc({ db: f.db, kv: f.kv, rooms: f.rooms, now, dryRun: false }));
    const run = f.sql.prepare("SELECT status,deleted,deleted_bytes FROM asset_gc_runs").get();
    assert.equal(run?.status, "failed");
    assert.equal(run?.deleted, 1);
    assert.equal(run?.deleted_bytes, 17);
    assert.equal(f.stored.size, 1);
  } finally { f.sql.close(); }
});
test("the image-delete event registers a candidate immediately without KV enumeration", async () => {
  const path = key(35);
  const f = fixture(async () => [], [path]);
  try {
    const inserted = await recordAssetGcCandidates(f.db, [path], now);
    assert.equal(inserted, 1);
    assert.equal(f.lists(), 0);
    const candidate = f.sql.prepare("SELECT first_unreferenced_at FROM asset_gc_candidates WHERE path=?").get(path);
    assert.equal(candidate?.first_unreferenced_at, now);
    const report = await runAssetGc({ db: f.db, kv: f.kv, rooms: f.rooms, now: now + 6 * day, dryRun: false });
    assert.equal(report.deleted, 0);
    assert.equal(f.lists(), 0, "daily expiry must never enumerate KV");
    assert.ok(f.stored.has(path));
  } finally { f.sql.close(); }
});

test("repeated image deletion resets the seven-day candidate clock", async () => {
  const path = key(50);
  const f = fixture(async () => [], [path]);
  try {
    await recordAssetGcCandidates(f.db, [path], now - 6 * day);
    await recordAssetGcCandidates(f.db, [path], now);
    const candidate = f.sql.prepare("SELECT first_unreferenced_at FROM asset_gc_candidates WHERE path=?").get(path);
    assert.equal(candidate?.first_unreferenced_at, now);
    const report = await runAssetGc({ db: f.db, kv: f.kv, rooms: f.rooms,
      now: now + 2 * day, dryRun: false });
    assert.equal(report.deleted, 0);
    assert.ok(f.stored.has(path));
    assert.equal(f.lists(), 0);
  } finally { f.sql.close(); }
});

test("weekly KV discovery finds missed orphan uploads without deleting anything", async () => {
  const path = key(100);
  const f = fixture(async () => [], [path]);
  try {
    const report = await runAssetGc({ db: f.db, kv: f.kv, rooms: f.rooms,
      now, discoverUntracked: true });
    assert.equal(report.kvKeysScanned, 1);
    assert.equal(report.scanComplete, true);
    assert.equal(report.deleted, 0);
    assert.equal(report.candidates, 1);
    const saved = f.sql.prepare("SELECT first_unreferenced_at FROM asset_gc_candidates WHERE path=?").get(path);
    assert.equal(saved?.first_unreferenced_at, now);
    await runAssetGc({ db: f.db, kv: f.kv, rooms: f.rooms,
      now: now + 8 * day, dryRun: false });
    assert.equal(f.deletes(), 1);
    assert.equal(f.lists(), 1, "daily expiry must not run KV.list");
    assert.equal(f.stored.size, 0);
  } finally { f.sql.close(); }
});

test("weekly reconciliation preserves explicit delete-event age", async () => {
  const path = key(100);
  const f = fixture(async () => [], [path]);
  try {
    await recordAssetGcCandidates(f.db, [path], now - 4 * day);
    await runAssetGc({ db: f.db, kv: f.kv, rooms: f.rooms, now,
      discoverUntracked: true });
    const saved = f.sql.prepare("SELECT first_unreferenced_at FROM asset_gc_candidates WHERE path=?").get(path);
    assert.equal(saved?.first_unreferenced_at, now - 4 * day);
    assert.equal(f.stored.has(path), true);
  } finally { f.sql.close(); }
});

test("daily GC skips all site reads when no candidate is old enough", async () => {
  const f = fixture(async () => { throw new Error("DO unavailable"); }, [key(50)]);
  try {
    await recordAssetGcCandidates(f.db, [key(50)], now);
    const report = await runAssetGc({ db: f.db, kv: f.kv, rooms: f.rooms,
      now: now + day, dryRun: false });
    assert.equal(report.status, "ok");
    assert.equal(report.deleted, 0);
    assert.equal(f.lists(), 0);
    assert.equal(f.deletes(), 0);
  } finally { f.sql.close(); }
});

test("expired orphan from an explicit delete is protected by a different current site", async () => {
  const path = key(100);
  const f = fixture(async () => [path], [path]);
  try {
    await recordAssetGcCandidates(f.db, [path], now - 9 * day);
    const report = await runAssetGc({ db: f.db, kv: f.kv, rooms: f.rooms,
      now, dryRun: false });
    assert.equal(report.deleted, 0);
    assert.equal(report.candidates, 0);
    assert.equal(f.deletes(), 0);
    assert.ok(f.stored.has(path));
    assert.equal(f.lists(), 0);
  } finally { f.sql.close(); }
});
test("weekly inventory resumes its persisted KV cursor without nightly listing", async () => {
  const first = key(100, "first.png"), second = key(90, "second.png");
  const f = fixture(async () => [], [first, second]);
  let calls = 0;
  f.kv.list = async (options) => {
    calls++;
    if (!options.cursor) {
      return { keys: [{ name: first, metadata: { bytes: 10 } }],
        list_complete: false, cursor: "next" };
    }
    assert.equal(options.cursor, "next");
    return { keys: [{ name: second, metadata: { bytes: 20 } }],
      list_complete: true };
  };
  try {
    const one = await runAssetGc({ db: f.db, kv: f.kv, rooms: f.rooms,
      now, discoverUntracked: true });
    assert.equal(one.scanComplete, false);
    assert.equal(f.sql.prepare("SELECT scan_cursor FROM asset_gc_state").get()?.scan_cursor, "next");
    await runAssetGc({ db: f.db, kv: f.kv, rooms: f.rooms, now: now + day });
    assert.equal(calls, 1, "the nightly run must not advance the weekly KV cursor");
    const two = await runAssetGc({ db: f.db, kv: f.kv, rooms: f.rooms,
      now: now + 7 * day, discoverUntracked: true });
    assert.equal(two.scanComplete, true);
    assert.equal(calls, 2);
    assert.equal(f.sql.prepare("SELECT scan_cursor FROM asset_gc_state").get()?.scan_cursor, null);
    assert.equal(f.sql.prepare("SELECT count(*) AS n FROM asset_gc_candidates").get()?.n, 2);
  } finally { f.sql.close(); }
});
