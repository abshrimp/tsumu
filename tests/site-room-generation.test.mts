import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDbFromBinding, type D1LikeDatabase } from "../lib/db";
import { nodeDatabase } from "../lib/node-storage";
import { deleteSite, getSite, getSiteRoomKey, insertSite } from "../lib/sites";

function withFreshDb(run: (db: Awaited<ReturnType<typeof getDbFromBinding>>) => Promise<void>) {
  return async () => {
    const dir = mkdtempSync(join(tmpdir(), "tsumu-room-keys-"));
    const old = process.env.TSUMU_DATA_DIR;
    process.env.TSUMU_DATA_DIR = dir;
    try {
      const sqlite = nodeDatabase()!;
      // Execute the production D1 SQL schema against real SQLite, not the
      // self-hosted adapter mode (which stores SiteDoc JSON in local docs).
      const fakeD1: D1LikeDatabase = {
        prepare: (sql) => sqlite.prepare(sql),
        batch: (stmts) => sqlite.batch(stmts),
      };
      const db = await getDbFromBinding(fakeD1);
      assert.equal(db.backend, "d1");
      await run(db);
    } finally {
      if (old === undefined) delete process.env.TSUMU_DATA_DIR;
      else process.env.TSUMU_DATA_DIR = old;
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

const dest = {
  name: "Site", repo: null, branch: "main", previewBranch: "preview",
  siteUrl: null, previewUrl: null,
};

test("D1 creates only the generation map, not the old JSON document table", withFreshDb(async db => {
  assert.equal((await db.execute("SELECT name FROM sqlite_master WHERE name='docs'")).rows.length, 0);
  await insertSite(db, "reusable", dest);
  assert.equal((await db.execute("SELECT name FROM sqlite_master WHERE name='docs'")).rows.length, 0);
  assert.match((await getSiteRoomKey(db, "reusable"))!, /^[0-9a-f-]{36}$/);
  assert.equal((await getSite(db, "reusable"))?.savedAt, null, "new sites are not yet saved");
  const roomKey = (await getSiteRoomKey(db, "reusable"))!;
  await db.execute({
    sql: "UPDATE site_document_rooms SET saved_at=? WHERE site_id=? AND room_key=?",
    args: [123456, "reusable", roomKey],
  });
  assert.equal((await getSite(db, "reusable"))?.savedAt, 123456);

}));

test("deleting and recreating the same site ID always assigns a different room", withFreshDb(async db => {
  await insertSite(db, "reusable", dest);
  const oldKey = (await getSiteRoomKey(db, "reusable"))!;
  assert.ok(oldKey);
  await deleteSite(db, "reusable", oldKey);
  assert.equal(await getSite(db, "reusable"), null);
  assert.equal(await getSiteRoomKey(db, "reusable"), null);
  const tombstones = (await db.execute("SELECT room_key FROM document_room_cleanup")).rows;
  assert.deepEqual(tombstones.map(row => row.room_key), [oldKey]);

  await insertSite(db, "reusable", { ...dest, name: "New site" });
  const newKey = (await getSiteRoomKey(db, "reusable"))!;
  assert.ok(newKey);
  assert.notEqual(newKey, oldKey);
  await assert.rejects(deleteSite(db, "reusable", oldKey), /サイトが変更された/);
  assert.equal((await getSite(db, "reusable"))?.name, "New site");
  assert.equal(await getSiteRoomKey(db, "reusable"), newKey);

  await deleteSite(db, "reusable", newKey);
  const pending = (await db.execute("SELECT room_key FROM document_room_cleanup ORDER BY queued_at,room_key")).rows;
  assert.deepEqual(new Set(pending.map(row => row.room_key)), new Set([oldKey, newKey]));
}));

test("simultaneous import IDs cannot create two DO generations", withFreshDb(async db => {
  const attempts = await Promise.allSettled([
    insertSite(db, "same-import", dest),
    insertSite(db, "same-import", dest),
  ]);
  assert.equal(attempts.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(attempts.filter(result => result.status === "rejected").length, 1);
  assert.equal((await db.execute("SELECT COUNT(*) AS n FROM site_document_rooms")).rows[0].n, 1);
}));
