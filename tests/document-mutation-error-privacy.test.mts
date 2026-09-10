import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { transformSync } from "esbuild";
import { JsonBodyTooLargeError, JsonContentTypeError, readJsonLimited } from "../lib/api-json";
import { DocTooLargeError, InvalidDocPatchError, validateDocValue } from "../lib/doc-storage";
import { isDocPatch, type DocPatch } from "../lib/doc-patch";
import { userMessage } from "../lib/errors";
import { createInitialDoc } from "../lib/presets";
import { readTextLimited, TooLargeError } from "../lib/safe-fetch";
import { IMPORT_LIMITS, validateImportedDoc } from "../lib/site-import-format";
import { DEFAULT_BRANCH, DEFAULT_PREVIEW_BRANCH, isSiteId, normalizeSiteInput } from "../lib/sites";
import { StructuredDocumentStore, type DocumentSqlStorage, type SiteSaveResult, type SiteSnapshot } from "../lib/structured-document-store";

class NextResponse extends Response {
  static json(value: unknown, init?: ResponseInit) {
    return new NextResponse(JSON.stringify(value), {
      ...init, headers: { "Content-Type": "application/json", ...init?.headers },
    });
  }
}
const routeCode = (route: string) => transformSync(readFileSync(
  new URL(`../app/api/${route}/route.ts`, import.meta.url), "utf8",
), { loader: "ts", format: "cjs", target: "es2022" }).code;
const docCode = routeCode("doc");
const sitesCode = routeCode("sites");
type Method = "PUT" | "PATCH";
type Handler = (req: Request) => Promise<Response>;
type Stage = "database" | "site" | "save" | "activity" | "read" | "insert";
const doc = createInitialDoc();
const patch: DocPatch = [{ path: ["siteName"], value: "Edited" }];
const snapshot: SiteSnapshot = { rev: "1", savedAt: 123, body: JSON.stringify(doc) };
const saved: SiteSaveResult = { kind: "saved", rev: "2", savedAt: 124 };
const saveMessage = "Couldn't save";
const createMessage = "Couldn't create it";
const saveLog = "[api/doc] document save failed";
const createLog = "[api/sites POST] site creation failed";
const tooLarge = "The document is too large for the storage";

function fixture(options: {
  stage?: Stage;
  error?: unknown;
  denied?: Response;
  configured?: boolean;
  siteExists?: boolean;
  result?: SiteSaveResult;
  read?: () => SiteSnapshot | null;
  save?: (raw: string, base: string | null) => SiteSaveResult;
  patch?: (value: DocPatch, base: string) => SiteSaveResult;
  translate?: (value: string) => string;
} = {}) {
  const calls: string[] = [];
  const step = (stage: Stage) => {
    calls.push(stage);
    if (options.stage === stage) throw options.error;
  };
  const injected: Record<string, unknown> = {
    NextResponse, userMessage, readJsonLimited, JsonBodyTooLargeError, JsonContentTypeError,
    DocTooLargeError, InvalidDocPatchError, validateDocValue, isDocPatch,
    readTextLimited, TooLargeError, IMPORT_LIMITS, validateImportedDoc,
    DEFAULT_BRANCH, DEFAULT_PREVIEW_BRANCH, isSiteId, normalizeSiteInput,
    serverTr: async () => options.translate ?? ((value: string) => value),
    requireAuth: async () => { calls.push("auth"); return options.denied ?? null; },
    dbConfigured: () => { calls.push("configured"); return options.configured ?? true; },
    dbUnavailable: async () => NextResponse.json({}, { status: 503 }),
    siteIdOf: async (value: unknown) => isSiteId(value) ? value
      : NextResponse.json({ error: "invalid site" }, { status: 400 }),
    getDb: async () => { step("database"); return { backend: "d1" }; },
    getSite: async (_db: unknown, id: string) => {
      step("site"); return options.siteExists === false ? null : { id };
    },
    readSiteDocument: async () => { step("read"); return options.read ? options.read() : snapshot; },
    saveSiteDocument: async (_db: unknown, _id: string, raw: string, base: string | null) => {
      step("save"); return options.save ? options.save(raw, base) : options.result ?? saved;
    },
    patchSiteDocument: async (_db: unknown, _id: string, value: DocPatch, base: string) => {
      step("save"); return options.patch ? options.patch(value, base) : options.result ?? saved;
    },
    sessionUser: async () => null,
    recordActivity: async () => { step("activity"); },
    notifyDocUpdated: () => { calls.push("notify"); },
    newSiteId: () => "new-site",
    insertSite: async () => { step("insert"); },
    deleteSite: async () => { calls.push("delete"); },
    eraseSiteDocument: async () => { calls.push("erase"); },
    cleanupAbandonedDocuments: async () => { calls.push("cleanup"); },
  };
  for (const method of ["saveSiteDocument", "patchSiteDocument"]) {
    injected[method + "WithTarget"] = async (...args: unknown[]) => ({
      result: await (injected[method] as (...args: unknown[]) => unknown)(...args),
      roomKey: "synthetic-private-room-key",
    });
  }
  const load = (code: string) => {
    const module = { exports: {} as Record<string, Handler> };
    new Function("require", "module", "exports", code)(
      () => new Proxy({}, { get: (_target, key) => typeof key === "string" ? injected[key] : undefined }),
      module, module.exports,
    );
    return module.exports;
  };
  return { ...load(docCode), POST: load(sitesCode).POST, calls };
}
function request(method: Method, body: unknown = method === "PUT" ? doc : patch, base = "1") {
  return new Request(`https://editor.example.test/api/doc?site=test-site&base=${base}`, {
    method, body: JSON.stringify(body), headers: { "Content-Type": "application/json" },
  });
}
function copyRequest(input: unknown = { name: "Copy", copyFrom: "test-site" }) {
  return new Request("https://editor.example.test/api/sites", {
    method: "POST", body: JSON.stringify(input), headers: { "Content-Type": "application/json" },
  });
}
function captureErrors(t: TestContext) {
  const logger = t.mock.method(console, "error", () => {});
  return () => logger.mock.calls.map(call => call.arguments);
}
async function assertSanitized(response: Response, logs: () => unknown[][], copying = false) {
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: copying ? createMessage : saveMessage });
  assert.deepEqual(logs(), [[copying ? createLog : saveLog]]);
}
const errorCases: Array<[string, unknown]> = [
  ["credentials and nested error properties", Object.assign(new Error(
    "database failed: postgres://test-user:test-password@db.example.test/private test-token",
    { cause: { document: "synthetic private body", token: "nested-test-token" } },
  ), { body: "synthetic private body", code: "synthetic-secret-code" })],
  ["Japanese private text", new SyntaxError("Unexpected token: 非公開のテスト本文")],
  ["localized storage failure", new Error("保存済み編集データが破損しています")],
  ["string", "非公開のテスト本文 test-token"],
  ["object", { message: "synthetic private body", credential: "test-token" }],
  ["null", null],
];
for (const method of ["PUT", "PATCH"] as const) {
  for (const stage of ["database", "site", "save", "activity"] as const) {
    for (const [label, error] of errorCases) {
      test(`${method} ${stage} failure redacts ${label}`, async t => {
        const logs = captureErrors(t);
        const f = fixture({ stage, error });
        await assertSanitized(await f[method](request(method)), logs);
        assert.ok(!f.calls.includes("notify"));
      });
    }
  }
}
for (const stage of ["database", "site", "read", "insert", "save"] as const) {
  for (const [label, error] of errorCases) {
    test(`site copy ${stage} failure redacts ${label}`, async t => {
      const logs = captureErrors(t);
      const f = fixture({ stage, error });
      await assertSanitized(await f.POST(copyRequest()), logs, true);
      if (["database", "site", "read"].includes(stage)) assert.ok(!f.calls.includes("insert"));
      if (stage === "save") assert.deepEqual(f.calls.slice(-3), ["delete", "erase", "cleanup"]);
    });
  }
}

function database(t: TestContext) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  const storage: DocumentSqlStorage = {
    sql: { exec(sql, ...args) {
      const stmt = sqlite.prepare(sql);
      if (stmt.columns().length) return { toArray: () => stmt.all(...args) as Record<string, unknown>[] };
      stmt.run(...args);
      return { toArray: () => [] };
    } },
    transactionSync(fn) {
      sqlite.exec("BEGIN");
      try { const result = fn(); sqlite.exec("COMMIT"); return result; }
      catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    },
  };
  const store = new StructuredDocumentStore(storage);
  store.replace(JSON.stringify(doc), null);
  return { sqlite, store };
}
for (const method of ["PUT", "PATCH"] as const) {
  for (const boundary of ["conflict", "daily backup", ...(method === "PATCH" ? ["patch parsing"] : [])]) {
    for (const field of ["props", "node"] as const) {
      test(`${method} redacts real SQLite ${field} JSON errors in ${boundary}`, async t => {
        const logs = captureErrors(t);
        const { sqlite, store } = database(t);
        const corrupt = "非公開のテスト本文";
        const node = Object.values(doc.nodes).find(value => value.text)!;
        assert.ok(node);
        if (field === "props") sqlite.prepare("UPDATE document_meta SET props=?").run(corrupt);
        else sqlite.prepare("UPDATE document_entries SET body=? WHERE bucket='nodes' AND entry_id=?").run(corrupt, node.id);
        if (boundary === "daily backup") sqlite.prepare("UPDATE document_meta SET saved_at=0").run();
        const base = boundary === "conflict" ? "2" : "1";
        const value: DocPatch = [{ path: ["nodes", node.id], value: node }];
        const operation = () => method === "PUT" ? store.replace(JSON.stringify(doc), base) : store.patch(value, base);
        assert.throws(operation, error => {
          assert.ok(error instanceof SyntaxError);
          assert.ok(error.message.includes(corrupt), "the real parser includes synthetic stored text");
          return true;
        });
        const f = fixture({ save: (raw, rev) => store.replace(raw, rev), patch: (ops, rev) => store.patch(ops, rev) });
        const before = sqlite.prepare("SELECT * FROM document_meta").all();
        await assertSanitized(await f[method](request(method, method === "PUT" ? doc : value, base)), logs);
        assert.deepEqual(sqlite.prepare("SELECT * FROM document_meta").all(), before);
        assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM document_backup_meta").get()?.n, 0);
        assert.ok(!f.calls.includes("activity"));
      });
    }
  }
}
for (const field of ["props", "node"] as const) {
  test(`copy redacts real SQLite ${field} JSON errors before creating a site`, async t => {
    const logs = captureErrors(t);
    const { sqlite, store } = database(t);
    const corrupt = "非公開のテスト本文";
    if (field === "props") sqlite.prepare("UPDATE document_meta SET props=?").run(corrupt);
    else sqlite.prepare("UPDATE document_entries SET body=? WHERE bucket='nodes'").run(corrupt);
    assert.throws(() => store.snapshot(), error => error instanceof SyntaxError && error.message.includes(corrupt));
    const f = fixture({ read: () => store.snapshot() });
    await assertSanitized(await f.POST(copyRequest()), logs, true);
    assert.deepEqual(f.calls, ["auth", "configured", "database", "site", "read"]);
  });
}

test("mutation failures still translate only the fixed public fallback", async t => {
  const logs = captureErrors(t);
  const translated = new Map([[saveMessage, "Could not save"], [createMessage, "Could not create"]]);
  const f = fixture({ stage: "database", error: new Error("非公開のテスト本文"), translate: value => translated.get(value) ?? value });
  for (const method of ["PUT", "PATCH"] as const) {
    assert.deepEqual(await (await f[method](request(method))).json(), { error: "Could not save" });
  }
  assert.deepEqual(await (await f.POST(copyRequest())).json(), { error: "Could not create" });
  assert.deepEqual(logs(), [[saveLog], [saveLog], [createLog]]);
});

test("safe document validation and capacity failures retain their status and public messages", async t => {
  const logs = captureErrors(t);
  for (const method of ["PUT", "PATCH"] as const) {
    for (const error of [new InvalidDocPatchError(), new Error("Invalid request"), new Error("JSONが壊れています")]) {
      const response = await fixture({ stage: "save", error })[method](request(method));
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: "Invalid request" });
    }
    for (const error of [new DocTooLargeError(), new Error("SQLITE_TOOBIG synthetic-private-details"), new Error("編集データの1項目が大きすぎます")]) {
      const response = await fixture({ stage: "save", error })[method](request(method));
      assert.equal(response.status, 413);
      assert.deepEqual(await response.json(), { error: tooLarge });
    }
  }
  const capacity = await fixture({ stage: "save", error: new Error("SQLITE_TOOBIG test-token") }).POST(copyRequest());
  assert.equal(capacity.status, 413);
  assert.deepEqual(await capacity.json(), { error: tooLarge });
  const imported = { name: doc.siteName, importId: "0123456789", initialDoc: doc };
  const collision = await fixture({ siteExists: false, stage: "insert", error: new Error("UNIQUE constraint failed: sites.id") }).POST(copyRequest(imported));
  assert.equal(collision.status, 409);
  assert.deepEqual(await collision.json(), { error: "Could not create the site." });
  assert.deepEqual(logs(), []);
});

test("auth, missing storage, invalid input, and absent sites retain early returns", async t => {
  const logs = captureErrors(t);
  for (const method of ["PUT", "PATCH", "POST"] as const) {
    const req = () => method === "POST" ? copyRequest() : request(method);
    for (const status of [401, 403]) {
      const denied = NextResponse.json({ error: "denied" }, { status });
      const f = fixture({ denied, stage: "database", error: new Error("must not read") });
      assert.equal(await f[method](req()), denied);
      assert.deepEqual(f.calls, ["auth"]);
    }
    const unavailable = fixture({ configured: false });
    assert.equal((await unavailable[method](req())).status, 503);
    assert.deepEqual(unavailable.calls, ["auth", "configured"]);
    const invalid = fixture();
    assert.equal((await invalid[method](method === "POST" ? copyRequest({ name: "" }) : request(method, {}))).status, 400);
    assert.ok(!invalid.calls.includes("database"));
    const absent = fixture({ siteExists: false });
    assert.equal((await absent[method](req())).status, 404);
    assert.ok(!absent.calls.includes("save"));
    assert.ok(!absent.calls.includes("insert"));
  }
  const badImport = fixture();
  const imported = await badImport.POST(copyRequest({ name: "Import", importId: "0123456789", initialDoc: {} }));
  assert.equal(imported.status, 400);
  assert.deepEqual(await imported.json(), { error: "Invalid page, element or asset data." });
  assert.ok(!badImport.calls.includes("database"));
  assert.deepEqual(logs(), []);
});

test("successful and conflicting document mutations still return the authorized document", async t => {
  const logs = captureErrors(t);
  for (const method of ["PUT", "PATCH"] as const) {
    const ok = fixture();
    const response = await ok[method](request(method));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, rev: "2", savedAt: 124 });
    assert.ok(ok.calls.includes("notify"));
    const conflict = fixture({ result: { kind: "conflict", current: snapshot } });
    const rejected = await conflict[method](request(method));
    assert.equal(rejected.status, 409);
    assert.equal(rejected.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(await rejected.json(), { conflict: true, rev: "1", savedAt: 123, doc });
    assert.ok(!conflict.calls.includes("activity"));
    const missing = await fixture({ result: { kind: "missing" } })[method](request(method));
    assert.equal(missing.status, 404);
  }
  const copied = fixture();
  const response = await copied.POST(copyRequest());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { site: { id: "new-site" } });
  assert.ok(copied.calls.includes("save"));
  assert.ok(!copied.calls.includes("delete"));
  const blank = fixture({ read: () => null });
  assert.equal((await blank.POST(copyRequest())).status, 200);
  assert.ok(!blank.calls.includes("save"));
  assert.deepEqual(logs(), []);
});
