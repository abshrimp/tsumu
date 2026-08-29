import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDbFromBinding, type Db } from "../lib/db";
import { nodeDatabase } from "../lib/node-storage";
import { deleteSite, insertSite } from "../lib/sites";
import {
  DEFAULT_PUBLISHED_EXPORT_OPTIONS,
  parsePublishedExportOptions,
  readPublishedExportOptions,
  savePublishedExportOptions,
} from "../lib/publish-preferences";

const site = (name: string) => ({
  name, repo: null, branch: "main", previewBranch: "preview", siteUrl: null, previewUrl: null,
});

async function withDatabase(run: (db: Db) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), "tsumu-publish-options-"));
  const previous = process.env.TSUMU_DATA_DIR;
  process.env.TSUMU_DATA_DIR = dir;
  try {
    const db = await getDbFromBinding(nodeDatabase()!);
    await insertSite(db, "alpha", site("Alpha"));
    await insertSite(db, "beta", site("Beta"));
    await run(db);
  } finally {
    if (previous === undefined) delete process.env.TSUMU_DATA_DIR;
    else process.env.TSUMU_DATA_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  }
}

test("saved GitHub output formats persist per site in SQLite and are not part of SiteDoc", async () => withDatabase(async db => {
  const vue = { framework: "vue", language: "javascript", style: "tailwind" } as const;
  const html = { framework: "html", language: "javascript", style: "css" } as const;
  assert.deepEqual(await readPublishedExportOptions(db, "alpha"), DEFAULT_PUBLISHED_EXPORT_OPTIONS);
  assert.equal(await savePublishedExportOptions(db, "alpha", vue), true);
  assert.deepEqual(await readPublishedExportOptions(db, "alpha"), vue);
  assert.deepEqual(await readPublishedExportOptions(db, "beta"), DEFAULT_PUBLISHED_EXPORT_OPTIONS);
  assert.equal(await savePublishedExportOptions(db, "beta", html), true);
  assert.deepEqual(await readPublishedExportOptions(db, "beta"), html);
  assert.equal(await savePublishedExportOptions(db, "alpha", html), true);
  assert.deepEqual(await readPublishedExportOptions(db, "alpha"), html);
  const rows = await db.execute("SELECT site_id, framework, language, style FROM site_publish_options ORDER BY site_id");
  assert.deepEqual(rows.rows.map(row => ({ ...row })), [
    { site_id: "alpha", framework: "html", language: "javascript", style: "css" },
    { site_id: "beta", framework: "html", language: "javascript", style: "css" },
  ]);
}));

test("deletion removes persisted formats, and delayed writes cannot resurrect a removed site", async () => withDatabase(async db => {
  const selected = { framework: "nuxt", language: "typescript", style: "css-modules" } as const;
  assert.equal(await savePublishedExportOptions(db, "alpha", selected), true);
  await deleteSite(db, "alpha");
  assert.equal(await savePublishedExportOptions(db, "alpha", selected), false);
  const rows = await db.execute("SELECT COUNT(*) AS n FROM site_publish_options WHERE site_id='alpha'");
  assert.equal(rows.rows[0].n, 0);
  assert.deepEqual(await readPublishedExportOptions(db, "alpha"), DEFAULT_PUBLISHED_EXPORT_OPTIONS);
}));

test("invalid and incompatible published format settings cannot be accepted", () => {
  assert.deepEqual(parsePublishedExportOptions({ framework: "sveltekit", language: "typescript", style: "css" }),
    { framework: "sveltekit", language: "typescript", style: "css" });
  for (const options of [
    null, [], {}, { framework: "__proto__", language: "typescript", style: "css" },
    { framework: "html", language: "typescript", style: "css" },
    { framework: "single-html", language: "javascript", style: "css-modules" },
    { framework: "vue", language: "python", style: "css" },
  ]) assert.equal(parsePublishedExportOptions(options), null);
});
