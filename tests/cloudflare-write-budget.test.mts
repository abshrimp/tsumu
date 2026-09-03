import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDbFromBinding, type D1LikeDatabase, type Db } from "../lib/db";
import { nodeDatabase } from "../lib/node-storage";
import { deleteSite, getSite, insertSite, recordSiteSavedAt, SITE_EDIT_METADATA_INTERVAL_MS } from "../lib/sites";
import { readActivity, recordActivity } from "../lib/activity";

const siteConfig = {
  name: "Site", repo: null, branch: "main", previewBranch: "preview",
  siteUrl: null, previewUrl: null,
};

test("D1 metadata and edit activity write only once per minute per site/editor", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tsumu-d1-write-budget-"));
  const previous = process.env.TSUMU_DATA_DIR;
  process.env.TSUMU_DATA_DIR = dir;
  try {
    // Run the actual D1 SQL against SQLite rather than testing a mock limiter.
    const sqlite = nodeDatabase()!;
    const binding: D1LikeDatabase = {
      prepare: sql => sqlite.prepare(sql),
      batch: statements => sqlite.batch(statements),
    };
    const real = await getDbFromBinding(binding);
    assert.equal(real.backend, "d1");
    let metadataWrites = 0;
    let activityWrites = 0;
    const db: Db = {
      ...real,
      async execute(stmt) {
        const result = await real.execute(stmt);
        const sql = typeof stmt === "string" ? stmt : stmt.sql;
        if (/^INSERT INTO site_activity/.test(sql)) activityWrites += result.rowsAffected;
        return result;
      },
      async batch(statements) {
        const results = await real.batch(statements);
        statements.forEach((statement, i) => {
          if (/^UPDATE (?:site_document_rooms|sites) SET/.test(statement.sql)) {
            metadataWrites += results[i].rowsAffected;
          }
        });
        return results;
      },
    };
    const key = (await insertSite(db, "site", siteConfig))!;
    const editor = { email: "editor@example.test", name: "Editor", image: null };
    const start = Date.now() + 120_000;

    async function edit(at: number) {
      assert.equal(await recordSiteSavedAt(db, "site", key, at), true);
      await recordActivity(db, "site", "edit", editor, at, key);
    }

    await edit(start);
    assert.equal(metadataWrites, 2);
    assert.equal(activityWrites, 1);
    for (let i = 1; i < 60; i++) {
      await edit(start + i * 1000);
    }
    assert.equal(metadataWrites, 2, "rapid autosaves must not write site timestamps");
    assert.equal(activityWrites, 1, "rapid autosaves must not rewrite edit history");
    assert.equal((await getSite(db, "site"))?.savedAt, start);

    await edit(start + SITE_EDIT_METADATA_INTERVAL_MS);
    assert.equal(metadataWrites, 4);
    assert.equal(activityWrites, 2);
    assert.equal((await getSite(db, "site"))?.savedAt, start + SITE_EDIT_METADATA_INTERVAL_MS);
    assert.equal((await readActivity(db, "site", start + SITE_EDIT_METADATA_INTERVAL_MS))?.lastEdit?.at,
      start + SITE_EDIT_METADATA_INTERVAL_MS);

    // A delayed acknowledgment cannot regress either timestamp.
    await edit(start + 1000);
    assert.equal(metadataWrites, 4);
    assert.equal(activityWrites, 2);

    // Different editors still appear independently; publishing is not throttled.
    await recordActivity(db, "site", "edit", { ...editor, email: "second@example.test" }, start + 65_000, key);
    assert.equal(activityWrites, 3);
    await recordActivity(db, "site", "publish", editor, start);
    await recordActivity(db, "site", "publish", editor, start + 1000);
    assert.equal(activityWrites, 5);

    // Do not acknowledge an old generation after the site was removed.
    await deleteSite(db, "site", key);
    assert.equal(await recordSiteSavedAt(db, "site", key, start + 120_000), false);
    await recordActivity(db, "site", "edit", editor, start + 120_000, key);
    assert.equal((await readActivity(db, "site")).lastEdit, null);
  } finally {
    if (previous === undefined) delete process.env.TSUMU_DATA_DIR;
    else process.env.TSUMU_DATA_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});
