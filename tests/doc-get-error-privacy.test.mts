import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { transformSync } from "esbuild";
import { userMessage } from "../lib/errors";
import { isSiteId } from "../lib/sites";
import { createInitialDoc } from "../lib/presets";
import { StructuredDocumentStore, type DocumentSqlStorage } from "../lib/structured-document-store";

class NextResponse extends Response {
  static json(value: unknown, init?: ResponseInit) {
    return new NextResponse(JSON.stringify(value), {
      ...init, headers: { "Content-Type": "application/json", ...init?.headers },
    });
  }
}

type ReadStep = "database" | "site" | "metadata" | "snapshot";
type Snapshot = { rev: string; savedAt: number; body: string };
const snapshot: Snapshot = { rev: "4", savedAt: 123, body: '{"siteName":"test document"}' };
const url = "https://editor.example.test/api/doc?site=test-site";
const code = transformSync(readFileSync(new URL("../app/api/doc/route.ts", import.meta.url), "utf8"), {
  loader: "ts", format: "cjs", target: "es2022",
}).code;

function fixture(options: {
  failStage?: ReadStep;
  error?: unknown;
  denied?: Response;
  configured?: boolean;
  siteExists?: boolean;
  document?: Snapshot | null;
  readSnapshot?: () => Snapshot | null;
  translate?: (value: string) => string;
} = {}) {
  const calls: string[] = [];
  const document = options.document === undefined ? snapshot : options.document;
  const step = (stage: ReadStep) => {
    calls.push(stage);
    if (options.failStage === stage) throw options.error;
  };
  const shared: Record<string, unknown> = {
    NextResponse,
    serverTr: async () => options.translate ?? ((value: string) => value),
    requireAuth: async () => { calls.push("auth"); return options.denied ?? null; },
    dbConfigured: () => { calls.push("configured"); return options.configured ?? true; },
    dbUnavailable: async () => NextResponse.json({ unavailable: true }, { status: 503 }),
    siteIdOf: async (value: unknown) => {
      calls.push("siteId");
      return isSiteId(value) ? value : NextResponse.json({ error: "invalid site" }, { status: 400 });
    },
    getDb: async () => { step("database"); return { backend: "sqlite" }; },
    getSite: async () => { step("site"); return options.siteExists === false ? null : { id: "test-site" }; },
    readSiteDocumentMeta: async () => {
      step("metadata");
      return document && { rev: document.rev, savedAt: document.savedAt };
    },
    readSiteDocument: async () => {
      step("snapshot");
      return options.readSnapshot ? options.readSnapshot() : document;
    },
    userMessage,
  };
  const module = { exports: {} as { GET: (req: Request) => Promise<Response> } };
  new Function("require", "module", "exports", code)(
    () => new Proxy({}, { get: (_target, key) => typeof key === "string" ? shared[key] : undefined }),
    module, module.exports,
  );
  return { GET: module.exports.GET, calls };
}

function captureErrors(t: TestContext) {
  const logger = t.mock.method(console, "error", () => {});
  return () => logger.mock.calls.map(call => call.arguments);
}

const errorCases: Array<[string, unknown]> = [
  ["internal error with credentials and nested properties", Object.assign(
    new Error("database failed: test-token and person@example.test", {
      cause: { document: "synthetic private body" },
    }), { code: "synthetic-secret-code", body: "synthetic private body" },
  )],
  ["Japanese document text in an error", new SyntaxError('Unexpected token: 非公開のテスト本文')],
  ["localized storage error", new Error("保存済み編集データが破損しています")],
  ["thrown string", "非公開のテスト本文 test-token person@example.test"],
  ["thrown object", { message: "synthetic private body", credential: "test-token" }],
  ["null rejection", null],
];

for (const stage of ["database", "site", "metadata", "snapshot"] as const) {
  for (const [name, error] of errorCases) {
    test(`document GET ${stage} failure is private and sanitized: ${name}`, async t => {
      const logs = captureErrors(t);
      const metaOnly = stage === "metadata";
      const f = fixture({ failStage: stage, error });
      const response = await f.GET(new Request(url + (metaOnly ? "&meta=1" : "")));
      assert.equal(response.status, 502);
      assert.equal(response.headers.get("cache-control"), null);
      assert.equal(response.headers.get("x-tsumu-error-stage"), null);
      assert.deepEqual(await response.json(), { error: "読み込めませんでした" });
      assert.deepEqual(logs(), [["[api/doc GET] document read failed"]]);
      const expected = ["auth", "configured", "siteId", "database"];
      if (stage !== "database") expected.push("site");
      if (stage === "metadata" || stage === "snapshot") expected.push(stage);
      assert.deepEqual(f.calls, expected);
    });
  }
}

test("document GET still translates the generic error and logs a single metadata-only failure", async t => {
  const logs = captureErrors(t);
  const f = fixture({
    failStage: "database", error: new Error("synthetic database error"),
    translate: value => value === "読み込めませんでした" ? "Could not load" : value,
  });
  const response = await f.GET(new Request(url + "&meta=1"));
  assert.deepEqual(await response.json(), { error: "Could not load" });
  assert.equal(response.headers.get("x-tsumu-error-stage"), null);
  assert.deepEqual(logs(), [["[api/doc GET] document read failed"]]);
});

test("document GET authorization and input errors never reach storage or error logging", async t => {
  const logs = captureErrors(t);
  for (const status of [401, 403]) {
    const denied = NextResponse.json({ error: "denied" }, { status });
    const f = fixture({ denied, failStage: "database", error: new Error("must not read") });
    assert.equal(await f.GET(new Request(url)), denied);
    assert.deepEqual(f.calls, ["auth"]);
  }
  const unavailable = fixture({ configured: false });
  const noDb = await unavailable.GET(new Request(url));
  assert.equal(noDb.status, 503);
  assert.equal(noDb.headers.get("x-tsumu-error-stage"), null);
  assert.deepEqual(unavailable.calls, ["auth", "configured"]);

  for (const path of ["https://editor.example.test/api/doc", url.replace("test-site", "invalid%20site")]) {
    const f = fixture();
    const invalid = await f.GET(new Request(path));
    assert.equal(invalid.status, 400);
    assert.equal(invalid.headers.get("x-tsumu-error-stage"), null);
    assert.deepEqual(f.calls, ["auth", "configured", "siteId"]);
  }
  assert.deepEqual(logs(), []);
});

test("document GET success, missing documents and absent sites preserve their behavior", async t => {
  const logs = captureErrors(t);
  for (const metaOnly of [false, true]) {
    const path = url + (metaOnly ? "&meta=1" : "");
    for (const document of [snapshot, null]) {
      const f = fixture({ document });
      const response = await f.GET(new Request(path));
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "private, no-store");
      assert.equal(response.headers.get("x-tsumu-error-stage"), null);
      assert.deepEqual(await response.json(), !document ? { exists: false } : {
        exists: true, rev: "4", savedAt: 123,
        ...(!metaOnly ? { doc: { siteName: "test document" } } : {}),
      });
      assert.deepEqual(f.calls, ["auth", "configured", "siteId", "database", "site", metaOnly ? "metadata" : "snapshot"]);
    }
    const f = fixture({ siteExists: false });
    const missing = await f.GET(new Request(path));
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { error: "サイトが見つかりません" });
    assert.equal(missing.headers.get("x-tsumu-error-stage"), null);
    assert.deepEqual(f.calls, ["auth", "configured", "siteId", "database", "site"]);
  }
  assert.deepEqual(logs(), []);
});

for (const field of ["props", "entry"] as const) {
  for (const [language, corrupt] of [["English", "test-secret"], ["Japanese", "非公開のテスト本文"]]) {
    test(`document GET does not log or return ${language} JSON parse excerpts from corrupt stored ${field}`, async t => {
      const logs = captureErrors(t);
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
      store.replace(JSON.stringify(createInitialDoc()), null);
      if (field === "props") sqlite.prepare("UPDATE document_meta SET props=?").run(corrupt);
      else sqlite.prepare("UPDATE document_entries SET body=?").run(corrupt);
      assert.throws(() => store.snapshot(), error => {
        assert.ok(error instanceof SyntaxError);
        assert.ok(error.message.includes(corrupt), "real JSON parser includes the stored fragment");
        return true;
      });
      const f = fixture({ readSnapshot: () => store.snapshot() });
      const response = await f.GET(new Request(url));
      assert.equal(response.status, 502);
      assert.equal(response.headers.get("cache-control"), null);
      assert.equal(response.headers.get("x-tsumu-error-stage"), null);
      assert.deepEqual(await response.json(), { error: "読み込めませんでした" });
      assert.deepEqual(logs(), [["[api/doc GET] document read failed"]]);
    });
  }
}
