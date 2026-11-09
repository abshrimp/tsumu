import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDbFromBinding, type Db } from "../lib/db";
import { nodeDatabase } from "../lib/node-storage";
import * as sites from "../lib/sites";
import { IMPORT_LIMITS, validateImportedDoc } from "../lib/site-import-format";
import { readTextLimited, TooLargeError } from "../lib/safe-fetch";
import { readCurrentDoc, saveCurrentDoc } from "../lib/doc-storage";
import { encodeStoredDoc } from "../lib/compressed-doc-storage";
import { userMessage } from "../lib/errors";

async function database(run: (db: Db) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), "tsumu-copy-"));
  const previous = process.env.TSUMU_DATA_DIR;
  process.env.TSUMU_DATA_DIR = dir;
  try {
    const db = await getDbFromBinding(nodeDatabase()!);
    await sites.insertSite(db, "source", { name: "Original", repo: null, branch: "main", previewBranch: "preview", siteUrl: null, previewUrl: null });
    await run(db);
  } finally {
    if (previous === undefined) delete process.env.TSUMU_DATA_DIR; else process.env.TSUMU_DATA_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  }
}
function api(db: Db, read = readCurrentDoc) {
  class NextResponse extends Response {
    static json(data: unknown, init?: ResponseInit) { return new NextResponse(JSON.stringify(data), init); }
  }
  const source = stripTypeScriptTypes(readFileSync(new URL("../app/api/sites/route.ts", import.meta.url), "utf8"))
    .replace(/^import[\s\S]*?;\n/gm, "").replace(/^export /gm, "");
  const injected = { DEFAULT_BRANCH: sites.DEFAULT_BRANCH, DEFAULT_PREVIEW_BRANCH: sites.DEFAULT_PREVIEW_BRANCH, deleteSite: sites.deleteSite, getSite: sites.getSite, insertSite: sites.insertSite, isSiteId: sites.isSiteId, listSites: sites.listSites, normalizeSiteInput: sites.normalizeSiteInput, newSiteId: () => "copy", NextResponse, dbUnavailable: () => { throw new Error("Unexpected fallback"); }, serverTr: async () => (text: string) => text,
    requireAuth: async () => null, dbConfigured: () => true, getDb: async () => db, userMessage,
    readCurrentDoc: read, encodeStoredDoc, validateImportedDoc, IMPORT_LIMITS, readTextLimited, TooLargeError };
  const post = new Function(...Object.keys(injected), `${source}\nreturn POST;`)(...Object.values(injected));
  return (input: unknown = { name: "Copy", copyFrom: "source" }) => post(new Request("https://example.test/api/sites", { method: "POST", body: JSON.stringify(input) })) as Promise<Response>;
}

test("copying a source deleted before its document is read does not create a blank copy", async () => database(async db => {
  const response = await api(db, async (db, id) => { await sites.deleteSite(db, id); return readCurrentDoc(db, id); })();
  assert.equal(response.status, 404);
  assert.equal(await sites.getSite(db, "copy"), null);
}));
test("a source with no document can still be copied", async () => database(async db => {
  const response = await api(db)();
  assert.equal(response.status, 200);
  assert.equal((await sites.getSite(db, "copy"))?.name, "Copy");
  assert.equal(await readCurrentDoc(db, "copy"), null);
}));
const sourceBody = JSON.stringify({
  siteName: "Saved", nodes: {}, assets: {},
  pages: { p: { id: "p", slug: "", children: [] } }, pageOrder: ["p"],
});

test("a captured source document remains usable if the source is deleted afterwards", async () => database(async db => {
  await saveCurrentDoc(db, "source", sourceBody, null);
  const response = await api(db, async (db, id) => { const snapshot = await readCurrentDoc(db, id); await sites.deleteSite(db, id); return snapshot; })();
  assert.equal(response.status, 200);
  assert.equal((await readCurrentDoc(db, "copy"))?.body, sourceBody);
}));
test("an unsuccessful destination save is not reported as a completed copy", async () => database(async db => {
  await saveCurrentDoc(db, "source", sourceBody, null);
  await db.execute("CREATE TRIGGER fail_copy BEFORE INSERT ON docs WHEN NEW.id='copy' BEGIN SELECT RAISE(ABORT, 'simulated failure'); END");
  const response = await api(db)();
  assert.equal(response.status, 502);
  assert.equal(await sites.getSite(db, "copy"), null);
}));

test("importing atomically creates revision one and rejects invalid or colliding imports without changing existing data", async () => database(async db => {
  const doc = { siteName: "Imported", nodes: {}, assets: {}, pages: { p: { id: "p", slug: "", children: [] } }, pageOrder: ["p"] };
  const input = { name: doc.siteName, initialDoc: doc, importId: "0123456789" };
  const post = api(db);
  assert.equal((await post({ ...input, initialDoc: { ...doc, pageOrder: ["absent"] } })).status, 400);
  assert.equal(await sites.getSite(db, input.importId), null);
  assert.equal((await post(input)).status, 200);
  assert.equal((await readCurrentDoc(db, input.importId))?.rev, "1");
  assert.equal((await post({ ...input, initialDoc: { ...doc, note: "replacement" } })).status, 409);
  assert.deepEqual(JSON.parse((await readCurrentDoc(db, input.importId))!.body), doc);
}));
