import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { parseFragment } from "parse5";
import { createInitialDoc } from "../lib/presets";
import { validSiteDoc } from "../lib/doc-tree";
import { cssAssetReferences } from "../lib/css-assets";
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

test("asset GC retains encoded URL paths next to malformed percent escapes", () => {
  const path = key(60);
  const escaped = encodeURIComponent(path).replace("assets", "%61%73%73%65%74%73");
  for (const extra of ["100%", "%zz", "%FF"]) {
    const url = `/api/assets/file?path=${escaped}&note=${extra}`;
    assert.equal(new URL(url, "https://example.com").searchParams.get("path"), path);
    const raw = JSON.stringify({ rawHtml: `<img src="${url}">` });
    assert.equal(extractAssetReferences(raw).has(path), true);
  }
});

const htmlAssetForms = (path: string) => {
  const filename = path.slice("assets/".length);
  return [
    `<img src="/api/assets/file?path=&#97;ssets/${filename}">`,
    `<img src="/api/assets/file?path=&#97ssets/${filename}">`,
    `<img src="/api/assets/file?path=&#x61;ssets/${filename}">`,
    `<img src="/api/assets/file?path=&#X61ssets/${filename}">`,
    `<img src="/api/assets/file?path=assets&sol;${filename.replace("_fj.", "&lowbar;&fjlig;&period;")}">`,
    `<img src="/api/assets/file?path=&#37;61ssets%2F${filename}&amp;note=100%">`,
    `<img src="/api/assets/file?path=ass&NewLine;ets/${filename}">`,
    `<div style="background-image:url('/api/assets/file?path=&#92;61 ssets&#92;2f ${filename}')"></div>`,
  ];
};

test("asset GC retains HTML character references accepted by the HTML and URL parsers", () => {
  const path = key(60, "photo_fj.png");
  for (const html of htmlAssetForms(path)) {
    const fragment = parseFragment(html);
    const element = fragment.childNodes[0];
    assert.ok("attrs" in element);
    const source = element.attrs.find(attr => attr.name === "src")?.value;
    const style = element.attrs.find(attr => attr.name === "style")?.value;
    const url = source ?? cssAssetReferences(style!)[0]?.url;
    assert.equal(new URL(url!, "https://example.com").searchParams.get("path"), path, html);
    const doc = createInitialDoc();
    doc.pages[doc.pageOrder[0]].rawHtml = html;
    assert.equal(validSiteDoc(doc), true);
    assert.equal(extractAssetReferences(JSON.stringify(doc)).has(path), true, html);
  }
});

test("asset GC retains CSS escapes and still scans original literal strings", () => {
  const path = key(60);
  const filename = path.slice("assets/".length);
  const css = `background-image:url("/api/assets/file?path=\\61 ssets\\2f ${filename}")`;
  const url = cssAssetReferences(css)[0].url;
  assert.equal(new URL(url, "https://example.com").searchParams.get("path"), path);
  assert.equal(extractAssetReferences(JSON.stringify({ styles: { backgroundImage: css } })).has(path), true);
  const literal = `${path}\\61.png`;
  assert.equal(extractAssetReferences(JSON.stringify({ text: literal })).has(path), true);
});

test("asset GC handles wide JSON arrays and objects without argument-count overflows", () => {
  const path = key(60);
  const values = Array(150_000).fill(null);
  values[values.length - 1] = path;
  assert.equal(extractAssetReferences(JSON.stringify({ values })).has(path), true);
  const object = Object.fromEntries(values.map((value, index) => [String(index), value]));
  assert.equal(extractAssetReferences(JSON.stringify(object)).has(path), true);
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
    CREATE TABLE asset_objects(
      path TEXT PRIMARY KEY,bytes INTEGER,uploaded_at INTEGER NOT NULL,last_seen_at INTEGER NOT NULL
    );
    CREATE TABLE asset_ledger_state(id INTEGER PRIMARY KEY CHECK(id=1),created_at INTEGER NOT NULL,complete_at INTEGER);
    INSERT INTO asset_ledger_state(id,created_at) VALUES(1,0);
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

test("active GC keeps a referenced candidate when URL text contains an unrelated malformed escape", async () => {
  const path = key(100);
  const encoded = encodeURIComponent(path).replace("assets", "%61ssets");
  const raw = JSON.stringify({ rawHtml: `<img src="/api/assets/file?path=${encoded}&note=100%">` });
  const f = fixture(async () => [...extractAssetReferences(raw)], [path]);
  try {
    f.sql.prepare("INSERT INTO asset_gc_candidates VALUES(?,?,?,?)")
      .run(path, now - 9 * day, now - day, 17);
    const report = await runAssetGc({ db: f.db, kv: f.kv, rooms: f.rooms, now, dryRun: false });
    assert.equal(report.deleted, 0);
    assert.equal(f.deletes(), 0);
    assert.ok(f.stored.has(path));
    assert.equal(report.candidates, 0);
  } finally { f.sql.close(); }
});

test("active GC protects current HTML references after character-reference decoding", async () => {
  const path = key(100, "photo_fj.png");
  for (const html of htmlAssetForms(path)) {
    const doc = createInitialDoc();
    doc.pages[doc.pageOrder[0]].rawHtml = html;
    const f = fixture(async () => [...extractAssetReferences(JSON.stringify(doc))], [path]);
    try {
      f.sql.prepare("INSERT INTO asset_gc_candidates VALUES(?,?,?,?)")
        .run(path, now - 9 * day, now - day, 17);
      const report = await runAssetGc({ db: f.db, kv: f.kv, rooms: f.rooms, now, dryRun: false });
      assert.equal(report.deleted, 0, html);
      assert.equal(f.deletes(), 0);
      assert.ok(f.stored.has(path));
      assert.equal(report.candidates, 0);
    } finally { f.sql.close(); }
  }
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

test("one run deletes more than ten eligible keys when the budget allows", async () => {
  const keys = Array.from({ length: 40 }, (_, i) => key(100, `bulk-${i}.png`));
  const f = fixture(async () => [], keys);
  try {
    for (const path of keys) f.sql.prepare("INSERT INTO asset_gc_candidates VALUES(?,?,?,?)")
      .run(path, now - 9 * day, now - day, 17);
    const report = await runAssetGc({ db: f.db, kv: f.kv, rooms: f.rooms, now, dryRun: false });
    assert.equal(report.deleted, 40);
    assert.equal(f.stored.size, 0);
    assert.equal(report.candidates, 0);
  } finally { f.sql.close(); }
});

test("deletion stops inside the Workers Free subrequest limit when many sites are scanned", async () => {
  const keys = Array.from({ length: 300 }, (_, i) => key(100, `many-${i}.png`));
  const f = fixture(async () => [], keys);
  try {
    const sites = 400;
    for (let i = 2; i <= sites; i++) {
      f.sql.prepare("INSERT INTO sites(id) VALUES(?)").run(`site${i}`);
      f.sql.prepare("INSERT INTO site_document_rooms(site_id,room_key) VALUES(?,?)").run(`site${i}`, `room${i}`);
    }
    for (const path of keys) f.sql.prepare("INSERT INTO asset_gc_candidates VALUES(?,?,?,?)")
      .run(path, now - 9 * day, now - day, 17);
    let calls = 0;
    const db: Db = {
      backend: "d1",
      execute: (stmt) => { calls++; return f.db.execute(stmt); },
      batch: (stmts) => { calls++; return f.db.batch(stmts); },
    };
    const kv = { list: f.kv.list, delete: (path: string) => { calls++; return f.kv.delete(path); } };
    const rooms: AssetGcDocumentNamespace = {
      idFromName: name => name,
      get(id) { return { gcAssetReferences: () => { calls++; return f.rooms.get(id).gcAssetReferences(); } }; },
    };
    const report = await runAssetGc({ db, kv, rooms, now, dryRun: false });
    // Two full scans of 400 sites leave room for only some deletes.
    assert.ok(report.deleted > 0 && report.deleted < 300, `deleted ${report.deleted}`);
    assert.ok(calls <= 900, `used ${calls} Cloudflare-service calls`);
    assert.equal(f.stored.size, 300 - report.deleted);
    assert.equal(report.candidates, 300 - report.deleted);
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

test("weekly inventory fills the storage ledger and GC deletes keep it in sync", async () => {
  const used = key(100, "used.png"), orphan = key(100, "orphan.png");
  const f = fixture(async () => [used], [used, orphan]);
  try {
    const row = f.sql.prepare("INSERT INTO asset_objects VALUES(?,?,?,?)");
    row.run(key(200, "vanished.png"), 5, now - 200 * day, now - 100 * day);
    // Uploaded while the scan ran: KV listing may not include it yet.
    row.run(key(0, "fresh.png"), 9, now + 1, now + 1);
    await runAssetGc({ db: f.db, kv: f.kv, rooms: f.rooms, now, discoverUntracked: true });
    const ledger = () => f.sql.prepare("SELECT path,bytes FROM asset_objects ORDER BY path").all()
      .map(r => [String(r.path), r.bytes]);
    assert.deepEqual(ledger(), [[key(0, "fresh.png"), 9], [orphan, 17], [used, 17]].sort());
    assert.equal(f.sql.prepare("SELECT complete_at FROM asset_ledger_state").get()?.complete_at, now);
    await runAssetGc({ db: f.db, kv: f.kv, rooms: f.rooms, now: now + 8 * day, dryRun: false });
    assert.equal(f.stored.has(orphan), false);
    assert.deepEqual(ledger(), [[key(0, "fresh.png"), 9], [used, 17]].sort());
  } finally { f.sql.close(); }
});

test("an inventory that began before the ledger existed does not mark it complete", async () => {
  const f = fixture(async () => [], [key(100)]);
  try {
    f.sql.prepare("UPDATE asset_ledger_state SET created_at=?").run(now + 1);
    await runAssetGc({ db: f.db, kv: f.kv, rooms: f.rooms, now, discoverUntracked: true });
    assert.equal(f.sql.prepare("SELECT complete_at FROM asset_ledger_state").get()?.complete_at, null);
    assert.equal(Number(f.sql.prepare("SELECT count(*) AS n FROM asset_objects").get()?.n), 1);
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
