import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { edit, isRoomLookup, load, replacement, setup } from "./helpers/document-generation-api";

async function fixture(t: TestContext) {
  const f = await setup(t);
  const key = await f.create("source");
  const { CollaborationRoom } = load("../../custom-worker.ts", {
    "cloudflare:workers": { DurableObject: class {
      constructor(public ctx: unknown, public env: unknown) {}
    } },
    "./.open-next/worker.js": {},
    "./document-room": { DocumentRoom: class {} },
    "./lib/db": { getDbFromBinding: async () => f.db },
  });
  const socket = (clientId: string, email = "owner@example.test") => ({
    messages: [] as string[], closes: [] as Array<[number, string]>,
    deserializeAttachment: () => ({ clientId, siteId: "source", roomKey: key, user: { email } }),
    send(value: string) { this.messages.push(value); },
    close(code: number, reason: string) { this.closes.push([code, reason]); },
  });
  const sender = socket("sender"), peer = socket("peer"), revoked = socket("revoked", "revoked@example.test");
  const room = new CollaborationRoom({ getWebSockets: () => [sender, peer, revoked] }, {
    DB: {}, ALLOWED_EMAILS: "owner@example.test",
    AUTH_SECRET: "test", AUTH_GOOGLE_ID: "test", AUTH_GOOGLE_SECRET: "test",
    DOC_STORE: {
      idFromName: (value: string) => value,
      get: (value: string) => ({
        getSnapshot: async () => f.room(value).snapshot(),
        replaceDocument: async (raw: string, base: string | null) => {
          await f.hooks.beforeRoomWrite?.(value);
          const result = f.room(value).replace(raw, base);
          await f.hooks.afterRoomWrite?.(value);
          return result;
        },
        patchDocument: async (patch: any, base: string) => {
          await f.hooks.beforeRoomWrite?.(value);
          const result = f.room(value).patch(patch, base);
          await f.hooks.afterRoomWrite?.(value);
          return result;
        },
      }),
    },
  });
  const send = (type: "save" | "patch" | "load", base = "1") => room.webSocketMessage(sender,
    JSON.stringify({ type, requestId: "request-1", base,
      ...(type === "save" ? { doc: edit } : type === "patch" ? { patch: [{ path: ["siteName"], value: edit.siteName }] } : {}),
    }));
  return { ...f, key, sender, peer, revoked, send };
}

for (const method of ["save", "patch"] as const) {
  test(`WebSocket ${method} acknowledges a committed write if the advisory generation lookup fails`, async t => {
    const f = await fixture(t);
    f.hooks.beforeExecute = async statement => {
      if (isRoomLookup(statement, "source") && f.room(f.key).meta()?.rev === "2") {
        throw new Error("synthetic-private-token 非公開のテスト本文");
      }
    };
    await f.send(method);
    assert.deepEqual(f.sender.messages.map(value => JSON.parse(value)), [
      { type: "saved", requestId: "request-1", rev: "2", savedAt: f.room(f.key).meta()!.savedAt },
    ]);
    assert.equal(JSON.parse(f.room(f.key).snapshot()!.body).siteName, edit.siteName);
    assert.equal(f.peer.messages.length, 1);
    const update = JSON.parse(f.peer.messages[0]);
    assert.equal(update.type, method === "save" ? "doc-updated" : "doc-patched");
    assert.equal(update.rev, "2");
    assert.ok(!f.sender.messages.concat(f.peer.messages).join("").includes(f.key));
    assert.deepEqual(f.revoked.messages, []);
    assert.equal(f.revoked.closes[0]?.[0], 1008);
    assert.deepEqual(f.logs(), [["[collab] committed save generation check failed"]]);
  });

  test(`WebSocket ${method} still closes a generation known to have changed after its commit`, async t => {
    const f = await fixture(t);
    let nextKey: string | undefined;
    f.hooks.afterRoomWrite = async () => {
      f.hooks.afterRoomWrite = undefined;
      nextKey = await f.replace("source", replacement);
    };
    await f.send(method);
    assert.deepEqual(f.sender.closes, [[1008, "Site generation changed"]]);
    assert.deepEqual(f.sender.messages, []);
    assert.deepEqual(f.peer.messages, []);
    assert.ok(nextKey);
    assert.deepEqual(JSON.parse(f.room(nextKey).snapshot()!.body), replacement);
  });

  test(`WebSocket ${method} does not record activity in a replacement when generation verification fails`, async t => {
    const f = await fixture(t);
    let nextKey: string | undefined;
    f.hooks.afterRoomWrite = async () => {
      f.hooks.afterRoomWrite = undefined;
      nextKey = await f.replace("source", replacement);
      f.hooks.beforeExecute = async statement => {
        if (isRoomLookup(statement, "source")) throw new Error("Synthetic failed generation lookup");
      };
    };
    await f.send(method);
    assert.deepEqual(f.sender.messages.map(value => JSON.parse(value)), [
      { type: "saved", requestId: "request-1", rev: "2", savedAt: f.room(f.key).meta()!.savedAt },
    ]);
    assert.equal(f.peer.messages.length, 1);
    assert.ok(nextKey);
    assert.deepEqual(JSON.parse(f.room(nextKey).snapshot()!.body), replacement);
    assert.deepEqual((await f.rawDb.execute({
      sql: "SELECT * FROM site_activity WHERE site_id=?", args: ["source"],
    })).rows, []);
    assert.deepEqual(f.logs(), [["[collab] committed save generation check failed"]]);
  });

  test(`WebSocket ${method} cannot return a conflict snapshot when its generation lookup fails`, async t => {
    const f = await fixture(t);
    let reads = 0;
    f.hooks.beforeExecute = async statement => {
      if (isRoomLookup(statement, "source") && ++reads === 2) throw new Error("Synthetic failed fence");
    };
    await f.send(method, "2");
    assert.equal(f.sender.messages.length, 1);
    const response = JSON.parse(f.sender.messages[0]);
    assert.equal(response.type, "error");
    assert.equal(response.requestId, "request-1");
    assert.ok(!Object.hasOwn(response, "doc"));
    assert.equal(f.room(f.key).meta()!.rev, "1");
    assert.deepEqual(f.peer.messages, []);
  });

  test(`WebSocket ${method} never acknowledges a genuine storage failure`, async t => {
    const f = await fixture(t);
    f.hooks.beforeRoomWrite = async () => { throw new Error("Synthetic storage failure"); };
    await f.send(method);
    assert.equal(f.sender.messages.length, 1);
    assert.equal(JSON.parse(f.sender.messages[0]).type, "error");
    assert.equal(f.room(f.key).meta()!.rev, "1");
    assert.deepEqual(f.peer.messages, []);
  });
}

test("WebSocket load still fails closed if its snapshot generation cannot be checked", async t => {
  const f = await fixture(t);
  let reads = 0;
  f.hooks.beforeExecute = async statement => {
    if (isRoomLookup(statement, "source") && ++reads === 2) throw new Error("Synthetic failed fence");
  };
  await f.send("load");
  assert.equal(f.sender.messages.length, 1);
  const response = JSON.parse(f.sender.messages[0]);
  assert.equal(response.type, "error");
  assert.ok(!Object.hasOwn(response, "doc"));
  assert.deepEqual(f.peer.messages, []);
});
