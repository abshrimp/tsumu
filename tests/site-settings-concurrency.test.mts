import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDbFromBinding, type Db } from "../lib/db";
import { nodeDatabase } from "../lib/node-storage";
import { deleteSite, getSite, insertSite, isSiteId, normalizeSiteInput, updateSite } from "../lib/sites";
import { userMessage } from "../lib/errors";
import { JsonBodyTooLargeError, readJsonLimited } from "../lib/api-json";

async function database(run: (db: Db) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), "tsumu-site-settings-"));
  const previous = process.env.TSUMU_DATA_DIR;
  process.env.TSUMU_DATA_DIR = dir;
  try {
    const db = await getDbFromBinding(nodeDatabase()!);
    await insertSite(db, "site", { name: "Original", repo: "owner/original", branch: "main", previewBranch: "preview", siteUrl: null, previewUrl: null });
    await run(db);
  } finally {
    if (previous === undefined) delete process.env.TSUMU_DATA_DIR; else process.env.TSUMU_DATA_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  }
}
function api(db: Db) {
  class NextResponse extends Response {
    static json(data: unknown, init?: ResponseInit) { return new NextResponse(JSON.stringify(data), init); }
  }
  const source = stripTypeScriptTypes(readFileSync(new URL("../app/api/sites/[id]/route.ts", import.meta.url), "utf8"))
    .replace(/^import[\s\S]*?;\n/gm, "").replace(/^export /gm, "");
  const injected = { NextResponse, JsonBodyTooLargeError, readJsonLimited, dbUnavailable: () => { throw new Error("Unexpected fallback"); }, serverTr: async () => (text: string) => text,
    requireAuth: async () => null, dbConfigured: () => true, getDb: async () => db, userMessage,
    deleteSite, getSite, isSiteId, normalizeSiteInput, updateSite };
  const patch = new Function(...Object.keys(injected), `${source}\nreturn PATCH;`)(...Object.values(injected));
  return (input: unknown) => patch(new Request("https://example.test/api/sites/site", { method: "PATCH", body: JSON.stringify(input) }), { params: Promise.resolve({ id: "site" }) }) as Promise<Response>;
}
function race(db: Db, action: () => Promise<void>): Db {
  let pending = true;
  return { ...db, execute: async statement => {
    const sql = typeof statement === "string" ? statement : statement.sql;
    if (pending && /^UPDATE sites SET/.test(sql)) { pending = false; await action(); }
    return db.execute(statement);
  } };
}

test("renaming does not revert concurrently changed publication settings", async () => database(async db => {
  const wrapped = race(db, async () => { await db.execute("UPDATE sites SET repo = 'owner/changed', branch = 'release' WHERE id = 'site'"); });
  const response = await api(wrapped)({ name: "Renamed" });
  assert.equal(response.status, 200);
  const saved = await getSite(db, "site");
  assert.equal(saved?.name, "Renamed");
  assert.equal(saved?.repo, "owner/changed");
  assert.equal(saved?.branch, "release");
}));

test("a concurrent branch change is revalidated against the requested preview branch", async () => database(async db => {
  const wrapped = race(db, async () => { await db.execute("UPDATE sites SET branch = 'release' WHERE id = 'site'"); });
  const response = await api(wrapped)({ previewBranch: "release" });
  assert.equal(response.status, 400);
  const saved = await getSite(db, "site");
  assert.equal(saved?.branch, "release");
  assert.equal(saved?.previewBranch, "preview");
}));

test("deletion between loading and saving settings is not a successful null result", async () => database(async db => {
  const response = await api(race(db, () => deleteSite(db, "site")))({ name: "Late rename" });
  assert.equal(response.status, 404);
  assert.equal(await getSite(db, "site"), null);
}));


test("continuously competing settings changes return conflict instead of claiming a save", async () => database(async db => {
  let writes = 0;
  const wrapped: Db = { ...db, execute: async statement => {
    const sql = typeof statement === "string" ? statement : statement.sql;
    if (/^UPDATE sites SET/.test(sql)) {
      writes++;
      await db.execute({ sql: "UPDATE sites SET repo = ? WHERE id = 'site'", args: [`owner/concurrent-${writes}`] });
    }
    return db.execute(statement);
  } };
  const response = await api(wrapped)({ name: "Attempted rename" });
  assert.equal(response.status, 409);
  assert.equal(writes, 4);
  const site = await getSite(db, "site");
  assert.equal(site?.name, "Original");
  assert.equal(site?.repo, "owner/concurrent-4");
}));

test("site settings reject arrays and invalid lock-suffixed branch path components", async () => database(async db => {
  const before = await getSite(db, "site");
  for (const input of [[], { branch: "release.lock/site" }, { previewBranch: "preview.lock/nested/branch" }]) {
    assert.equal((await api(db)(input)).status, 400);
    assert.deepEqual(await getSite(db, "site"), before);
  }
  assert.equal((await api(db)({ branch: "release/v2", previewBranch: "previews/v2" })).status, 200);
}));
