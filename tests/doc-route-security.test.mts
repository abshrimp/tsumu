import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";
import { JsonBodyTooLargeError, JsonContentTypeError, readJsonLimited } from "../lib/api-json";

class NextResponse extends Response {
  static json(value: unknown, init?: ResponseInit) {
    return new NextResponse(JSON.stringify(value), {
      ...init, headers: { "Content-Type": "application/json", ...init?.headers },
    });
  }
}
class DocTooLargeError extends Error {}
class InvalidDocPatchError extends Error {}

type Snapshot = { rev: string; savedAt: number; body: string };

function fixture() {
  let snapshot: Snapshot | null = {
    rev: "4", savedAt: 123, body: '{"siteName":"private"}',
  };
  let conflict = false;
  let writes = 0;
  const source = readFileSync(new URL("../app/api/doc/route.ts", import.meta.url), "utf8");
  const code = transformSync(source, { loader: "ts", format: "cjs", target: "es2022" }).code;
  const shared: Record<string, unknown> = {
    NextResponse,
    dbUnavailable: async () => NextResponse.json({}, { status: 503 }),
    serverTr: async () => (value: string) => value,
    dbConfigured: () => true,
    getDb: async () => ({ backend: "sqlite" }),
    requireAuth: async () => null,
    sessionUser: async () => null,
    recordActivity: async () => {},
    notifyDocUpdated: () => {},
    siteIdOf: async () => "site",
    getSite: async () => ({ id: "site" }),
    getSiteRoomKey: async () => null,
    readSiteDocument: async () => snapshot,
    readSiteDocumentMeta: async () => snapshot && { rev: snapshot.rev, savedAt: snapshot.savedAt },
    saveSiteDocumentWithTarget: async () => {
      writes++;
      return { result: conflict ? { kind: "conflict", current: snapshot } : { kind: "saved", rev: "5", savedAt: 124 }, roomKey: null };
    },
    patchSiteDocumentWithTarget: async () => {
      writes++;
      return { result: conflict ? { kind: "conflict", current: snapshot } : { kind: "saved", rev: "5", savedAt: 124 }, roomKey: null };
    },
    validateDocValue: () => null,
    isDocPatch: (value: unknown) => Array.isArray(value),
    DocTooLargeError,
    InvalidDocPatchError,
    userMessage: () => "error",
    readJsonLimited,
    JsonBodyTooLargeError,
    JsonContentTypeError,
  };
  const mod = { exports: {} as Record<string, any> };
  new Function("require", "module", "exports", code)(
    (_id: string) => new Proxy({}, {
      get: (_target, key: string | symbol) => typeof key === "string" ? shared[key] : undefined,
    }),
    mod, mod.exports,
  );
  return {
    GET: mod.exports.GET as (req: Request) => Promise<Response>,
    PUT: mod.exports.PUT as (req: Request) => Promise<Response>,
    PATCH: mod.exports.PATCH as (req: Request) => Promise<Response>,
    get writes() { return writes; },
    setConflict(on: boolean) { conflict = on; },
    setSnapshot(value: Snapshot | null) { snapshot = value; },
  };
}

const url = "https://editor.example.test/api/doc?site=site&base=1";
function request(method: "PUT" | "PATCH", body: string, headers: Record<string, string> = {}) {
  return new Request(url, {
    method, body, headers: { "Content-Type": "application/json", ...headers },
  });
}

test("document GET keeps full, metadata and missing responses private", async () => {
  const f = fixture();
  const full = await f.GET(new Request(url));
  assert.equal(full.status, 200);
  assert.equal(full.headers.get("cache-control"), "private, no-store");
  assert.equal((await full.json()).doc.siteName, "private");

  const meta = await f.GET(new Request(url + "&meta=1"));
  assert.equal(meta.headers.get("cache-control"), "private, no-store");
  assert.equal((await meta.json()).rev, "4");

  f.setSnapshot(null);
  for (const path of [url, url + "&meta=1"]) {
    const missing = await f.GET(new Request(path));
    assert.equal(missing.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(await missing.json(), { exists: false });
  }
});

test("document saves reject oversized, invalid MIME and malformed payloads before writes", async () => {
  const f = fixture();
  for (const method of ["PUT", "PATCH"] as const) {
    const huge = await f[method](request(method, "{}", {
      "Content-Length": String(64 * 1024 * 1024 + 1),
    }));
    assert.equal(huge.status, 413, method);
    const wrongType = await f[method](request(method, "{}", { "Content-Type": "text/plain" }));
    assert.equal(wrongType.status, 415, method);
    const broken = await f[method](request(method, "{bad"));
    assert.equal(broken.status, 400, method);
  }
  assert.equal(f.writes, 0);
});

test("ordinary saves work and conflicting document bodies are never cacheable", async () => {
  const f = fixture();
  const saved = await f.PUT(request("PUT", '{"siteName":"Edited"}'));
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).rev, "5");
  assert.equal(f.writes, 1);

  f.setConflict(true);
  const conflict = await f.PATCH(request("PATCH", '[{"path":["siteName"],"value":"Changed"}]'));
  assert.equal(conflict.status, 409);
  assert.equal(conflict.headers.get("cache-control"), "private, no-store");
  assert.equal((await conflict.json()).doc.siteName, "private");
  assert.equal(f.writes, 2);
});
