import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { transformSync } from "esbuild";

class NextResponse extends Response {
  static json(body: unknown, init?: ResponseInit) {
    return new NextResponse(JSON.stringify(body), init);
  }
}

function assetDeleteRoute({ backend = "d1", configured = true, siteExists = true, browserReferenced = false }:
  { backend?: "d1" | "sqlite"; configured?: boolean; siteExists?: boolean; browserReferenced?: boolean } = {}) {
  const source = readFileSync(new URL("../app/api/assets/route.ts", import.meta.url), "utf8");
  const { code } = transformSync(source, { loader: "ts", format: "cjs", target: "es2022" });
  let registered = 0, deleted = 0, otherSiteReads = 0;
  const db = {
    backend,
    async execute(stmt: string | { sql: string; args: unknown[] }) {
      if (typeof stmt === "object" && stmt.sql.includes("SELECT 1 FROM sites")) {
        return { rows: siteExists ? [{ 1: 1 }] : [], rowsAffected: 0 };
      }
      if (typeof stmt === "object" && stmt.sql.includes("SELECT id FROM sites")) {
        return { rows: [{ id: "other" }], rowsAffected: 0 };
      }
      return { rows: [], rowsAffected: 0 };
    },
  };
  const stubs: Record<string, unknown> = {
    "next/server": { NextResponse },
    "../../../lib/unavailable": {
      dbUnavailable: async () => NextResponse.json({ error: "No DB" }, { status: 503 }),
      storeUnavailable: async () => NextResponse.json({ error: "No KV" }, { status: 503 }),
    },
    "../../../lib/i18n-server": { serverTr: async () => (message: string) => message },
    "../../../lib/server": { requireAuth: async () => null },
    "../../../lib/kv": { assetStore: () => ({ async delete() { deleted++; } }), MAX_ASSET_BYTES: 25 * 1024 * 1024 },
    "../../../lib/errors": { userMessage: (_e: unknown, fallback: string) => fallback },
    "../../../lib/db": { dbConfigured: () => configured, getDb: async () => db },
    "../../../lib/asset-upload": { readAssetForm: async () => null },
    "../../../lib/site-server": { siteIdOf: async (id: string) => id },
    "../../../lib/site-document-service": {
      documentAssetReferences: async () => {
        otherSiteReads++;
        return [{ path: "assets/shared.png", bytes: 1 }];
      },
    },
    "../../../lib/asset-ledger": {
      readAssetLedger: async () => null,
      recordUploadedAsset: async () => {},
    },
    "../../../lib/asset-gc": {
      recordAssetGcCandidates: async (_db: unknown, paths: string[]) => {
        assert.deepEqual(paths, ["assets/muhmi2o0abcdef-photo.png"]);
        registered++;
        return 1;
      },
    },
  };
  const mod = { exports: {} as { DELETE: (req: Request) => Promise<Response> } };
  new Function("require", "module", "exports", code)(
    (id: string) => {
      if (!Object.hasOwn(stubs, id)) throw new Error("Unmocked import: " + id);
      return stubs[id];
    },
    mod, mod.exports,
  );
  const endpoint = "https://example.com/api/assets?site=s1&path=assets%2Fmuhmi2o0abcdef-photo.png"
    + (browserReferenced ? "&browserReferenced=1" : "");
  return {
    call: () => mod.exports.DELETE(new Request(endpoint, { method: "DELETE" })),
    registered: () => registered,
    deleted: () => deleted,
    otherSiteReads: () => otherSiteReads,
  };
}

test("Cloudflare asset deletion enqueues one candidate without scanning all sites or deleting KV", async () => {
  const f = assetDeleteRoute();
  const response = await f.call();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, kept: true, scheduled: true });
  assert.equal(f.registered(), 1);
  assert.equal(f.otherSiteReads(), 0);
  assert.equal(f.deleted(), 0);
});

test("Cloudflare deletion still enqueues when browser-only sites have references", async () => {
  const f = assetDeleteRoute({ browserReferenced: true });
  const response = await f.call();
  assert.equal(response.status, 200);
  assert.equal(f.registered(), 1);
  assert.equal(f.deleted(), 0);
});

test("a stale or deleted site cannot enqueue a candidate", async () => {
  const f = assetDeleteRoute({ siteExists: false });
  const response = await f.call();
  assert.equal(response.status, 404);
  assert.equal(f.registered(), 0);
  assert.equal(f.deleted(), 0);
});

test("Node/Docker retain a browser-only cross-site reference and do not delete the file", async () => {
  const f = assetDeleteRoute({ backend: "sqlite", browserReferenced: true });
  const response = await f.call();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, kept: true });
  assert.equal(f.deleted(), 0);
  assert.equal(f.registered(), 0);
  assert.equal(f.otherSiteReads(), 0);
});

test("Node/Docker continue their cross-site reference check on direct deletion", async () => {
  const f = assetDeleteRoute({ backend: "sqlite" });
  const response = await f.call();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(f.otherSiteReads(), 1);
  assert.equal(f.deleted(), 1);
  assert.equal(f.registered(), 0);
});

for (const browserReferenced of [true, false]) {
  test(`KV-only deletion ${browserReferenced ? "retains a file referenced by another browser site" : "deletes an unreferenced file"}`, async () => {
    const f = assetDeleteRoute({ configured: false, browserReferenced });
    const response = await f.call();
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), browserReferenced ? { ok: true, kept: true } : { ok: true });
    assert.equal(f.deleted(), browserReferenced ? 0 : 1);
    assert.equal(f.registered(), 0);
    assert.equal(f.otherSiteReads(), 0);
  });
}
