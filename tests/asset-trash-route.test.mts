import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { transformSync } from "esbuild";
import { assetUploadedAt } from "../lib/asset-gc-plan";

class NextResponse extends Response {
  static json(body: unknown, init?: ResponseInit) {
    return new NextResponse(JSON.stringify(body), init);
  }
}

const path = "assets/muhmi2o0abcdef-photo.png";
type Config = {
  backend?: "d1" | "sqlite"; siteExists?: boolean; candidate?: boolean; locked?: boolean;
  candidateCount?: number; deleteOutcome?: "deleted" | "missing" | "busy" | "in-use";
  storeAvailable?: boolean; roomsAvailable?: boolean;
};
function trashRoute({
  backend = "d1", siteExists = true, candidate = true, locked = false, candidateCount = 1,
  deleteOutcome = "deleted", storeAvailable = true, roomsAvailable = true,
}: Config = {}) {
  const source = readFileSync(new URL("../app/api/assets/trash/route.ts", import.meta.url), "utf8");
  const { code } = transformSync(source, { loader: "ts", format: "cjs", target: "es2022" });
  let deletion = 0, permanentDeleteCalls = 0;
  const db = {
    backend,
    async execute(stmt: string | { sql: string; args: unknown[] }) {
      const sql = typeof stmt === "string" ? stmt : stmt.sql;
      if (sql.includes("FROM sites")) return { rows: siteExists ? [{ exists: 1 }] : [] };
      if (sql.includes("SELECT c.path")) {
        const args = typeof stmt === "string" ? [] : stmt.args;
        const limit = Number(args[0] ?? 101), offset = Number(args[1] ?? 0);
        const rows = candidate ? Array.from({ length: candidateCount }, (_, i) => ({
          path: i ? path.replace(".png", "-" + i + ".png") : path,
          deletedAt: 1700000000000 + i, bytes: 125 + i,
        })) : [];
        return { rows: rows.slice(offset, offset + limit) };
      }
      if (sql.includes("DELETE FROM asset_gc_candidates")) {
        if (!candidate || locked) return { rows: [] };
        candidate = false;
        deletion++;
        return { rows: [{ path }] };
      }
      if (sql.includes("FROM asset_gc_candidates")) return { rows: candidate ? [{ exists: 1 }] : [] };
      throw new Error("Unexpected query: " + sql);
    },
  };
  const stubs: Record<string, unknown> = {
    "next/server": { NextResponse },
    "@opennextjs/cloudflare": { getCloudflareContext: () => ({ env: { DOC_STORE: roomsAvailable ? {} : null } }) },
    "../../../../lib/kv": { assetStore: () => storeAvailable ? { delete: async () => {} } : null },
    "../../../../lib/asset-trash-delete": {
      permanentlyDeleteTrashedAsset: async ({ path: requested }: { path: string }) => {
        assert.equal(requested, path);
        permanentDeleteCalls++;
        return deleteOutcome;
      },
    },
    "../../../../lib/db": { getDb: async () => db, dbConfigured: () => true },
    "../../../../lib/server": { requireAuth: async () => null },
    "../../../../lib/site-server": { siteIdOf: async (site: unknown) => site === "site" ? "site"
      : NextResponse.json({ error: "Invalid site" }, { status: 400 }) },
    "../../../../lib/asset-gc-plan": { assetUploadedAt },
    "../../../../lib/i18n-server": { serverTr: async () => (s: string) => s },
    "../../../../lib/errors": { userMessage: (_err: unknown, fallback: string) => fallback },
  };
  const mod = { exports: {} as {
    GET: (req: Request) => Promise<Response>;
    POST: (req: Request) => Promise<Response>;
    DELETE: (req: Request) => Promise<Response>;
  } };
  new Function("require", "module", "exports", code)((id: string) => {
    if (!Object.hasOwn(stubs, id)) throw new Error("Missing stub: " + id);
    return stubs[id];
  }, mod, mod.exports);
  return {
    get: (offset = 0) => mod.exports.GET(new Request(`https://example.test/api/assets/trash?site=site&offset=${offset}`)),
    post: (assetPath: string = path, site: string = "site") => mod.exports.POST(new Request("https://example.test/api/assets/trash", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: assetPath, site }),
    })),
    remove: (assetPath: string = path, site: string = "site") => mod.exports.DELETE(new Request("https://example.test/api/assets/trash", {
      method: "DELETE", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: assetPath, site }),
    })),
    deletions: () => deletion,
    permanentDeleteCalls: () => permanentDeleteCalls,
  };
}

test("pending asset files appear in trash, including byte usage and deletion time", async () => {
  const route = trashRoute();
  const response = await route.get();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    enabled: true, hasMore: false, items: [{ path, deletedAt: 1700000000000, bytes: 125 }],
  });
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
});

test("trash pagination returns a bounded page and a continuation signal", async () => {
  const route = trashRoute({ candidateCount: 101 });
  const first = await route.get();
  assert.equal(first.status, 200);
  const initial = await first.json() as { items: unknown[]; hasMore: boolean };
  assert.equal(initial.items.length, 100);
  assert.equal(initial.hasMore, true);
  const last = await route.get(100);
  const final = await last.json() as { items: unknown[]; hasMore: boolean };
  assert.equal(final.items.length, 1);
  assert.equal(final.hasMore, false);
  assert.equal((await route.get(-1)).status, 400);
});

test("restoring from trash deletes the candidate without deleting the stored object", async () => {
  const route = trashRoute();
  const response = await route.post();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(route.deletions(), 1);
  const repeat = await route.post();
  assert.equal(repeat.status, 404);
});

test("trash restore fails closed during garbage collection and for malformed paths", async () => {
  const locked = trashRoute({ locked: true });
  assert.equal((await locked.post()).status, 409);
  assert.equal(locked.deletions(), 0);
  assert.equal((await locked.post("assets/not-a-valid-path.png")).status, 400);
  assert.equal((await locked.post(path, "wrong-site")).status, 400);
});

test("deleted sites and unsupported storage never restore assets", async () => {
  assert.equal((await trashRoute({ siteExists: false }).post()).status, 404);
  assert.equal((await trashRoute({ backend: "sqlite" }).post()).status, 503);
  assert.equal((await trashRoute({ candidate: false }).post()).status, 404);
});

test("permanent deletion from trash calls the safe GC-backed deleter after authorization", async () => {
  const route = trashRoute();
  const response = await route.remove();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(route.permanentDeleteCalls(), 1);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
});

test("permanent deletion rejects active references, busy GC and missing candidates", async () => {
  for (const [outcome, status] of [["in-use", 409], ["busy", 409], ["missing", 404]] as const) {
    const route = trashRoute({ deleteOutcome: outcome });
    const response = await route.remove();
    assert.equal(response.status, status, outcome);
    assert.equal(route.permanentDeleteCalls(), 1);
  }
});

test("permanent deletion refuses invalid paths, missing sites, unsupported backend and bindings", async () => {
  const invalid = trashRoute();
  assert.equal((await invalid.remove("assets/fake-path")).status, 400);
  assert.equal((await invalid.remove(path, "other")).status, 400);
  assert.equal(invalid.permanentDeleteCalls(), 0);
  for (const config of [
    { siteExists: false }, { backend: "sqlite" as const },
    { storeAvailable: false }, { roomsAvailable: false },
  ]) {
    const route = trashRoute(config);
    assert.ok([404, 503].includes((await route.remove()).status));
    assert.equal(route.permanentDeleteCalls(), 0);
  }
});
