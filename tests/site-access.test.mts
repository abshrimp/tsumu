import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDbFromBinding } from "../lib/db";
import { nodeDatabase } from "../lib/node-storage";
import { deleteSite, insertSite, listSites } from "../lib/sites";
import { isSiteRole, permits } from "../lib/site-access";

test("per-site roles permit only their designated operations", () => {
  assert.deepEqual(["owner", "editor", "viewer", "none"].map(isSiteRole), [true, true, true, false]);
  for (const action of ["view", "edit", "manage"] as const) {
    assert.equal(permits("owner", action), true);
    assert.equal(permits(null, action), false);
  }
  assert.equal(permits("editor", "view"), true);
  assert.equal(permits("editor", "edit"), true);
  assert.equal(permits("editor", "manage"), false);
  assert.equal(permits("viewer", "view"), true);
  assert.equal(permits("viewer", "edit"), false);
  assert.equal(permits("viewer", "manage"), false);
});

test("site listings are filtered by explicit ownership and viewer membership", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tsumu-site-members-"));
  const previous = process.env.TSUMU_DATA_DIR;
  process.env.TSUMU_DATA_DIR = dir;
  try {
    const db = await getDbFromBinding(nodeDatabase()!);
    const dest = { name: "Test site", repo: null, branch: "main", previewBranch: "preview", siteUrl: null, previewUrl: null };
    await insertSite(db, "alpha", dest, "alpha-owner@example.test");
    await insertSite(db, "beta", dest, "beta-owner@example.test");
    await db.execute({ sql: "INSERT INTO site_members(site_id,email,role) VALUES(?,?,'viewer')", args: ["alpha", "colleague@example.test"] });
    const names = async (email: string) => (await listSites(db, email)).map(site => [site.id, site.accessRole]);
    assert.deepEqual(await names("alpha-owner@example.test"), [["alpha", "owner"]]);
    assert.deepEqual(await names("beta-owner@example.test"), [["beta", "owner"]]);
    assert.deepEqual(await names("colleague@example.test"), [["alpha", "viewer"]]);
    assert.deepEqual(await names("stranger@example.test"), []);
    await deleteSite(db, "alpha");
    assert.deepEqual(await names("colleague@example.test"), []);
    const removed = await db.execute({ sql: "SELECT 1 FROM site_members WHERE site_id='alpha'", args: [] });
    assert.equal(removed.rows.length, 0);
  } finally {
    if (previous === undefined) delete process.env.TSUMU_DATA_DIR;
    else process.env.TSUMU_DATA_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});
