import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDbFromBinding, type Db } from "../lib/db";
import { nodeDatabase } from "../lib/node-storage";
import { deleteSite, insertSite } from "../lib/sites";
import { readActivity, recordActivity, type ActivityKind } from "../lib/activity";

async function database(run: (db: Db) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), "tsumu-activity-"));
  const previous = process.env.TSUMU_DATA_DIR;
  process.env.TSUMU_DATA_DIR = dir;
  try {
    const db = await getDbFromBinding(nodeDatabase()!);
    await insertSite(db, "site", { name: "Site", repo: null, branch: "main", previewBranch: "preview", siteUrl: null, previewUrl: null });
    await run(db);
  } finally {
    if (previous === undefined) delete process.env.TSUMU_DATA_DIR; else process.env.TSUMU_DATA_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  }
}
const author = { email: "author@example.test", name: "Current name", image: null };
for (const kind of ["edit", "publish", "publish-test"] as ActivityKind[]) {
  test(`a late ${kind} activity cannot replace a newer event`, async () => database(async db => {
    await recordActivity(db, "site", kind, author, 2000);
    await recordActivity(db, "site", kind, { ...author, name: "Old name" }, 1000);
    const activity = await readActivity(db, "site", 2500);
    const last = kind === "edit" ? activity.lastEdit : kind === "publish" ? activity.lastPublish : activity.lastTestPublish;
    assert.equal(last?.at, 2000);
    assert.equal(last?.name, "Current name");
    await recordActivity(db, "site", kind, { ...author, name: "New name" }, 3000);
    const rows = await db.execute({ sql: "SELECT at, name FROM site_activity WHERE site_id = ? AND kind = ?", args: ["site", kind] });
    assert.equal(rows.rows[0].at, 3000);
    assert.equal(rows.rows[0].name, "New name");
  }));
}

test("a delayed activity cannot resurrect records after the site was deleted", async () => database(async db => {
  await recordActivity(db, "site", "edit", author, 1);
  await deleteSite(db, "site");
  await recordActivity(db, "site", "edit", author, 2);
  const rows = await db.execute("SELECT COUNT(*) AS n FROM site_activity WHERE site_id = 'site'");
  assert.equal(rows.rows[0].n, 0);
}));
