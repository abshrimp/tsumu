import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";

class NextResponse extends Response {
  static json(data: unknown, init?: ResponseInit) {
    return new NextResponse(JSON.stringify(data), {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
  }
}

function load(path: string) {
  const url = new URL(path, import.meta.url);
  const code = transformSync(readFileSync(url, "utf8"), {
    loader: "ts", format: "cjs", target: "es2022",
  }).code;
  const shared: Record<string, unknown> = {
    NextResponse,
    requireAuth: async () => null,
    authConfigured: () => true,
    auth: async () => ({ user: { email: "user@example.test" } }),
    sessionUser: async () => ({ email: "user@example.test", name: "User" }),
    serverTr: async () => (text: string) => text,
    dbConfigured: () => true,
    getDb: async () => ({
      execute: async () => ({
        rows: [{
          day: 0, saved_at: 1, size: 16,
          asset_path: "assets/example.png", bytes: 256,
          body: '{"backup":true}',
        }],
      }),
    }),
    dbUnavailable: async () => NextResponse.json({}, { status: 503 }),
    storeUnavailable: async () => NextResponse.json({}, { status: 503 }),
    allowedEmails: () => ["user@example.test"],
    listAllowedEmails: async () => [],
    assetStore: () => ({ put: async () => {} }),
    getSite: async () => ({ id: "site", name: "Site" }),
    isSiteId: () => true,
    siteIdOf: async () => "site",
    listSites: async () => [{ id: "site", name: "Site" }],
    readActivity: async () => ({ items: [] }),
    cleanupAbandonedDocuments: async () => undefined,
    usesDocumentRooms: () => false,
    documentAssetReferences: async () => [{ path: "assets/example.png", bytes: 256 }],
    readAssetLedger: async () => null,
    parseCommentCursor: () => null,
    listCommentPage: async () => ({ threads: [], nextCursor: null, total: 0, unresolvedCount: 0, focusedThread: null }),
  };
  const module = { exports: {} as Record<string, any> };
  new Function("require", "module", "exports", code)(
    (id: string) => new Proxy({}, {
      get: (_target, field: string | symbol) =>
        typeof field === "string" ? shared[field] : undefined,
    }),
    module, module.exports,
  );
  return module.exports.GET as (req: Request, ctx: unknown) => Promise<Response>;
}

for (const path of [
  "../app/api/status/route.ts",
  "../app/api/sites/route.ts",
  "../app/api/sites/[id]/route.ts",
  "../app/api/comments/route.ts",
  "../app/api/activity/route.ts",
  "../app/api/assets/route.ts",
  "../app/api/doc/backups/route.ts",
  "../app/api/allowed-users/route.ts",
  "../app/api/collab/authorize/route.ts",
]) {
  test(`${path} never allows caching an authorized GET response`, async () => {
    const handler = load(path);
    const response = await handler(new Request("https://editor.example.test/api/test?site=site"), {
      params: Promise.resolve({ id: "site" }),
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  });
}

test("backup body and metadata are both private and non-cacheable", async () => {
  const handler = load("../app/api/doc/backups/route.ts");
  const response = await handler(new Request("https://editor.example.test/api/doc/backups?site=site&day=0"), {});
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await response.json(), { backup: true });
});
