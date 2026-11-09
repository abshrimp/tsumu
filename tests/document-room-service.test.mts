import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { transformSync } from "esbuild";

/** Exercise the real Cloudflare routing module without requiring a Worker. */
function fixture() {
  const url = new URL("../lib/site-document-service.ts", import.meta.url);
  const require = createRequire(url);
  const code = transformSync(readFileSync(url, "utf8"), {
    loader: "ts", format: "cjs", target: "es2022",
  }).code;

  let generation = "first-room";
  const queue = ["old-room"];
  let erased = 0;
  let mutation: (() => void) | null = null;
  const room = {
    getSnapshot: async () => {
      mutation?.(); mutation = null;
      return { rev: "1", savedAt: 100, body: '{"siteName":"Old"}' };
    },
    getMetadata: async () => ({ rev: "1", savedAt: 100 }),
    replaceDocument: async () => {
      mutation?.(); mutation = null;
      return { kind: "saved", rev: "2", savedAt: 200 };
    },
    patchDocument: async () => ({ kind: "saved", rev: "2", savedAt: 200 }),
    listAssetReferences: async () => [],
    listBackups: async () => [],
    readBackup: async () => null,
    eraseDocument: async () => { erased++; },
  };
  const namespace = { idFromName: (key: string) => key, get: (_key: string) => room };
  const mocks: Record<string, unknown> = {
    "@opennextjs/cloudflare": {
      getCloudflareContext: () => ({ env: { DB: {}, DOC_STORE: namespace } }),
    },
    "./sites": { getSiteRoomKey: async () => generation },
    "./doc-storage": {
      readCurrentDoc: async () => null, saveCurrentDoc: async () => ({ kind: "missing" }),
      saveDocPatch: async () => ({ kind: "missing" }),
    },
  };
  const module = { exports: {} as Record<string, any> };
  new Function("require", "module", "exports", code)(
    (name: string) => Object.hasOwn(mocks, name) ? mocks[name] : require(name),
    module, module.exports,
  );
  const db = {
    backend: "d1" as const,
    async execute(statement: string | { sql: string; args: unknown[] }) {
      const sql = typeof statement === "string" ? statement : statement.sql;
      if (sql.includes("FROM document_room_cleanup") && sql.startsWith("SELECT")) {
        return { rows: queue.map(room_key => ({ room_key })), rowsAffected: 0 };
      }
      if (sql.startsWith("DELETE FROM document_room_cleanup")) {
        queue.length = 0;
        return { rows: [], rowsAffected: 1 };
      }
      throw new Error("Unexpected D1 SQL: " + sql);
    },
    async batch(stmts: Array<{ sql: string; args: unknown[] }>) {
      const key = String(stmts[0].args[2]);
      const match = key === generation;
      return [{ rows: [], rowsAffected: Number(match) }, { rows: [], rowsAffected: Number(match) }];
    },
  };
  return {
    store: module.exports,
    db, queue,
    get erased() { return erased; },
    changeOnNextCall(to: string) { mutation = () => { generation = to; }; },
  };
}

test("a document read in flight cannot expose a removed site generation", async () => {
  const f = fixture();
  f.changeOnNextCall("new-room");
  assert.equal(await f.store.readSiteDocument(f.db, "site"), null);
});

test("a save completing after the old site generation is deleted is not acknowledged", async () => {
  const f = fixture();
  f.changeOnNextCall("new-room");
  const result = await f.store.saveSiteDocument(f.db, "site", "{}", "1");
  assert.deepEqual(result, { kind: "missing" });
});

test("retired rooms are sealed and their deletion queue is drained", async () => {
  const f = fixture();
  await f.store.cleanupAbandonedDocuments(f.db, 2);
  assert.equal(f.erased, 1);
  assert.deepEqual(f.queue, []);
  await f.store.cleanupAbandonedDocuments(f.db, 2);
  assert.equal(f.erased, 1);
});
