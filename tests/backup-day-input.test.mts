import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { transformSync } from "esbuild";

function handler() {
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
        if (query.sql.includes("SELECT body")) return { rows: [{ body: '{"ok":true}' }] };
        return { rows: [{ day: 0, saved_at: 1, size: 12 }] };
      },
    }) },
    "../../../../lib/server": { requireAuth: async () => null },
    "../../../../lib/errors": { userMessage: (_e: unknown, fallback: string) => fallback },
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
