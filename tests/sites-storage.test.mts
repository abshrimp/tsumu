import { describe, before, test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire, stripTypeScriptTypes } from "node:module";
import { transformSync } from "./helpers/bundle";
import { useEditor } from "../lib/store";
import { createInitialDoc } from "../lib/presets";
import { elements, importCallbacks } from "./helpers/pending-import";
import { dbConfigured, getDbFromBinding, type Db, type D1LikeDatabase } from "../lib/db";
import { assetStore } from "../lib/kv";
import { fakeIndexedDB } from "./helpers/fake-indexeddb";
import { createBrowserDoc, deleteBrowserDoc, readBrowserDoc, writeBrowserDoc } from "../lib/browser-doc-storage";
import { browserDocumentCreateScenario, browserDocumentScenario, cursorScenario, expectedCreate, expectedDocument, expectedTransaction, transactionCases, transactionScenario } from "./helpers/indexeddb-transactions";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { assetFileName, nodeAssetStore, nodeDatabase } from "../lib/node-storage";
import { readCurrentDoc, saveCurrentDoc } from "../lib/doc-storage";
import * as siteModel from "../lib/site-model";
import { isSiteId, isSiteRole, normalizeSiteInput } from "../lib/site-model";
import * as sites from "../lib/sites";
import { deleteSite, insertSite, listSites, getSite, getSiteRoomKey, updateSite } from "../lib/sites";
import { permits } from "../lib/site-access";
import { ZipArchive, ZipBuilder } from "../lib/zip";
import { createSiteBackup } from "../lib/site-backup";
import { parseSiteImport, EDITABLE_ASSETS_PATH, EDITABLE_DOC_PATH } from "../lib/site-import";
import { IMPORT_LIMITS, validateImportedDoc } from "../lib/site-import-format";
import { extractAssetReferences } from "../lib/asset-gc-plan";
import { JsonBodyTooLargeError, JsonContentTypeError, jsonErrorStatus, readJsonLimited, readJsonObjectLimited } from "../lib/api-json";
import { userMessage } from "../lib/errors";
import { argOf, isRoomLookup, original, replacement, setup, sqlOf } from "./helpers/document-generation-api";
import { buildAssetNames } from "../lib/generator/names";
import { createSiteFromFile, importFileKind } from "../lib/import-site-file";
import { siteThumbnailImages } from "../lib/site-thumbnail";
import { type SiteDoc } from "../lib/types";

describe("backup-day-input", () => {
function handler(options: { siteExists?: boolean; body?: string } = {}) {
  const { siteExists = true, body = '{"ok":true}' } = options;
  class NextResponse extends Response {
    static json(data: unknown, init?: ResponseInit) {
      return new NextResponse(JSON.stringify(data), init);
    }
  }
  const reads: string[] = [];
  const url = new URL("../app/api/doc/backups/route.ts", import.meta.url);
  const require = createRequire(url);
  const code = transformSync(readFileSync(url, "utf8"), {
    loader: "ts", format: "cjs", target: "es2022",
  }).code;
  const injected: Record<string, unknown> = {
    "next/server": { NextResponse },
    "../../../../lib/unavailable": { dbUnavailable: async () => NextResponse.json({}, { status: 503 }) },
    "../../../../lib/i18n-server": { serverTr: async () => (s: string) => s },
    "../../../../lib/db": { dbConfigured: () => true, getDb: async () => ({
      execute: async (query: { sql: string; args: unknown[] }) => {
        reads.push(query.sql);
        if (query.sql.includes("SELECT body")) return { rows: [{ body }] };
        return { rows: [{ day: 0, saved_at: 1, size: 12 }] };
      },
    }) },
    "../../../../lib/server": { requireAuth: async () => null },
    "../../../../lib/doc-storage": {
      validateDocBody: (raw: string) => {
        try {
          const parsed = JSON.parse(raw);
          return parsed && typeof parsed === "object" ? null : "invalid";
        } catch {
          return "corrupt";
        }
      },
    },
    "../../../../lib/sites": { getSite: async () => (siteExists ? { id: "site" } : null) },
    "../../../../lib/site-server": { siteIdOf: async () => "site" },
    "../../../../lib/site-document-service": { usesDocumentRooms: () => false },
  };
  const module = { exports: {} as Record<string, any> };
  new Function("require", "module", "exports", code)(
    (id: string) => Object.hasOwn(injected, id) ? injected[id] : require(id),
    module, module.exports,
  );
  return {
    get: (query: string) => module.exports.GET(new Request("https://editor.example.test/api/doc/backups?site=site" + query)) as Promise<Response>,
    reads,
  };
}

test("backup API rejects empty, noncanonical and repeated day selectors", async () => {
  const f = handler();
  for (const day of ["", "00", "01", "0x1", "1e0", "+1", "-0", "7", "1.0", "Infinity", " 1"]) {
    const response = await f.get("&day=" + encodeURIComponent(day));
    assert.equal(response.status, 400, JSON.stringify(day));
  }
  assert.equal((await f.get("&day=1&day=2")).status, 400);
  assert.deepEqual(f.reads, [], "invalid input must not touch the database");
});

test("backup API still accepts the seven documented weekdays and the listing mode", async () => {
  const f = handler();
  for (let day = 0; day <= 6; day++) {
    const response = await f.get("&day=" + day);
    assert.equal(response.status, 200, String(day));
    assert.deepEqual(await response.json(), { ok: true });
  }
  const list = await f.get("");
  assert.equal(list.status, 200);
  assert.deepEqual((await list.json()).backups, [{ day: 0, savedAt: 1, bytes: 12 }]);
  assert.equal(f.reads.length, 8);
});

test("backup API returns 404 for nonexistent sites and hides corrupt Japanese backup contents on 502", async () => {
  const missing = handler({ siteExists: false });
  assert.equal((await missing.get("")).status, 404);
  assert.equal((await missing.get("&day=0")).status, 404);

  const corrupt = handler({ body: '{"社外秘のテキスト": 壊れたJSON' });
  const res = await corrupt.get("&day=0");
  assert.equal(res.status, 502);
  const text = await res.text();
  assert.doesNotMatch(text, /社外秘/);
  assert.deepEqual(JSON.parse(text), { error: "Couldn't load" });
});
});

describe("backup-import-lifecycle", () => {
  before(() => {
    useEditor.setState({
      breakpoint: "base", customWidth: null, styleState: "default", mode: "design",
      pageTheme: "light", selection: null, selectedIds: [], editingComponentId: null, scriptEditor: null,
    });
  });
const state = () => useEditor.getState();
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  state().replaceDoc(createInitialDoc());
  const ui = importCallbacks("backup");
  const input = () => elements(ui.render()).find(e => e.type === "input" && e.props.type === "file");
  const start = (name: string) => {
    let resolve!: (value: ArrayBuffer) => void;
    const data = { ...createInitialDoc(), siteName: name };
    const file = { arrayBuffer: () => new Promise<ArrayBuffer>(r => { resolve = r; }) };
    input().props.onChange({ target: { files: [file], value: "file.json" } });
    return () => resolve(new TextEncoder().encode(JSON.stringify(data)).buffer);
  };
  return { ui, start, render: input };
}
for (const phase of ["read", "confirm"] as const) for (const invalidate of ["undo", "replace", "unmount"] as const) {
  test(`backup ${phase} is invalidated by ${invalidate}`, async () => {
    const f = fixture();
    state().updateDoc(d => { d.siteName = "Current"; });
    const finish = f.start("Old backup");
    if (phase === "confirm") { finish(); await tick(); assert.equal(f.ui.confirmations.length, 1); }
    if (invalidate === "undo") state().undo();
    if (invalidate === "replace") state().replaceDoc({ ...createInitialDoc(), siteName: "Replacement" });
    if (invalidate === "unmount") f.ui.unmount();
    const before = state().doc;
    if (phase === "read") { finish(); await tick(); assert.equal(f.ui.confirmations.length, 0); }
    else { f.ui.confirmations[0].resolve(true); await tick(); }
    assert.equal(state().doc, before);
    f.ui.unmount();
  });
}
test("a newer backup selection supersedes an earlier file read and restores with undo", async () => {
  const f = fixture(); const before = state().doc;
  const old = f.start("Old backup"); const latest = f.start("Chosen backup");
  latest(); await tick(); old(); await tick();
  assert.equal(f.ui.confirmations.length, 1);
  f.ui.confirmations[0].resolve(true); await tick();
  assert.equal(state().doc.siteName, "Chosen backup");
  state().undo(); assert.deepEqual(state().doc, before); f.ui.unmount();
});

test("oversized backup files are rejected before reading their bytes", async () => {
  const f = fixture(); const before = state().doc;
  let reads = 0;
  f.render().props.onChange({ target: { files: [{ size: 13 * 1024 * 1024, arrayBuffer: async () => { reads++; return new ArrayBuffer(0); } }], value: "large.json" } });
  await tick();
  assert.equal(reads, 0);
  assert.equal(f.ui.alerts.length, 1);
  assert.equal(f.ui.confirmations.length, 0);
  assert.equal(state().doc, before); f.ui.unmount();
});
});

describe("browser-local-storage-mode", () => {
test("browser-local mode disables server-side database and KV storage", () => {
  const old = process.env.TSUMU_STORAGE_MODE;
  try {
    process.env.TSUMU_STORAGE_MODE = "local";
    assert.equal(dbConfigured(), false);
    assert.equal(assetStore(), null);
  } finally {
    if (old === undefined) delete process.env.TSUMU_STORAGE_MODE;
    else process.env.TSUMU_STORAGE_MODE = old;
  }
});

test("direct WebSocket collaboration and scheduled KV garbage collection respect local mode", () => {
  const source = readFileSync(new URL("../custom-worker.ts", import.meta.url), "utf8");
  assert.match(source, /if \(env\.TSUMU_STORAGE_MODE === "local"\)\s*return;/);
  assert.match(source, /if \(env\.TSUMU_STORAGE_MODE === "local"\)\s*\{\s*return new Response\("Collaboration requires server-backed site storage", \{ status: 503 \}\);/);
});
});

describe("indexeddb-transactions", () => {
for (const mode of transactionCases) {
  test(`IndexedDB fixture: ${mode} preserves transaction atomicity`, { timeout: 5_000 }, async () => {
    assert.deepEqual(await transactionScenario(fakeIndexedDB(), mode), expectedTransaction(mode));
  });
}

const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
before(() => {
  Object.defineProperty(globalThis, "window", { configurable: true, value: { indexedDB: fakeIndexedDB() } });
});
after(() => {
  if (previous) Object.defineProperty(globalThis, "window", previous);
  else Reflect.deleteProperty(globalThis, "window");
});

test("browser document saves reopen an unexpectedly closed connection and still reject stale revisions", async (t) => {
  const opens = t.mock.method(window.indexedDB, "open");
  await createBrowserDoc("reopen", "original");
  const db = opens.mock.calls[0].result!.result;
  t.mock.method(db, "transaction", () => { throw new DOMException("Connection closed", "InvalidStateError"); });
  db.onclose?.call(db, new Event("close"));

  assert.equal(await writeBrowserDoc("reopen", "new edit", "original"), "saved");
  assert.equal(await writeBrowserDoc("reopen", "stale edit", "original"), "conflict");
  assert.equal(await readBrowserDoc("reopen"), "new edit");
  assert.equal(opens.mock.callCount(), 2);
  await deleteBrowserDoc("reopen");
});

test("real browser document storage serializes competing creates", { timeout: 5_000 }, async () => {
  assert.deepEqual(await browserDocumentCreateScenario(), expectedCreate);
});
test("real browser document storage rejects stale saves and preserves unrelated documents", { timeout: 5_000 }, async () => {
  assert.deepEqual(await browserDocumentScenario(), expectedDocument);
});

for (const abort of [false, true]) {
  test(`IndexedDB cursor ${abort ? "aborts queued reads" : "completes without continue"}`, { timeout: 5_000 }, async () => {
    assert.deepEqual(await cursorScenario(fakeIndexedDB(), abort), {
      outcome: abort ? "abort" : "complete", seen: ["one"],
    });
  });
}
});

describe("node-storage", () => {
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

test("file assets initialize on upload and retry after the directory becomes available", withDataDir(async (dir) => {
  const store = nodeAssetStore()!;
  const root = join(dir, "assets");
  const key = "assets/notes.txt";

  assert.equal(await store.get(key, { type: "arrayBuffer" }), null);
  await store.delete(key);
  assert.equal(existsSync(root), false);

  writeFileSync(root, "temporarily occupied");
  await assert.rejects(store.put(key, "notes"));
  rmSync(root);
  await store.put(key, "notes");
  assert.equal(new TextDecoder().decode((await store.get(key, { type: "arrayBuffer" }))!), "notes");
}));

test("failed asset writes remove the temporary file and can be retried", withDataDir(async (dir) => {
  const store = nodeAssetStore()!;
  const key = "assets/notes.txt";
  const name = assetFileName(key);
  const data = join(dir, "assets", "data");
  const destination = join(data, name);
  mkdirSync(destination, { recursive: true });

  await assert.rejects(store.put(key, "draft text"));
  assert.deepEqual(readdirSync(data), [name]);

  rmSync(destination, { recursive: true });
  await store.put(key, "final text");
  assert.equal(new TextDecoder().decode((await store.get(key, { type: "arrayBuffer" }))!), "final text");
  assert.deepEqual(readdirSync(data), [name]);
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
});

describe("site-access", () => {
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

test("unsupported storage_schema versions are rejected", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tsumu-schema-strict-"));
  const previous = process.env.TSUMU_DATA_DIR;
  process.env.TSUMU_DATA_DIR = dir;
  try {
    const db = await getDbFromBinding(nodeDatabase()!);
    const current = await db.execute({ sql: "SELECT version FROM storage_schema WHERE name='main'", args: [] });
    assert.equal(Number(current.rows[0]?.version), 1);

    const unsupportedBinding = {
      __tsumuBackend: "sqlite" as const,
      prepare(sql: string) {
        return {
          bind() { return this; },
          async all() {
            if (sql.includes("SELECT version FROM storage_schema")) {
              return { results: [{ version: 2 }] };
            }
            return { results: [] };
          },
        };
      },
      async batch(stmts: Array<{ all: () => Promise<{ results?: unknown[] }> }>) {
        return Promise.all(stmts.map((s) => s.all()));
      },
    };
    await assert.rejects(
      () => getDbFromBinding(unsupportedBinding as unknown as Parameters<typeof getDbFromBinding>[0]),
      /Unsupported storage schema/,
    );
  } finally {
    if (previous === undefined) delete process.env.TSUMU_DATA_DIR;
    else process.env.TSUMU_DATA_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});
});

describe("site-backup", () => {
test("a backup at the page limit can be restored and an oversized document is refused at export", async () => {
  const doc = createInitialDoc();
  const home = doc.pages[doc.pageOrder[0]];
  const addPage = () => {
    const id = "page_" + doc.pageOrder.length;
    doc.pages[id] = { ...home, id, slug: "/" + id, children: [] };
    doc.pageOrder.push(id);
  };
  while (doc.pageOrder.length < 500) addPage();
  const zip = await createSiteBackup(doc);
  const restored = await parseSiteImport(new Uint8Array(await zip.arrayBuffer()), "zip");
  assert.deepEqual(restored.doc.pageOrder, doc.pageOrder);
  addPage();
  await assert.rejects(createSiteBackup(doc), /Invalid page, element or asset data/);
});

test("manual backup contains every asset byte, including unused images, fonts and embedded files", async () => {
  const doc = createInitialDoc();
  const image = new Uint8Array([0, 255, 1, 10, 27, 13]);
  const font = new Uint8Array([119, 79, 70, 50, 2, 1]);
  const inline = new Uint8Array([0, 19, 255, 17]);
  doc.assets.logo = {
    id: "logo", name: "ロゴ.png", path: "assets/logo.png", mimeType: "image/png",
    bytes: image.length, width: 1, height: 1,
  };
  doc.assets.font = {
    id: "font", name: "custom.woff2", path: "assets/custom.woff2", mimeType: "font/woff2",
    bytes: font.length, width: 0, height: 0,
  };
  doc.assets.unused = {
    id: "unused", name: "unused.bin", mimeType: "application/octet-stream",
    dataUrl: "data:application/octet-stream;base64," + Buffer.from(inline).toString("base64"),
    width: 0, height: 0,
  };
  const expected = JSON.stringify(doc);
  const responses = new Map([["assets/logo.png", image], ["assets/custom.woff2", font]]);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = String(input);
    if (!url.startsWith("/api/assets/file?")) return originalFetch(input, init);
    const bytes = responses.get(new URL(url, "https://example.test").searchParams.get("path") ?? "");
    return Promise.resolve(bytes
      ? new Response(new Blob([bytes]), { headers: { "Content-Type": "application/octet-stream" } })
      : new Response(null, { status: 404 }));
  };
  try {
    const blob = await createSiteBackup(doc);
    const archiveBytes = new Uint8Array(await blob.arrayBuffer());
    const archive = await ZipArchive.open(archiveBytes);
    assert.ok(archive.file(EDITABLE_DOC_PATH));
    assert.ok(archive.file(EDITABLE_ASSETS_PATH));
    const parsed = await parseSiteImport(archiveBytes, "zip");
    assert.deepEqual(parsed.doc, doc);
    assert.deepEqual(parsed.warnings, []);
    assert.equal(parsed.assets.size, 3);
    assert.deepEqual(parsed.assets.get("logo"), image);
    assert.deepEqual(parsed.assets.get("font"), font);
    assert.deepEqual(parsed.assets.get("unused"), inline);
    assert.equal(JSON.stringify(doc), expected, "backup must not modify the edited document");
    const names = Object.values(JSON.parse(await archive.file(EDITABLE_ASSETS_PATH)!.text()).assets);
    assert.equal(new Set(names).size, names.length, "all archive paths must be unique");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("manual backup refuses missing files instead of downloading a broken archive", async () => {
  const doc = createInitialDoc();
  doc.assets.missing = {
    id: "missing", name: "removed.svg", path: "assets/missing.svg",
    mimeType: "image/svg+xml", width: 10, height: 10,
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => Promise.resolve(new Response(null, { status: 404 }));
  try {
    await assert.rejects(createSiteBackup(doc), /removed.svg/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("manual backup enforces per-asset size even for a misleading server response", async () => {
  const doc = createInitialDoc();
  doc.assets.large = {
    id: "large", name: "large.mp4", path: "assets/large.mp4",
    mimeType: "video/mp4", width: 0, height: 0,
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => Promise.resolve(new Response(new Uint8Array([1]), {
    headers: { "Content-Length": String(25 * 1024 * 1024 + 1) },
  }));
  try {
    await assert.rejects(createSiteBackup(doc), /large.mp4/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("manual backup refuses assets with no recoverable file contents", async () => {
  const doc = createInitialDoc();
  doc.assets.unavailable = {
    id: "unavailable", name: "lost.wav", mimeType: "audio/wav", width: 0, height: 0,
  };
  await assert.rejects(createSiteBackup(doc), /lost.wav/);
});
});

describe("site-copy-concurrency", () => {
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
  const injected = { DEFAULT_BRANCH: siteModel.DEFAULT_BRANCH, DEFAULT_PREVIEW_BRANCH: siteModel.DEFAULT_PREVIEW_BRANCH, deleteSite: sites.deleteSite, getSite: sites.getSite, insertSite: sites.insertSite, isSiteId: siteModel.isSiteId, listSites: sites.listSites, normalizeSiteInput: siteModel.normalizeSiteInput, newSiteId: () => "copy", NextResponse, dbUnavailable: () => { throw new Error("Unexpected fallback"); }, serverTr: async () => (text: string) => text,
    requireAuth: async () => null, requireSiteAccess: async () => null, dbConfigured: () => true, getDb: async () => db, userMessage,
    readSiteDocument: read, saveSiteDocument: saveCurrentDoc,
    getSiteRoomKey: sites.getSiteRoomKey,
    cleanupAbandonedDocuments: async () => undefined,
    eraseSiteDocument: async () => undefined,
    validateImportedDoc, IMPORT_LIMITS, extractAssetReferences, readJsonLimited, readJsonObjectLimited, jsonErrorStatus, JsonBodyTooLargeError, JsonContentTypeError };
  const post = new Function(...Object.keys(injected), `${source}\nreturn POST;`)(...Object.values(injected));
  return (input: unknown = { name: "Copy", copyFrom: "source" }) => post(new Request("https://example.test/api/sites", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) })) as Promise<Response>;
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
test("a captured source document remains usable if the source is deleted afterwards and copies asset ownership", async () => database(async db => {
  const sourceDoc = createInitialDoc();
  sourceDoc.siteName = "Saved";
  sourceDoc.assets.hero = { id: "hero", name: "hero.png", path: "assets/muhmi2o0abcdef-hero.png", width: 4, height: 4 };
  await saveCurrentDoc(db, "source", JSON.stringify(sourceDoc), null);
  const response = await api(db, async (db, id) => { const snapshot = await readCurrentDoc(db, id); await sites.deleteSite(db, id); return snapshot; })();
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse((await readCurrentDoc(db, "copy"))!.body), sourceDoc);
  const uploads = await db.execute({ sql: "SELECT path FROM site_asset_uploads WHERE site_id=?", args: ["copy"] });
  assert.deepEqual(uploads.rows.map((r) => r.path), ["assets/muhmi2o0abcdef-hero.png"]);
}));
test("an unsuccessful destination save is not reported as a completed copy", async () => database(async db => {
  const sourceDoc = createInitialDoc();
  sourceDoc.siteName = "Saved";
  await saveCurrentDoc(db, "source", JSON.stringify(sourceDoc), null);
  await db.execute("CREATE TRIGGER fail_copy BEFORE INSERT ON docs WHEN NEW.id='copy' BEGIN SELECT RAISE(ABORT, 'simulated failure'); END");
  const response = await api(db)();
  assert.equal(response.status, 502);
  assert.equal(await sites.getSite(db, "copy"), null);
}));

test("importing atomically creates revision one and rejects invalid, asset-bearing, or colliding imports without changing existing data", async () => database(async db => {
  // 完全で現在の形の SiteDoc を使う。取り込みの境界では、不完全なページのメタデータを拒否しなければならない。
  const doc = createInitialDoc();
  doc.siteName = "Imported";
  const input = { name: doc.siteName, initialDoc: doc, importId: "0123456789" };
  const post = api(db);
  assert.equal((await post({ ...input, initialDoc: { ...doc, pageOrder: ["absent"] } })).status, 400);
  assert.equal((await post({
    ...input,
    initialDoc: { ...doc, favicon: "assets/muhmi2o0abcdef-secret.png" },
  })).status, 400);
  assert.equal(await sites.getSite(db, input.importId), null);
  assert.equal((await post(input)).status, 200);
  assert.equal((await readCurrentDoc(db, input.importId))?.rev, "1");
  assert.equal((await post({ ...input, initialDoc: { ...doc, note: "replacement" } })).status, 409);
  assert.deepEqual(JSON.parse((await readCurrentDoc(db, input.importId))!.body), doc);
}));
});

describe("site-create-generation", () => {
const copyRequest = (input: unknown = { name: "Copy", copyFrom: "source" }) => new Request("https://editor.example.test/api/sites", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
});
const imported = { name: original.siteName, importId: "0123456789", initialDoc: original };

for (const importing of [false, true]) {
  test(`${importing ? "import" : "copy"} rolls back its own generation if document routing lookup fails`, async t => {
    const f = await setup(t); await f.create("source");
    const id = importing ? imported.importId : "destination";
    let createdKey: string | null = null;
    f.hooks.afterBatch = async stmts => {
      if (stmts.some(stmt => /INSERT INTO sites/.test(sqlOf(stmt)) && argOf(stmt) === id)) {
        createdKey = await sites.getSiteRoomKey(f.rawDb, id);
      }
    };
    f.hooks.beforeExecute = async stmt => { if (isRoomLookup(stmt, id)) throw new Error("Synthetic transient D1 failure"); };
    const response = await f.sites.POST(copyRequest(importing ? imported : undefined));
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: "Couldn't create it" });
    assert.ok(createdKey);
    assert.equal(await sites.getSite(f.rawDb, id), null);
    assert.equal(await sites.getSiteRoomKey(f.rawDb, id), null);
    assert.equal(f.room(createdKey).replace(JSON.stringify(original), null).kind, "missing");
    f.hooks.beforeExecute = undefined;
    assert.equal((await f.sites.POST(copyRequest(importing ? imported : undefined))).status, 200, "retry is not blocked by an empty site");
  });
}

for (const timing of ["before target lookup", "during RPC", "after RPC", "final response lookup"] as const) {
  for (const replacementDoc of [null, replacement]) {
    test(`copy rejects a replacement ${timing}, preserving its ${replacementDoc ? "document" : "empty room"}`, async t => {
      const f = await setup(t); await f.create("source");
      let replacementKey: string | undefined;
      const replace = async () => { replacementKey = await f.replace("destination", replacementDoc); };
      if (timing === "before target lookup") {
        f.hooks.afterBatch = async stmts => {
          if (stmts.some(stmt => /INSERT INTO sites/.test(sqlOf(stmt)) && argOf(stmt) === "destination")) {
            f.hooks.afterBatch = undefined;
            await replace();
          }
        };
      } else if (timing === "during RPC" || timing === "after RPC") {
        const hook = timing === "during RPC" ? "beforeRoomWrite" : "afterRoomWrite";
        f.hooks[hook] = async () => { f.hooks[hook] = undefined; await replace(); };
      } else {
        f.hooks.beforeExecute = async stmt => {
          if (/SELECT s\.\*/.test(sqlOf(stmt)) && argOf(stmt) === "destination") {
            f.hooks.beforeExecute = undefined; await replace();
          }
        };
      }
      const response = await f.sites.POST(copyRequest());
      assert.equal(response.status, 502);
      assert.deepEqual(await response.json(), { error: "Couldn't create it" });
      assert.ok(replacementKey);
      assert.equal((await sites.getSite(f.rawDb, "destination"))?.name, "Replacement owner");
      assert.equal(await sites.getSiteRoomKey(f.rawDb, "destination"), replacementKey);
      const snapshot = f.room(replacementKey).snapshot();
      assert.deepEqual(snapshot ? JSON.parse(snapshot.body) : null, replacementDoc);
      if (!replacementDoc) {
        assert.equal(f.room(replacementKey).replace(JSON.stringify(replacement), null).kind, "saved", "replacement is not sealed");
      }
    });
  }
}

test("copy rejects a generation deleted while initialization RPC completes", async t => {
  const f = await setup(t); await f.create("source"); let createdKey: string | undefined;
  f.hooks.afterRoomWrite = async key => {
    f.hooks.afterRoomWrite = undefined; createdKey = key;
    await sites.deleteSite(f.rawDb, "destination", key);
  };
  const response = await f.sites.POST(copyRequest());
  assert.equal(response.status, 502);
  assert.equal(await sites.getSite(f.rawDb, "destination"), null);
  assert.ok(createdKey);
  assert.equal(f.room(createdKey).replace(JSON.stringify(original), null).kind, "missing");
});

test("failed D1 rollback and cleanup never target a replacement generation", async t => {
  const f = await setup(t); await f.create("source"); let replacementKey: string | undefined;
  const attemptedErase: string[] = [];
  f.hooks.afterBatch = async stmts => {
    if (stmts.some(stmt => /INSERT INTO sites/.test(sqlOf(stmt)) && argOf(stmt) === "destination")) {
      f.hooks.afterBatch = undefined;
      replacementKey = await f.replace("destination", replacement);
    }
  };
  f.hooks.beforeBatch = async stmts => {
    if (stmts.some(stmt => /DELETE FROM sites/.test(sqlOf(stmt)))) throw new Error("Synthetic rollback failure");
  };
  f.hooks.beforeErase = async key => { attemptedErase.push(key); throw new Error("Synthetic cleanup failure"); };
  f.hooks.beforeExecute = async stmt => {
    if (/SELECT room_key FROM document_room_cleanup/.test(sqlOf(stmt))) throw new Error("Synthetic cleanup queue failure");
  };
  const response = await f.sites.POST(copyRequest());
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: "Couldn't create it" });
  assert.ok(replacementKey);
  assert.equal(attemptedErase.length, 1);
  assert.ok(!attemptedErase.includes(replacementKey));
  assert.equal(await sites.getSiteRoomKey(f.rawDb, "destination"), replacementKey);
  assert.deepEqual(JSON.parse(f.room(replacementKey).snapshot()!.body), replacement);
});

test("ordinary D1 creation, copy, and import retain public response shapes without generation keys", async t => {
  const f = await setup(t); await f.create("source");
  for (const input of [{ name: "Empty" }, { name: "Copy", copyFrom: "source" }, imported]) {
    const id = "importId" in input ? input.importId : "destination";
    const response = await f.sites.POST(copyRequest(input));
    assert.equal(response.status, 200);
    const payload = await response.json();
    const key = (await sites.getSiteRoomKey(f.rawDb, id))!;
    assert.deepEqual(Object.keys(payload), ["site"]);
    assert.equal(payload.site.id, id);
    assert.ok(!JSON.stringify(payload).includes(key));
    assert.ok(!Object.hasOwn(payload.site, "roomKey"));
    if ("copyFrom" in input || "importId" in input) assert.deepEqual(JSON.parse(f.room(key).snapshot()!.body), original);
    else assert.equal(f.room(key).snapshot(), null);
    await sites.deleteSite(f.rawDb, id, key);
  }
});

test("insertSite returns only the generation it created and getSite can require that generation", async t => {
  const f = await setup(t);
  const key = await sites.insertSite(f.rawDb, "destination", {
    name: "Original", repo: null, branch: "main", previewBranch: "preview", siteUrl: null, previewUrl: null,
  });
  assert.ok(key);
  assert.equal(key, await sites.getSiteRoomKey(f.rawDb, "destination"));
  assert.equal((await sites.getSite(f.rawDb, "destination", key))?.name, "Original");
  await f.replace("destination", replacement);
  assert.equal(await sites.getSite(f.rawDb, "destination", key), null);
  assert.equal((await sites.getSite(f.rawDb, "destination"))?.name, "Replacement owner");
});
});

describe("site-import", () => {
const enc = new TextEncoder();

function fixture() {
  const doc = createInitialDoc();
  doc.siteName = "Imported and editable";
  doc.assets = {
    "original-image": {
      id: "original-image", name: "logo.svg", width: 12, height: 12,
      mimeType: "image/svg+xml", path: "assets/old-reference",
    },
  };
  return doc;
}

test("an import timeout reconciles the reserved site before uploading assets", async t => {
  const doc = createInitialDoc();
  doc.assets.sheet = { id: "sheet", name: "style.css", mimeType: "text/css", width: 0, height: 0, dataUrl: "data:text/css,body%7B%7D" };
  const file = new File([JSON.stringify(doc)], "doc.json");
  const nativeFetch = globalThis.fetch;
  let siteId = "";
  let visible = false;
  let saved: typeof doc | null = null;
  const actions: string[] = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    if (String(url).startsWith("data:")) return nativeFetch(url, init);
    actions.push(init?.method ?? "GET");
    if (url === "/api/sites" && init?.method === "POST") {
      siteId = JSON.parse(String(init.body)).importId;
      return Response.json({ error: "Request timed out" }, { status: 408 });
    }
    if (url === "/api/sites/" + siteId && !init?.method)
      return Response.json(visible ? { site: { id: siteId } } : { error: "Not found" }, { status: visible ? 200 : 404 });
    if (url === "/api/assets") {
      assert.equal((init!.body as FormData).get("site"), siteId);
      return Response.json({ path: "assets/stylesheet" });
    }
    if (url === "/api/doc?site=" + siteId && init?.method === "PUT") {
      saved = JSON.parse(String(init.body));
      return Response.json({ ok: true, rev: "1" });
    }
    if (url === "/api/sites/" + siteId && init?.method === "PATCH") {
      assert.equal(JSON.parse(String(init.body)).name, doc.siteName);
      return Response.json({ site: { id: siteId } });
    }
    throw new Error("Unexpected request: " + String(url));
  });
  await assert.rejects(createSiteFromFile(file, "server"), /Could not confirm the save/);
  visible = true;
  assert.equal((await createSiteFromFile(file, "server")).id, siteId);
  assert.ok(saved?.assets.sheet.path);
  assert.deepEqual(actions, ["POST", "GET", "POST", "GET", "POST", "PUT", "PATCH"]);
});

test("local doc.json restores an editable SiteDoc and original IDs", async () => {
  const doc = fixture();
  const result = await parseSiteImport(enc.encode(JSON.stringify(doc)), "doc");
  assert.deepEqual(result.doc, doc);
  assert.equal(result.doc.assets["original-image"].id, "original-image");
  assert.equal(result.assets.size, 0);
  assert.deepEqual(result.warnings, []);
});

test("nested export ZIP includes editable source and exact original asset mapping", async () => {
  const doc = fixture();
  const zip = new ZipBuilder();
  const root = zip.folder("example-site");
  const assetName = buildAssetNames(doc).get("original-image")!;
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12"/>';
  root.file(EDITABLE_DOC_PATH, JSON.stringify(doc));
  root.file(EDITABLE_ASSETS_PATH, JSON.stringify({
    version: 1, assets: { "original-image": "public/assets/" + assetName },
  }));
  root.file("public/assets/" + assetName, svg);
  root.file("app/page.tsx", "export default function Page() {}");
  const bytes = await zip.toBytes();
  const result = await parseSiteImport(bytes, "zip");
  assert.deepEqual(result.warnings, []);
  assert.equal(result.doc.assets["original-image"].path, "assets/old-reference");
  assert.equal(new TextDecoder().decode(result.assets.get("original-image")), svg);
});

test("home opens an editable ZIP once and rejects its missing asset manifest", async (t) => {
  const zip = new ZipBuilder();
  zip.file(EDITABLE_DOC_PATH, JSON.stringify(fixture()));
  const file = new File([await zip.toBytes()], "site.zip");
  const reads = t.mock.method(file, "arrayBuffer");
  const opens = t.mock.method(ZipArchive, "open");
  await assert.rejects(createSiteFromFile(file, "server"), /_tsumu\/assets\.json/);
  assert.equal(reads.mock.callCount(), 1);
  assert.equal(opens.mock.callCount(), 1);
});

test("missing asset bytes in a current ZIP produce warnings without guessing paths", async () => {
  const zip = new ZipBuilder();
  zip.file(EDITABLE_DOC_PATH, JSON.stringify(fixture()));
  zip.file(EDITABLE_ASSETS_PATH, JSON.stringify({
    version: 1, assets: { "original-image": "public/assets/logo.svg" },
  }));
  const result = await parseSiteImport(
    await zip.toBytes(), "zip");
  assert.equal(result.assets.size, 0);
  assert.match(result.warnings.join("\n"), /logo.svg/);
});

test("unmapped archive paths cannot substitute for an explicitly mapped asset", async () => {
  const doc = fixture();
  const zip = new ZipBuilder();
  zip.file(EDITABLE_DOC_PATH, JSON.stringify(doc));
  zip.file(EDITABLE_ASSETS_PATH, JSON.stringify({
    version: 1, assets: { "original-image": "public/assets/current-logo.svg" },
  }));
  zip.file("unmapped/logo.svg", "<svg/>");
  zip.file("attachments/logo.svg", "<svg/>");
  const result = await parseSiteImport(await zip.toBytes(), "zip");
  assert.equal(result.assets.size, 0);
  assert.match(result.warnings.join("\n"), /logo.svg/);
});

test("malformed or incomplete ZIP asset manifests are rejected", async () => {
  for (const manifest of [
    { version: 2, assets: { "original-image": "public/assets/logo.svg" } },
    { version: 1, assets: {} },
    { version: 1, assets: { "original-image": "../escape.svg" } },
  ]) {
    const zip = new ZipBuilder();
    zip.file(EDITABLE_DOC_PATH, JSON.stringify(fixture()));
    zip.file(EDITABLE_ASSETS_PATH, JSON.stringify(manifest));
    await assert.rejects(parseSiteImport(
      await zip.toBytes(), "zip"), /asset manifest/);
  }
});

test("embedded data URLs remain valid when ZIP asset bytes are missing", async () => {
  const doc = fixture();
  doc.assets["original-image"].dataUrl = "data:image/svg+xml;base64,PHN2Zy8+";
  const zip = new ZipBuilder();
  zip.file(EDITABLE_DOC_PATH, JSON.stringify(doc));
  zip.file(EDITABLE_ASSETS_PATH, JSON.stringify({
    version: 1, assets: { "original-image": "public/assets/logo.svg" },
  }));
  const result = await parseSiteImport(
    await zip.toBytes(), "zip");
  assert.deepEqual(result.warnings, []);
  assert.equal(result.doc.assets["original-image"].dataUrl, doc.assets["original-image"].dataUrl);
});

test("non-editor HTML ZIP is not confused with SiteDoc archive", async () => {
  const zip = new ZipBuilder();
  zip.file("index.html", "<html><body>Not an editor project</body></html>");
  await assert.rejects(parseSiteImport(await zip.toBytes(),
    "zip"), /_tsumu\/doc\.json/);
});

test("document validation rejects corrupt references and unsafe object keys", () => {
  const doc = fixture();
  const bad = { ...doc, pageOrder: ["missing-page"] };
  assert.throws(() => validateImportedDoc(bad), /page references/i);
  const corrupt = JSON.parse(JSON.stringify(doc));
  Object.defineProperty(corrupt.assets, "__proto__", {
    value: { id: "__proto__", name: "bad" }, enumerable: true, configurable: true,
  });
  assert.throws(() => validateImportedDoc(corrupt), /property names/i);
});

test("ZIP source limits reject oversized and enormous archives", async () => {
  await assert.rejects(parseSiteImport(new Uint8Array(IMPORT_LIMITS.zipBytes + 1),
    "zip"), /too large/);
  const zip = new ZipBuilder();
  zip.file(EDITABLE_DOC_PATH, JSON.stringify(fixture()));
  for (let i = 0; i < IMPORT_LIMITS.entries + 1; i++) {
    zip.file("extra/" + i + ".txt", "x");
  }
  await assert.rejects(parseSiteImport(await zip.toBytes(),
    "zip"), /too many files/);
});

test("local file picker accepts ZIP, JSON and HTML and rejects other formats", () => {
  assert.equal(importFileKind({ name: "website.zip" }), "zip");
  assert.equal(importFileKind({ name: "doc.json" }), "doc");
  assert.equal(importFileKind({ name: "custom-name.json" }), "doc");
  assert.equal(importFileKind({ name: "index.html" }), "html");
  assert.equal(importFileKind({ name: "about.htm" }), "html");
  assert.throws(() => importFileKind({ name: "notes.txt" }), /ZIP/);
});

test("archives with multiple editable documents are rejected before restoring assets", async () => {
  const zip = new ZipBuilder();
  zip.file("first/_tsumu/doc.json", JSON.stringify(fixture()));
  zip.file("second/_tsumu/doc.json", JSON.stringify(fixture()));
  await assert.rejects(parseSiteImport(await zip.toBytes(),
    "zip"), /multiple editor documents/);
});

test("document imports reject network references disguised as embedded assets before fetching", async () => {
  const doc = fixture();
  for (const url of ["/api/doc?site=private", "https://example.test/logo", "//example.test/logo"]) {
    doc.assets["original-image"].dataUrl = url;
    await assert.rejects(parseSiteImport(enc.encode(JSON.stringify(doc)), "doc"), /asset/i);
  }
});

test("editable ZIP manifests cannot expand the same archive member once per asset ID", async () => {
  const doc = fixture();
  doc.assets.second = { ...doc.assets["original-image"], id: "second" };
  const zip = new ZipBuilder();
  zip.file(EDITABLE_DOC_PATH, JSON.stringify(doc));
  zip.file(EDITABLE_ASSETS_PATH, JSON.stringify({
    version: 1, assets: { "original-image": "assets/logo.svg", second: "assets/logo.svg" },
  }));
  zip.file("assets/logo.svg", "unique file");
  await assert.rejects(parseSiteImport(await zip.toBytes(), "zip"), /asset manifest/);
});

test("document imports reject dangling references, malformed nodes, and cycles in the flat node map", async () => {
  const doc = fixture();
  const root = doc.pages[doc.pageOrder[0]].children[0];
  for (const node of [null, { ...doc.nodes[root], children: ["absent"] },
    { ...doc.nodes[root], children: [root] }]) {
    const value = { ...doc, nodes: { ...doc.nodes, [root]: node } };
    await assert.rejects(parseSiteImport(enc.encode(JSON.stringify(value)), "doc"), /element/i);
  }
});

test("imports reject page roots shared with another page or parent node", () => {
  const doc = fixture();
  const page = doc.pages[doc.pageOrder[0]];
  const child = page.children[0];
  assert.ok(child);
  const sharedPage = structuredClone(doc);
  sharedPage.pages.other = { ...structuredClone(page), id: "other", slug: "other" };
  sharedPage.pageOrder.push("other");
  assert.throws(() => validateImportedDoc(sharedPage), /element hierarchy/i);
  const nested = structuredClone(doc);
  nested.nodes.extra = { ...structuredClone(doc.nodes[child]), id: "extra", children: [child] };
  assert.throws(() => validateImportedDoc(nested), /element hierarchy/i);
});

test("editable ZIP imports accept a zero-byte asset alongside the document", async () => {
  const doc = fixture();
  const zip = new ZipBuilder().file(EDITABLE_DOC_PATH, JSON.stringify(doc))
    .file(EDITABLE_ASSETS_PATH, JSON.stringify({ version: 1, assets: { "original-image": "assets/empty.svg" } }))
    .file("assets/empty.svg", "");
  const result = await parseSiteImport(await zip.toBytes(), "zip");
  assert.equal(result.assets.get("original-image")?.length, 0);
});

test("restored URLs follow the newly stored asset without copying a signature into the new document", async () => {
  const { restoreImportAssets } = await import("../lib/site-import");
  const doc = fixture();
  const asset = doc.assets["original-image"];
  asset.name = "data.txt";
  asset.mimeType = "text/plain";
  const old = "/api/assets/file?path=assets%2Fold-reference";
  const page = doc.pages[doc.pageOrder[0]];
  page.customEndHtml = '<!-- ' + old + ' --><script>const literal="' + old + '"</script>' +
    '<img data-src="' + old + '" src="' + old + '&amp;sig=private#icon"><style>i{background:url(' + old + ')}</style>';
  page.bodyStyles = { base: { default: { backgroundImage: 'url("' + old + '#icon")' } } };
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ path: "assets/new" });
  try {
    const { doc: restored, createdPaths } = await restoreImportAssets({
      doc, assets: new Map([[asset.id, enc.encode("contents")]]), warnings: [],
    });
    assert.deepEqual(createdPaths, ["assets/new"]);
    const p = restored.pages[page.id];
    assert.ok(p.customEndHtml?.includes('data-src="' + old + '" src="/api/assets/file?path=assets%2Fnew#icon"'));
    assert.ok(p.customEndHtml?.includes("url(/api/assets/file?path=assets%2Fnew)"));
    assert.ok(p.customEndHtml?.includes('<!-- ' + old + ' --><script>const literal="' + old + '"'));
    assert.ok(!p.customEndHtml?.includes("private"));
    assert.equal(p.bodyStyles?.base?.default?.backgroundImage, 'url("/api/assets/file?path=assets%2Fnew#icon")');
    assert.equal(doc.assets[asset.id].path, "assets/old-reference");
    const missing = await restoreImportAssets({ doc, assets: new Map(), warnings: [] });
    assert.equal(missing.doc.assets[asset.id].path, undefined);
    assert.ok(!missing.doc.pages[page.id].customEndHtml?.includes(' src="' + old));
  } finally { globalThis.fetch = original; }
});

test("an upload without a registered destination is never accepted as a restored file", async () => {
  const { uploadStaticAsset } = await import("../lib/assets");
  const original = globalThis.fetch;
  try {
    for (const path of [undefined, {}, "assets/", "https://other.test/file"]) {
      globalThis.fetch = async (_input, init) => {
        assert.equal(init?.credentials, "same-origin");
        assert.equal(init?.redirect, "error");
        return Response.json({ path });
      };
      await assert.rejects(uploadStaticAsset(new File(["test"], "a.txt", { type: "text/plain" })), /uploaded|upload/i);
    }
  } finally { globalThis.fetch = original; }
});
});

describe("site-room-generation", () => {
function withFreshDb(run: (db: Awaited<ReturnType<typeof getDbFromBinding>>) => Promise<void>) {
  return async () => {
    const dir = mkdtempSync(join(tmpdir(), "tsumu-room-keys-"));
    const old = process.env.TSUMU_DATA_DIR;
    process.env.TSUMU_DATA_DIR = dir;
    try {
      const sqlite = nodeDatabase()!;
      // 自前でホストするときのアダプターのモード（SiteDoc の JSON をローカルの docs に保存する）ではなく、
      // 本番の D1 の SQL のスキーマを、実際の SQLite に対して実行する。
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
});

describe("site-settings-concurrency", () => {
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
  const injected = { NextResponse, JsonBodyTooLargeError, JsonContentTypeError, jsonErrorStatus, readJsonLimited, readJsonObjectLimited, dbUnavailable: () => { throw new Error("Unexpected fallback"); }, serverTr: async () => (text: string) => text,
    requireAuth: async () => null, requireSiteAccess: async () => null, siteRole: async () => "owner", sessionUser: async () => null, dbConfigured: () => true, getDb: async () => db, userMessage,
    deleteSite: deleteSite, getSite: getSite, isSiteId: isSiteId, normalizeSiteInput: normalizeSiteInput, updateSite };
  const patch = new Function(...Object.keys(injected), `${source}\nreturn PATCH;`)(...Object.values(injected));
  return (input: unknown, contentType = "application/json") => patch(new Request("https://example.test/api/sites/site", { method: "PATCH", headers: { "Content-Type": contentType }, body: JSON.stringify(input) }), { params: Promise.resolve({ id: "site" }) }) as Promise<Response>;
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
  for (const input of [
    [],
    { branch: "release.lock/site" },
    { previewBranch: "preview.lock/nested/branch" },
    { siteUrl: "https://user:pass@example.com" },
    { previewUrl: "https://[" },
    { siteUrl: "https://example.com\\evil" },
  ]) {
    assert.equal((await api(db)(input)).status, 400);
    assert.deepEqual(await getSite(db, "site"), before);
  }
  assert.equal((await api(db)({ branch: "release/v2", previewBranch: "previews/v2", siteUrl: "https://example.com" })).status, 200);
}));


test("oversized site-settings PATCH is rejected without modifying settings", async () => database(async db => {
  const before = await getSite(db, "site");
  const response = await api(db)({ name: "x".repeat(128 * 1024) });
  assert.equal(response.status, 413);
  assert.deepEqual(await getSite(db, "site"), before);
}));


test("site settings reject non-JSON Content-Type without touching the database", async () => database(async db => {
  const before = await getSite(db, "site");
  const response = await api(db)({ name: "Injected" }, "text/plain");
  assert.equal(response.status, 415);
  assert.deepEqual(await getSite(db, "site"), before);
}));

test("repositories cannot be shared across sites on the same Git provider", async () => database(async db => {
  await assert.rejects(
    insertSite(db, "other", {
      name: "Other", repo: "Owner/Original", branch: "main", previewBranch: "preview", siteUrl: null, previewUrl: null,
    }),
    /This repository is already used by another site/,
  );

  const gitlabAllowed = await insertSite(db, "gitlab-site", {
    name: "GitLab", gitProvider: "gitlab", repo: "Owner/Original", branch: "main", previewBranch: "preview", siteUrl: null, previewUrl: null,
  });
  assert.equal(gitlabAllowed, null);
  assert.equal((await getSite(db, "gitlab-site"))?.gitProvider, "gitlab");

  await insertSite(db, "second", {
    name: "Second", repo: null, branch: "main", previewBranch: "preview", siteUrl: null, previewUrl: null,
  });
  const secondBefore = (await getSite(db, "second"))!;
  await assert.rejects(
    updateSite(db, "second", {
      name: "Second", repo: "OWNER/ORIGINAL", branch: "main", previewBranch: "preview", siteUrl: null, previewUrl: null,
    }, secondBefore),
    /This repository is already used by another site/,
  );

  await insertSite(db, "taken", {
    name: "Taken", repo: "owner/taken", branch: "main", previewBranch: "preview", siteUrl: null, previewUrl: null,
  });
  const patchConflict = await api(db)({ repo: "Owner/Taken" });
  assert.equal(patchConflict.status, 409);
  assert.equal((await patchConflict.json()).error, "This repository is already used by another site");
}));

test("editors can rename a site but only owners can modify publication destinations", async () => database(async db => {
  class NextResponse extends Response {
    static json(data: unknown, init?: ResponseInit) { return new NextResponse(JSON.stringify(data), init); }
  }
  const source = stripTypeScriptTypes(readFileSync(new URL("../app/api/sites/[id]/route.ts", import.meta.url), "utf8"))
    .replace(/^import[\s\S]*?;\n/gm, "").replace(/^export /gm, "");
  const checks: string[] = [];
  const injected = {
    NextResponse, JsonBodyTooLargeError, JsonContentTypeError, jsonErrorStatus, readJsonLimited, readJsonObjectLimited,
    dbUnavailable: () => { throw new Error("Unexpected fallback"); },
    serverTr: async () => (text: string) => text,
    requireAuth: async () => null,
    requireSiteAccess: async (_id: string, action: string) => {
      checks.push(action);
      return action === "manage" ? NextResponse.json({ error: "Owner required" }, { status: 403 }) : null;
    },
    siteRole: async () => "editor",
    sessionUser: async () => ({ email: "editor@example.test" }),
    dbConfigured: () => true,
    getDb: async () => db,
    userMessage,
    deleteSite, getSite, isSiteId, normalizeSiteInput, updateSite,
  };
  const patch = new Function(...Object.keys(injected), `${source}\nreturn PATCH;`)(...Object.values(injected));
  const call = (input: unknown) => patch(new Request("https://example.test/api/sites/site", {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
  }), { params: Promise.resolve({ id: "site" }) }) as Promise<Response>;

  const rename = await call({ name: "Editor Renamed" });
  assert.equal(rename.status, 200);
  assert.deepEqual(checks, ["view", "edit"]);

  for (const destChange of [
    { repo: "owner/new-repo" },
    { branch: "release" },
    { previewBranch: "staging" },
    { siteUrl: "https://example.com" },
    { previewUrl: "https://preview.example.com" },
    { gitProvider: "gitlab", repo: "owner/original" },
  ]) {
    checks.length = 0;
    const denied = await call(destChange);
    assert.equal(denied.status, 403, JSON.stringify(destChange));
    assert.deepEqual(checks, ["view", "edit", "manage"]);
  }
  assert.equal((await getSite(db, "site"))?.repo, "owner/original");
}));
});

describe("site-thumbnail", () => {
function doc(overrides: Partial<SiteDoc> = {}): SiteDoc {
  return {
    pages: { index: { id: "index", name: "Home", slug: "", title: "", description: "", children: [] } },
    pageOrder: ["index"],
    assets: {},
    ...overrides,
  } as SiteDoc;
}

test("site thumbnails prefer the home page OGP, site OGP, and favicon", () => {
  const site = doc({
    pages: { index: { id: "index", name: "Home", slug: "", title: "", description: "", children: [],
      ogImage: { url: "https://example.test/home.png" } } },
    ogImage: { url: "https://example.test/default.png" },
    favicon: { url: "https://example.test/favicon.ico" },
  });
  assert.deepEqual(siteThumbnailImages(site, "site1"), [
    { kind: "ogp", src: "https://example.test/home.png" },
    { kind: "ogp", src: "https://example.test/default.png" },
    { kind: "favicon", src: "https://example.test/favicon.ico" },
  ]);
});

test("site thumbnails fall back through missing references to the favicon and initials", () => {
  assert.deepEqual(siteThumbnailImages(doc({ favicon: { url: "https://example.test/favicon.ico" } }), "site1"), [
    { kind: "favicon", src: "https://example.test/favicon.ico" },
  ]);
  assert.deepEqual(siteThumbnailImages(doc(), "site1"), []);
  assert.deepEqual(siteThumbnailImages(doc({ ogImage: { assetId: "missing" }, favicon: { url: "" } }), "site1"), []);
});

test("site thumbnails resolve uploaded and browser-only assets for the correct site", () => {
  const site = doc({
    ogImage: { assetId: "cover" },
    favicon: { assetId: "icon" },
    assets: {
      cover: { id: "cover", name: "Cover", path: "assets/my cover.png", width: 1200, height: 630 },
      icon: { id: "icon", name: "Icon", dataUrl: "data:image/png;base64,AA==", width: 32, height: 32 },
    },
  });
  assert.deepEqual(siteThumbnailImages(site, "my-site"), [
    { kind: "ogp", src: "/api/assets/file?path=assets%2Fmy%20cover.png&site=my-site" },
    { kind: "favicon", src: "data:image/png;base64,AA==" },
  ]);
});

test("duplicate images are shown once and non-home page OGP does not take precedence", () => {
  const site = doc({
    pages: {
      about: { id: "about", name: "About", slug: "about", title: "", description: "", children: [],
        ogImage: { url: "https://example.test/about.png" } },
    },
    ogImage: { url: "https://example.test/shared.png" },
    favicon: { url: "https://example.test/shared.png" },
  });
  assert.deepEqual(siteThumbnailImages(site, "site1"), [
    { kind: "ogp", src: "https://example.test/shared.png" },
  ]);
});
});
