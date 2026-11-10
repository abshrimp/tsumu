import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { transformSync } from "esbuild";
import type { SaveDocResult } from "../lib/doc-storage";

/** Exercise the real Cloudflare routing module without requiring a Worker. */
function fixture(options: { local?: boolean; missingBinding?: boolean } = {}) {
  const url = new URL("../lib/site-document-service.ts", import.meta.url);
  const require = createRequire(url);
  const code = transformSync(readFileSync(url, "utf8"), {
    loader: "ts", format: "cjs", target: "es2022",
  }).code;

  let generation: string | null = "first-room";
  let saveResult: SaveDocResult = { kind: "saved", rev: "2", savedAt: 200 };
  let storageError: Error | null = null;
  let roomLookups = 0;
  let localCalls = 0;
  let timestampWrites = 0;
  const queue = ["old-room"];
  let erased = 0;
  let mutation: (() => void) | null = null;
  const save = async () => {
    mutation?.(); mutation = null;
    if (storageError) throw storageError;
    return saveResult;
  };
  const room = {
    getSnapshot: async () => {
      mutation?.(); mutation = null;
      return { rev: "1", savedAt: 100, body: '{"siteName":"Old"}' };
    },
    getMetadata: async () => ({ rev: "1", savedAt: 100 }),
    replaceDocument: save,
    patchDocument: save,
    listAssetReferences: async () => [],
    listBackups: async () => [],
    readBackup: async () => null,
    eraseDocument: async () => { erased++; },
  };
  const namespace = {
    idFromName: (key: string) => key,
    get: (_key: string) => { roomLookups++; return room; },
  };
  const local = async () => { localCalls++; return { kind: "missing" }; };
  const mocks: Record<string, unknown> = {
    "@opennextjs/cloudflare": {
      getCloudflareContext: () => {
        if (options.local) throw new Error("Not a Worker");
        return { env: { DB: {}, DOC_STORE: options.missingBinding ? undefined : namespace } };
      },
    },
    "./sites": { getSiteRoomKey: async () => generation },
    "./doc-storage": {
      readCurrentDoc: async () => { localCalls++; return null; },
      saveCurrentDoc: local, saveDocPatch: local,
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
      timestampWrites++;
      const key = String(stmts[0].args[2]);
      const match = key === generation;
      return [{ rows: [], rowsAffected: Number(match) }, { rows: [], rowsAffected: Number(match) }];
    },
  };
  return {
    store: module.exports,
    db, queue,
    get erased() { return erased; },
    get roomLookups() { return roomLookups; },
    get localCalls() { return localCalls; },
    get timestampWrites() { return timestampWrites; },
    setGeneration(to: string | null) { generation = to; },
    setSaveResult(result: SaveDocResult) { saveResult = result; },
    failSave(error: Error) { storageError = error; },
    changeOnNextCall(to: string | null) { mutation = () => { generation = to; }; },
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

const conflict: SaveDocResult = {
  kind: "conflict", current: { rev: "3", savedAt: 300, body: '{"siteName":"Old generation"}' },
};
const saveMethods = ["saveSiteDocument", "patchSiteDocument"] as const;
const saveInput = (method: typeof saveMethods[number]) => method === "saveSiteDocument"
  ? "{}" : [{ path: ["siteName"], value: "Edited" }];

for (const method of saveMethods) {
  for (const generation of [null, "new-room"]) {
    test(`${method} hides conflict snapshots after deletion${generation ? " and recreation" : ""}`, async () => {
      const f = fixture();
      f.setSaveResult(conflict);
      f.changeOnNextCall(generation);
      assert.deepEqual(await f.store[method](f.db, "site", saveInput(method), "1"), { kind: "missing" });
      assert.equal(f.timestampWrites, 0);
      assert.equal(f.localCalls, 0);
    });
  }

  test(`${method} preserves a current-generation revision conflict`, async () => {
    const f = fixture();
    f.setSaveResult(conflict);
    assert.deepEqual(await f.store[method](f.db, "site", saveInput(method), "1"), conflict);
    assert.equal(f.timestampWrites, 0);
  });

  test(`${method} propagates storage failures instead of classifying them as missing`, async () => {
    const f = fixture();
    const error = new Error("RPC unavailable");
    f.failSave(error);
    await assert.rejects(f.store[method](f.db, "site", saveInput(method), "1"), error);
    assert.equal(f.timestampWrites, 0);
  });

  test(`${method} returns missing before calling storage for a deleted generation`, async () => {
    const f = fixture();
    f.setGeneration(null);
    assert.deepEqual(await f.store[method](f.db, "site", saveInput(method), "1"), { kind: "missing" });
    assert.equal(f.roomLookups, 0);
    assert.equal(f.localCalls, 0);
    assert.equal(f.timestampWrites, 0);
  });

  test(`${method} still routes Node saves to local storage`, async () => {
    const f = fixture({ local: true });
    assert.deepEqual(await f.store[method](f.db, "site", saveInput(method), "1"), { kind: "missing" });
    assert.equal(f.localCalls, 1);
    assert.equal(f.roomLookups, 0);
  });
}

for (const [method, expected] of [
  ["readSiteDocument", null], ["readSiteDocumentMeta", null],
  ["listSiteDocumentBackups", []], ["readSiteDocumentBackup", null],
  ["documentAssetReferences", []],
] as const) {
  test(`${method} treats an absent room generation as missing without a local fallback`, async () => {
    const f = fixture();
    f.setGeneration(null);
    assert.deepEqual(await f.store[method](f.db, "site", 0), expected);
    assert.equal(f.roomLookups, 0);
    assert.equal(f.localCalls, 0);
  });
}

test("missing Cloudflare bindings remain configuration errors", async () => {
  const f = fixture({ missingBinding: true });
  await assert.rejects(f.store.readSiteDocument(f.db, "site"), /DOC_STORE binding is required/);
  assert.equal(f.localCalls, 0);
});

test("initialization bound to a D1 generation never falls back to local storage", async () => {
  const f = fixture({ local: true });
  assert.deepEqual(await f.store.saveSiteDocument(f.db, "site", "{}", null, "required-room"), { kind: "missing" });
  assert.equal(f.localCalls, 0);
});

test("initialization refuses an empty or replaced required D1 generation before writing", async () => {
  for (const key of ["", "previous-room"]) {
    const f = fixture();
    assert.deepEqual(await f.store.saveSiteDocument(f.db, "site", "{}", null, key), { kind: "missing" });
    assert.equal(f.timestampWrites, 0);
  }
});

test("initialization bound to the current D1 generation retains the saved result shape", async () => {
  const f = fixture();
  assert.deepEqual(await f.store.saveSiteDocument(f.db, "site", "{}", null, "first-room"), { kind: "saved", rev: "2", savedAt: 200 });
});
