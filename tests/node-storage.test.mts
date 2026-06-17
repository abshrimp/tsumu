import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDbFromBinding } from "../lib/db";
import { assetFileName, nodeAssetStore, nodeDatabase } from "../lib/node-storage";
import { readCurrentDoc, saveCurrentDoc } from "../lib/doc-storage";
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
  const first = await saveCurrentDoc(db, "s1", "{}", null);
  assert.equal(first.kind, "saved");
  await deleteSite(db, "s1");
  assert.deepEqual(await saveCurrentDoc(db, "s1", "{}", first.kind === "saved" ? first.rev : null), { kind: "missing" });
  assert.deepEqual(await saveCurrentDoc(db, "s1", "{}", null), { kind: "missing" });
  assert.equal(await readCurrentDoc(db, "s1"), null);
}));
