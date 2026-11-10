import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { transformSync } from "esbuild";
import { createDocPatch } from "../lib/doc-patch";
import { createInitialDoc } from "../lib/presets";
import { StructuredDocumentStore, type DocumentSqlStorage } from "../lib/structured-document-store";

// Exercise the real Worker handler and document store, replacing only host
// bindings. A D1 binding selects the production DOC_STORE RPC path.
function fixture(initialize = true, allowGenerationClose = false) {
  const sqlite = new DatabaseSync(":memory:");
  const storage: DocumentSqlStorage = {
    sql: { exec(sql, ...args) {
      const statement = sqlite.prepare(sql);
      if (statement.columns().length) {
        return { toArray: () => statement.all(...args) as Record<string, unknown>[] };
      }
      statement.run(...args);
      return { toArray: () => [] };
    } },
    transactionSync(callback) {
      sqlite.exec("BEGIN");
      try {
        const result = callback();
        sqlite.exec("COMMIT");
        return result;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
  const documents = new StructuredDocumentStore(storage);
  const original = createInitialDoc();
  if (initialize) documents.replace(JSON.stringify(original), null);
  let rpcCalls = 0;
  let generation: string | null = "generation-1";
  let readStarted: (() => void) | undefined;
  let readGate: Promise<void> | undefined;
  const remote = {
    async getSnapshot() {
      rpcCalls++;
      const snapshot = documents.snapshot();
      readStarted?.();
      await readGate;
      return snapshot;
    },
    async replaceDocument(raw: string, base: string | null) { rpcCalls++; return documents.replace(raw, base); },
    async patchDocument(patch: Parameters<StructuredDocumentStore["patch"]>[0], base: string) {
      rpcCalls++;
      return documents.patch(patch, base);
    },
  };
  const url = new URL("../custom-worker.ts", import.meta.url);
  const require = createRequire(url);
  const mocks: Record<string, unknown> = {
    "cloudflare:workers": { DurableObject: class {
      constructor(public ctx: unknown, public env: unknown) {}
    } },
    "./.open-next/worker.js": {},
    "./document-room": { DocumentRoom: class {} },
    "./lib/db": { getDbFromBinding: async () => ({ execute: async () => ({ rows: [{}] }) }) },
    "./lib/sites": { getSiteRoomKey: async () => generation },
  };
  const { code } = transformSync(readFileSync(url, "utf8"), { loader: "ts", format: "cjs", target: "es2022" });
  const module = { exports: {} as any };
  new Function("require", "module", "exports", code)(
    (name: string) => Object.hasOwn(mocks, name) ? mocks[name] : require(name), module, module.exports,
  );
  const socket = (clientId: string) => ({
    messages: [] as string[],
    closed: [] as Array<{ code: number; reason: string }>,
    deserializeAttachment: () => ({ clientId, siteId: "s1", roomKey: "generation-1", user: null }),
    send(raw: string) { this.messages.push(raw); },
    close(code: number, reason: string) {
      if (!allowGenerationClose) assert.fail("Valid site generation must stay connected");
      this.closed.push({ code, reason });
    },
  });
  const sender = socket("sender");
  const peer = socket("peer");
  const room = new module.exports.CollaborationRoom({ getWebSockets: () => [sender, peer] }, {
    DB: {}, DOC_STORE: { idFromName: (name: string) => name, get: () => remote },
  });
  return {
    documents, original, sender, peer, rpcCalls: () => rpcCalls,
    setGeneration(value: string | null) { generation = value; },
    pauseRead() {
      const started = new Promise<void>(resolve => { readStarted = resolve; });
      let release!: () => void;
      readGate = new Promise<void>(resolve => { release = resolve; });
      return { started, release };
    },
    send: (input: unknown) => room.webSocketMessage(sender, JSON.stringify(input)),
    close: () => sqlite.close(),
  };
}

for (const initialize of [true, false]) {
  for (const generation of [null, "generation-2", "generation-1"]) {
    test(`WebSocket load fences an in-flight ${initialize ? "snapshot" : "empty result"} against generation ${generation}`, async () => {
      const f = fixture(initialize, generation !== "generation-1");
      try {
        const before = f.documents.snapshot();
        const read = f.pauseRead();
        const pending = f.send({ type: "load", requestId: "delayed-load" });
        await read.started;
        // Deletion/recreation can commit in D1 while a previously captured
        // DocumentRoom response is still in transit to CollaborationRoom.
        f.setGeneration(generation);
        read.release();
        await pending;
        assert.equal(f.rpcCalls(), 1);
        assert.deepEqual(f.peer.messages, []);
        assert.deepEqual(f.documents.snapshot(), before, "loading must not write a revision");
        if (generation === "generation-1") {
          assert.deepEqual(f.sender.closed, []);
          assert.deepEqual(f.sender.messages.map(raw => JSON.parse(raw)), [{
            type: "snapshot", requestId: "delayed-load", exists: initialize,
            ...(before ? { rev: before.rev, savedAt: before.savedAt, doc: f.original } : {}),
          }]);
        } else {
          assert.equal(f.sender.messages.length, 0, "neither stale content nor a stale exists:false may escape");
          assert.deepEqual(f.sender.closed, [{ code: 1008, reason: "Site generation changed" }]);
        }
      } finally { f.close(); }
    });
  }
}

for (const type of ["load", "save", "patch"] as const) {
  test(`WebSocket ${type} rejects non-string request IDs without invoking document RPC`, async () => {
    const f = fixture();
    try {
      const doc = { ...f.original, siteName: "Must not be saved" };
      const before = f.documents.snapshot();
      for (const requestId of [123, true, ["request"], { toString: null }, null, undefined, "", "bad id"]) {
        f.sender.messages.length = 0;
        await assert.doesNotReject(f.send({ type, requestId, base: "1", doc, patch: createDocPatch(f.original, doc) }));
        assert.equal(f.sender.messages.length, 1);
        assert.deepEqual(JSON.parse(f.sender.messages[0]), {
          type: "error", requestId: "", message: "不正なリクエストIDです",
        });
        assert.equal(f.rpcCalls(), 0);
        assert.deepEqual(f.documents.snapshot(), before);
        assert.deepEqual(f.peer.messages, []);
      }
    } finally { f.close(); }
  });
}

test("WebSocket saves reject non-string, non-null bases before document RPC", async () => {
  const f = fixture();
  try {
    const before = f.documents.snapshot();
    for (const base of [1, ["1"], true, {}, { toString: null }, undefined]) {
      f.sender.messages.length = 0;
      await assert.doesNotReject(f.send({ type: "save", requestId: "save", base,
        doc: { ...f.original, siteName: "Must not be saved" } }));
      assert.deepEqual(f.sender.messages.map(raw => JSON.parse(raw).type), ["error"]);
      assert.equal(JSON.parse(f.sender.messages[0]).requestId, "save");
      assert.equal(f.rpcCalls(), 0);
      assert.deepEqual(f.documents.snapshot(), before);
      assert.deepEqual(f.peer.messages, []);
    }
  } finally { f.close(); }
});

test("WebSocket string IDs and revision bases preserve load, save, patch and conflict behavior", async () => {
  const f = fixture();
  try {
    await f.send({ type: "load", requestId: "load_1" });
    assert.deepEqual(JSON.parse(f.sender.messages.pop()!), {
      type: "snapshot", requestId: "load_1", exists: true,
      rev: "1", savedAt: f.documents.meta()!.savedAt, doc: f.original,
    });
    const saved = { ...f.original, siteName: "Saved" };
    await f.send({ type: "save", requestId: "save-2", base: "1", doc: saved });
    assert.deepEqual(JSON.parse(f.sender.messages.pop()!), {
      type: "saved", requestId: "save-2", rev: "2", savedAt: f.documents.meta()!.savedAt,
    });
    assert.deepEqual(JSON.parse(f.peer.messages.pop()!).doc, saved);
    const patched = { ...saved, siteName: "Patched" };
    const patch = createDocPatch(saved, patched)!;
    await f.send({ type: "patch", requestId: "patch_3", base: "2", patch });
    assert.equal(JSON.parse(f.sender.messages.pop()!).rev, "3");
    assert.deepEqual(JSON.parse(f.peer.messages.pop()!), {
      type: "doc-patched", base: "2", rev: "3", savedAt: f.documents.meta()!.savedAt, patch,
    });
    for (const base of ["1", null]) {
      await f.send({ type: "save", requestId: "conflict", base, doc: saved });
      const response = JSON.parse(f.sender.messages.pop()!);
      assert.equal(response.type, "conflict");
      assert.equal(response.rev, "3");
      assert.deepEqual(response.doc, patched);
      assert.deepEqual(f.peer.messages, []);
    }
  } finally { f.close(); }
});

test("WebSocket null base creates an initial document", async () => {
  const f = fixture(false);
  try {
    await f.send({ type: "save", requestId: "create", base: null, doc: f.original });
    assert.equal(JSON.parse(f.sender.messages[0]).type, "saved");
    assert.equal(f.documents.meta()!.rev, "1");
    assert.deepEqual(JSON.parse(f.documents.snapshot()!.body), f.original);
    assert.deepEqual(JSON.parse(f.peer.messages[0]).doc, f.original);
  } finally { f.close(); }
});

test("WebSocket request IDs cannot throw through object coercion", async () => {
  const f = fixture();
  try {
    await assert.doesNotReject(f.send({ type: "load", requestId: { toString: null } }));
    assert.equal(JSON.parse(f.sender.messages[0]).type, "error");
    assert.equal(f.rpcCalls(), 0);
  } finally { f.close(); }
});
