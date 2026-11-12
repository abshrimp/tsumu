import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getDbFromBinding } from "../lib/db";
import { assetFileName, nodeAssetStore, nodeDatabase } from "../lib/node-storage";
import { readCurrentDoc, saveCurrentDoc } from "../lib/doc-storage";
import { createInitialDoc } from "../lib/presets";
import { deleteSite, insertSite } from "../lib/sites";

function withDataDir(run: (dir: string) => Promise<void>) {
  return async () => {
    const dir = mkdtempSync(join(tmpdir(), "tsumu-data-"));
    const prev = process.env.TSUMU_DATA_DIR;
    process.env.TSUMU_DATA_DIR = dir;
    try {
      await run(dir);
    } finally {
      if (prev === undefined) delete process.env.TSUMU_DATA_DIR;
      else process.env.TSUMU_DATA_DIR = prev;
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

test("TSUMU_DATA_DIR が無ければ Node の保存先は使わない", () => {
  const prev = process.env.TSUMU_DATA_DIR;
  delete process.env.TSUMU_DATA_DIR;
  try {
    assert.equal(nodeDatabase(), null);
    assert.equal(nodeAssetStore(), null);
  } finally {
    if (prev !== undefined) process.env.TSUMU_DATA_DIR = prev;
  }
});

test("SQLite を D1 と同じ形で使える（スキーマ作成・読み書き・batch）", withDataDir(async () => {
  const binding = nodeDatabase();
  assert.ok(binding);
  const db = await getDbFromBinding(binding);
  const put = await db.execute({
    sql: "INSERT INTO docs (id, rev, saved_at, body) VALUES (?, ?, ?, ?)",
    args: ["s1", 1, 100, "{}"],
  });
  assert.equal(put.rowsAffected, 1);
  const [, read] = await db.batch([
    { sql: "UPDATE docs SET rev = ? WHERE id = ?", args: [2, "s1"] },
    { sql: "SELECT id, rev FROM docs WHERE id = ?", args: ["s1"] },
  ]);
  assert.deepEqual({ ...read.rows[0] }, { id: "s1", rev: 2 });
}));

test("batch の途中で失敗したらすべて取り消す", withDataDir(async () => {
  const db = await getDbFromBinding(nodeDatabase()!);
  await assert.rejects(db.batch([
    { sql: "INSERT INTO allowed_emails (email, added_at) VALUES (?, ?)", args: ["a@example.com", 1] },
    { sql: "INSERT INTO no_such_table VALUES (1)", args: [] },
  ]));
  const rs = await db.execute("SELECT COUNT(*) AS n FROM allowed_emails");
  assert.equal(rs.rows[0].n, 0);
}));

test("SQLite RETURNING reports affected rows without treating reads as writes", withDataDir(async () => {
  const db = await getDbFromBinding(nodeDatabase()!);
  const inserted = await db.execute({
    sql: "INSERT INTO docs (id, rev, saved_at, body) VALUES (?, 1, 100, '{}') RETURNING id, rev",
    args: ["returning"],
  });
  assert.deepEqual(inserted.rows.map(row => ({ ...row })), [{ id: "returning", rev: 1 }]);
  assert.equal(inserted.rowsAffected, 1);

  const results = await db.batch([
    "WITH target AS (SELECT 'returning' AS id) UPDATE docs SET rev = rev + 1 WHERE id IN (SELECT id FROM target) RETURNING rev",
    "SELECT rev FROM docs WHERE id = 'returning'",
    "UPDATE docs SET rev = 3 WHERE id = 'missing' RETURNING rev",
    "INSERT INTO docs VALUES ('returning', 1, 100, '{}') ON CONFLICT(id) DO NOTHING RETURNING rev",
    "DELETE FROM docs WHERE id = 'returning' RETURNING id",
    "SELECT COUNT(*) AS n FROM docs",
  ]);
  assert.deepEqual(results.map(result => result.rowsAffected), [1, 0, 0, 0, 1, 0]);
  assert.deepEqual(results.map(result => result.rows.map(row => ({ ...row }))), [
    [{ rev: 2 }], [{ rev: 2 }], [], [], [{ id: "returning" }], [{ n: 0 }],
  ]);
}));

test("RETURNING counts direct changes once and excludes trigger writes", withDataDir(async () => {
  const db = await getDbFromBinding(nodeDatabase()!);
  await db.execute("CREATE TABLE returning_audit (doc_id TEXT)");
  await db.execute(`CREATE TRIGGER audit_doc_insert AFTER INSERT ON docs BEGIN
    INSERT INTO returning_audit VALUES (new.id);
    INSERT INTO returning_audit VALUES (new.id);
  END`);
  const inserted = await db.execute("INSERT INTO docs VALUES ('a', 1, 100, '{}'), ('b', 1, 100, '{}') RETURNING id");
  assert.equal(inserted.rowsAffected, 2);
  assert.equal(inserted.rows.length, 2);
  const audit = await db.execute("SELECT COUNT(*) AS n FROM returning_audit");
  assert.equal(audit.rows[0].n, 4, "each insert and trigger must execute only once");
  assert.equal(audit.rowsAffected, 0, "SELECT must not reuse the preceding write count");

  await assert.rejects(db.batch([
    "UPDATE docs SET rev = 2 RETURNING id",
    "INSERT INTO no_such_table VALUES (1)",
  ]), /no_such_table/);
  const rows = await db.execute("SELECT rev FROM docs ORDER BY id");
  assert.deepEqual(rows.rows.map(row => row.rev), [1, 1]);
  assert.equal(rows.rowsAffected, 0);
  assert.equal((await db.execute("UPDATE docs SET rev = 2 RETURNING id")).rowsAffected, 2);
}));

test("RETURNING commits and batch rollbacks survive a Node process restart", withDataDir(async (dir) => {
  // 別々のプロセスを使い、キャッシュした接続や、確定していないプロセス内の状態で、
  // 保存の検証が通ってしまわないようにする。
  const setup = `
    const assert = require('node:assert/strict');
    const { nodeDatabase } = require(${JSON.stringify(fileURLToPath(new URL("../lib/node-storage.ts", import.meta.url)))});
    const { getDbFromBinding } = require(${JSON.stringify(fileURLToPath(new URL("../lib/db.ts", import.meta.url)))});
  `;
  const run = (body: string) => execFileSync(process.execPath, [
    "--import", "tsx", "--eval", `${setup}
    (async () => {
      const db = await getDbFromBinding(nodeDatabase());
      ${body}
    })().catch(error => { console.error(error); process.exitCode = 1; });`,
  ], { env: { ...process.env, TSUMU_DATA_DIR: dir }, encoding: "utf8", timeout: 15_000, stdio: "pipe" });
  run(`
    const committed = await db.batch([
      "INSERT INTO docs VALUES ('persistent', 1, 100, '{}') RETURNING rev",
      "UPDATE docs SET rev = 2 WHERE id = 'persistent' RETURNING rev",
    ]);
    assert.deepEqual(committed.map(result => result.rowsAffected), [1, 1]);
    await assert.rejects(db.batch([
      "UPDATE docs SET rev = 3 WHERE id = 'persistent' RETURNING rev",
      "INSERT INTO no_such_table VALUES (1)",
    ]), /no_such_table/);
  `);
  run(`
    const saved = await db.execute("SELECT rev FROM docs WHERE id = 'persistent'");
    assert.equal(saved.rows[0].rev, 2);
    assert.equal(saved.rowsAffected, 0);
    const updated = await db.execute("UPDATE docs SET rev = 3 WHERE id = 'persistent' RETURNING rev");
    assert.equal(updated.rows[0].rev, 3);
    assert.equal(updated.rowsAffected, 1);
  `);
}));

test("アセットをファイルに保存・配信・削除できる", withDataDir(async () => {
  const store = nodeAssetStore();
  assert.ok(store);
  const bytes = new TextEncoder().encode("<svg/>");
  await store.put("assets/a/b.svg", bytes.buffer, { metadata: { contentType: "image/svg+xml" } });
  const back = await store.get("assets/a/b.svg", { type: "arrayBuffer" });
  assert.equal(new TextDecoder().decode(back!), "<svg/>");
  const { value, metadata } = await store.getWithMetadata("assets/a/b.svg", { type: "stream" });
  assert.equal(await new Response(value).text(), "<svg/>");
  assert.deepEqual(metadata, { contentType: "image/svg+xml" });
  await store.delete("assets/a/b.svg");
  assert.equal(await store.get("assets/a/b.svg", { type: "arrayBuffer" }), null);
  assert.deepEqual(await store.getWithMetadata("missing", { type: "stream" }), { value: null, metadata: null });
}));

test("アセットのキーはフォルダの外を指せない", () => {
  assert.equal(assetFileName("../../etc/passwd"), "..%2F..%2Fetc%2Fpasswd");
  assert.throws(() => assetFileName(".."));
  assert.throws(() => assetFileName(""));
});

test("長いキー（日本語の名前など）はハッシュのファイル名にして保存できる", withDataDir(async () => {
  const key = `assets/x-${"写真".repeat(40)}.png`;
  const name = assetFileName(key);
  assert.match(name, /^%h-[0-9a-f]{64}$/);
  assert.equal(assetFileName(key), name);
  const store = nodeAssetStore()!;
  await store.put(key, new TextEncoder().encode("png").buffer, { metadata: { contentType: "image/png" } });
  assert.equal(new TextDecoder().decode((await store.get(key, { type: "arrayBuffer" }))!), "png");
}));

test("消したサイトの編集データは、開いたままのタブが保存しても作り直さない", withDataDir(async () => {
  const db = await getDbFromBinding(nodeDatabase()!);
  const dest = { name: "s", repo: null, branch: "main", previewBranch: "preview", siteUrl: null, previewUrl: null };
  await insertSite(db, "s1", dest);
  const snapshot = JSON.stringify(createInitialDoc());
  const first = await saveCurrentDoc(db, "s1", snapshot, null);
  assert.equal(first.kind, "saved");
  await deleteSite(db, "s1");
  assert.deepEqual(await saveCurrentDoc(db, "s1", snapshot, first.kind === "saved" ? first.rev : null), { kind: "missing" });
  assert.deepEqual(await saveCurrentDoc(db, "s1", snapshot, null), { kind: "missing" });
  assert.equal(await readCurrentDoc(db, "s1"), null);
}));

test("Node SQLite rejects malformed documents, invalid revisions and corrupt stored snapshots", withDataDir(async () => {
  const db = await getDbFromBinding(nodeDatabase()!);
  await insertSite(db, "s1", {
    name: "s", repo: null, branch: "main", previewBranch: "preview",
    siteUrl: null, previewUrl: null,
  });
  await assert.rejects(saveCurrentDoc(db, "s1", "{}", null), /不正な/);
  assert.equal(await readCurrentDoc(db, "s1"), null);
  const original = createInitialDoc();
  const body = JSON.stringify(original);
  assert.equal((await saveCurrentDoc(db, "s1", body, null)).kind, "saved");
  await assert.rejects(saveCurrentDoc(db, "s1", body, "invalid"), /不正な/);
  await assert.rejects(saveCurrentDoc(db, "s1", JSON.stringify({
    ...original, baseWidth: "wide",
  }), "1"), /不正な/);
  assert.equal((await readCurrentDoc(db, "s1"))?.rev, "1");
  await db.execute({ sql: "UPDATE docs SET body = ? WHERE id = ?", args: ["{}", "s1"] });
  await assert.rejects(readCurrentDoc(db, "s1"), /破損/);
}));
