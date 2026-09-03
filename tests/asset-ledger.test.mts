import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readAssetLedger, recordUploadedAsset } from "../lib/asset-ledger";
import { computeStorageUsage } from "../lib/storage-usage";
import type { Db } from "../lib/db";

function ledgerDb(backend: "d1" | "sqlite" = "d1") {
  const sql = new DatabaseSync(":memory:");
  sql.exec(`
    CREATE TABLE asset_gc_candidates(path TEXT PRIMARY KEY,first_unreferenced_at INTEGER NOT NULL,last_seen_at INTEGER NOT NULL,bytes INTEGER);
    CREATE TABLE asset_objects(path TEXT PRIMARY KEY,bytes INTEGER,uploaded_at INTEGER NOT NULL,last_seen_at INTEGER NOT NULL);
    CREATE TABLE asset_ledger_state(id INTEGER PRIMARY KEY CHECK(id=1),created_at INTEGER NOT NULL,complete_at INTEGER);
    INSERT INTO asset_ledger_state(id,created_at) VALUES(1,0);
  `);
  const execute = async (input: string | { sql: string; args: (string | number | null)[] }) => {
    const stmt = sql.prepare(typeof input === "string" ? input : input.sql);
    const args = typeof input === "string" ? [] : input.args;
    if (stmt.columns().length) return { rows: stmt.all(...args) as Record<string, unknown>[], rowsAffected: 0 };
    return { rows: [], rowsAffected: Number(stmt.run(...args).changes) };
  };
  const db: Db = { backend, execute, batch: async (stmts) => Promise.all(stmts.map(execute)) };
  return { sql, db };
}

test("the ledger counts every stored file, including removed ones waiting for GC", async () => {
  const { sql, db } = ledgerDb();
  try {
    await recordUploadedAsset(db, "assets/a.png", 100, 1);
    await recordUploadedAsset(db, "assets/b.png", 50, 2);
    sql.prepare("INSERT INTO asset_objects VALUES(?,?,?,?)").run("assets/old.png", null, 0, 0);
    sql.prepare("INSERT INTO asset_gc_candidates VALUES(?,?,?,?)").run("assets/b.png", 3, 3, 50);
    const ledger = await readAssetLedger(db);
    assert.deepEqual(ledger, {
      complete: false, count: 3, bytes: 150, unknownCount: 1, unknownPaths: ["assets/old.png"],
      pendingCount: 1, pendingBytes: 50,
    });
    sql.exec("UPDATE asset_ledger_state SET complete_at=10");
    assert.equal((await readAssetLedger(db))?.complete, true);
  } finally { sql.close(); }
});

test("Node/Docker have no ledger", async () => {
  const { sql, db } = ledgerDb("sqlite");
  try {
    await recordUploadedAsset(db, "assets/a.png", 100);
    assert.equal(Number(sql.prepare("SELECT count(*) AS n FROM asset_objects").get()?.n), 0);
    assert.equal(await readAssetLedger(db), null);
  } finally { sql.close(); }
});

const ledger = (over: object = {}) => ({
  complete: true, count: 3, bytes: 150, unknownCount: 2, unknownPaths: ["assets/old.png", "assets/gone.png"],
  pendingCount: 1, pendingBytes: 50, ...over,
});

test("a complete ledger is the meter, with unknown sizes filled from the open document", () => {
  const usage = computeStorageUsage({ ledger: ledger() }, [
    { path: "assets/a.png", bytes: 100 },
    { path: "assets/old.png", bytes: 30 },
  ]);
  assert.deepEqual(usage, { files: 3, bytes: 180, unknown: 1, exact: true, pendingCount: 1, pendingBytes: 50 });
});

test("an incomplete ledger falls back to counting files used by sites once each", () => {
  const usage = computeStorageUsage({
    ledger: ledger({ complete: false }),
    others: [{ path: "assets/shared.png", bytes: 10 }, { path: "assets/x.png", bytes: null }],
  }, [{ path: "assets/shared.png", bytes: 10 }, { path: "assets/own.png", bytes: 5 }, {}]);
  assert.deepEqual(usage, { files: 3, bytes: 15, unknown: 1, exact: false, pendingCount: 0, pendingBytes: 0 });
});
