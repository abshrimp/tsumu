import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { transformSync } from "esbuild";
import { parseActivityUser, type ActivityUser } from "../lib/activity";
import { JsonBodyTooLargeError, JsonContentTypeError, readJsonLimited } from "../lib/api-json";

class NextResponse extends Response {
  static json(value: unknown, init?: ResponseInit) {
    return new NextResponse(JSON.stringify(value), init);
  }
}

function load(path: string, imports: Record<string, unknown>) {
  const code = transformSync(readFileSync(new URL(path, import.meta.url), "utf8"), {
    loader: "ts", format: "cjs", target: "es2022",
  }).code;
  const module = { exports: {} as Record<string, any> };
  new Function("require", "module", "exports", code)(
    () => new Proxy({}, { get: (_target, key) => typeof key === "string" ? imports[key] : undefined }),
    module, module.exports,
  );
  return module.exports;
}

const identity = { email: "editor@example.test", name: "Editor", image: null };
function fixture(mode: "signed-in" | "anonymous" | "denied") {
  let authCalls = 0;
  let saves = 0;
  const authors: (ActivityUser | null)[] = [];
  const shared: Record<string, unknown> = {
    NextResponse, parseActivityUser, readJsonLimited, JsonBodyTooLargeError, JsonContentTypeError,
    serverTr: async () => (value: string) => value,
    authConfigured: () => mode !== "anonymous",
    anonymousAllowed: () => mode === "anonymous",
    auth: async () => {
      authCalls++;
      // A second lookup may return a different/expired session. Attribution
      // must use the identity which authorized this request.
      return mode === "signed-in" && authCalls === 1
        ? { user: { email: "Editor@example.test", name: " Editor " } } : null;
    },
    dbConfigured: () => true,
    getDb: async () => ({ backend: "sqlite" }),
    assetStore: () => null,
    siteIdOf: async () => "site",
    getSite: async () => ({ id: "site" }),
    validateDocValue: () => null,
    isDocPatch: (value: unknown) => Array.isArray(value),
    recordActivity: async (_db: unknown, _site: string, _kind: string, user: ActivityUser | null) => { authors.push(user); },
    notifyDocUpdated: () => {},
  };
  for (const name of ["saveSiteDocumentWithTarget", "patchSiteDocumentWithTarget"]) {
    shared[name] = async () => {
      saves++;
      return { result: { kind: "saved", rev: "2", savedAt: 123 }, roomKey: null };
    };
  }
  Object.assign(shared, load("../lib/server.ts", shared));
  return {
    doc: load("../app/api/doc/route.ts", shared),
    status: load("../app/api/status/route.ts", shared),
    authors,
    get authCalls() { return authCalls; },
    get saves() { return saves; },
  };
}

for (const method of ["PUT", "PATCH", "status"] as const) {
  for (const mode of ["signed-in", "anonymous", "denied"] as const) {
    test(`${method} uses one authorization result for ${mode} identity`, async () => {
      const f = fixture(mode);
      const response = method === "status" ? await f.status.GET() : await f.doc[method](new Request(
        "https://editor.example.test/api/doc?site=site&base=1", {
          method, headers: { "Content-Type": "application/json" },
          body: JSON.stringify(method === "PATCH" ? [] : {}),
        },
      ));
      assert.equal(response.status, mode === "denied" ? 401 : 200);
      assert.equal(f.authCalls, mode === "anonymous" ? 0 : 1);
      if (mode === "denied") {
        assert.equal(f.saves, 0);
        assert.deepEqual(f.authors, []);
      } else if (method === "status") {
        assert.deepEqual((await response.json()).user, mode === "signed-in" ? identity : null);
        assert.equal(response.headers.get("cache-control"), "private, no-store");
      } else {
        assert.equal(f.saves, 1);
        assert.deepEqual(f.authors, [mode === "signed-in" ? identity : null]);
      }
    });
  }
}
