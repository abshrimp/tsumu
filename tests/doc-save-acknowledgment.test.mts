import assert from "node:assert/strict";
import { test } from "node:test";
import * as sites from "../lib/sites";
import { edit, isRoomLookup, load, original, replacement, setup, sqlOf } from "./helpers/document-generation-api";

const patch = [{ path: ["siteName"], value: edit.siteName }];
const request = (method: "PUT" | "PATCH", base = "1") => new Request(`https://editor.example.test/api/doc?site=source&base=${base}`, {
  method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(method === "PUT" ? edit : patch),
});
function publicPayload(value: unknown, ...keys: string[]) {
  for (const key of keys) assert.ok(!JSON.stringify(value).includes(key));
  assert.ok(!JSON.stringify(value).includes('"roomKey"'));
  assert.ok(!JSON.stringify(value).includes('"result"'));
}
for (const method of ["PUT", "PATCH"] as const) {
  test(`${method} acknowledges a committed write without a second room lookup`, async t => {
    const f = await setup(t); const key = await f.create("source"); let reads = 0;
    f.hooks.beforeExecute = async stmt => {
      if (isRoomLookup(stmt, "source")) {
        reads++;
        if (f.room(key).meta()?.rev === "2") throw new Error("Synthetic transient D1 read failure");
      }
    };
    const response = await f.doc[method](request(method));
    assert.equal(response.status, 200);
    const saved = await response.json();
    assert.deepEqual(saved, { ok: true, rev: "2", savedAt: f.room(key).meta()!.savedAt });
    assert.equal(JSON.parse(f.room(key).snapshot()!.body).siteName, edit.siteName);
    assert.equal(reads, 1);
    assert.equal(f.notifications[0]?.roomKey, key);
    publicPayload(saved, key); publicPayload(f.notifications[0].message, key);
    assert.deepEqual(f.logs(), []);
  });
  test(`${method} activity SQL failures remain advisory`, async t => {
    const f = await setup(t); const key = await f.create("source");
    f.hooks.beforeExecute = async stmt => { if (/INSERT INTO site_activity/.test(sqlOf(stmt))) throw new Error("Synthetic activity failure"); };
    const response = await f.doc[method](request(method));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).rev, "2");
    assert.equal(f.room(key).meta()?.rev, "2");
    assert.equal(f.notifications[0]?.roomKey, key);
    assert.deepEqual(f.logs(), []);
  });
  test(`${method} timestamp update failures stay advisory after the document commits`, async t => {
    const f = await setup(t); const key = await f.create("source");
    f.hooks.beforeBatch = async stmts => {
      if (stmts.some(stmt => /UPDATE site_document_rooms/.test(sqlOf(stmt)))) throw new Error("Synthetic timestamp failure");
    };
    const response = await f.doc[method](request(method));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).rev, "2");
    assert.equal(f.room(key).meta()?.rev, "2");
    assert.equal(f.notifications[0]?.roomKey, key);
    assert.deepEqual(f.logs(), []);
  });
  test(`${method} optional notification failure cannot turn a committed save into a failure`, async t => {
    const f = await setup(t); const key = await f.create("source");
    f.hooks.beforeNotify = () => { throw Object.assign(new Error("synthetic-token 非公開のテスト本文"), { roomKey: key }); };
    const response = await f.doc[method](request(method));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).rev, "2");
    assert.equal(f.room(key).meta()?.rev, "2");
    assert.deepEqual(f.logs(), [["[api/doc] document notification failed"]]);
  });
  test(`${method} never routes a committed old document to a replacement generation`, async t => {
    const f = await setup(t); const oldKey = await f.create("source"); let newKey: string | undefined;
    f.hooks.beforeExecute = async stmt => {
      if (/INSERT INTO site_activity/.test(sqlOf(stmt))) {
        f.hooks.beforeExecute = undefined;
        newKey = await f.replace("source", replacement);
      }
    };
    const response = await f.doc[method](request(method));
    assert.equal(response.status, 200);
    assert.ok(newKey); assert.notEqual(newKey, oldKey);
    assert.deepEqual(JSON.parse(f.room(newKey).snapshot()!.body), replacement);
    assert.equal(f.notifications.length, 1);
    assert.equal(f.notifications[0].roomKey, oldKey);
    assert.equal(JSON.stringify(f.notifications[0].message).includes(edit.siteName), true);
    publicPayload(await response.json(), oldKey, newKey);
    publicPayload(f.notifications[0].message, oldKey, newKey);
    assert.deepEqual(f.logs(), []);
  });
  test(`${method} genuine storage failures retain 502 with no notification`, async t => {
    const f = await setup(t); const key = await f.create("source");
    f.hooks.beforeRoomWrite = async () => { throw new Error("synthetic-token storage failure"); };
    const response = await f.doc[method](request(method));
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: "保存できませんでした" });
    assert.equal(f.room(key).meta()?.rev, "1");
    assert.deepEqual(f.notifications, []);
    assert.deepEqual(f.logs(), [["[api/doc] document save failed"]]);
  });
  test(`${method} a replacement during the write returns missing and never broadcasts`, async t => {
    const f = await setup(t); const oldKey = await f.create("source"); let newKey: string | undefined;
    f.hooks.afterRoomWrite = async () => { f.hooks.afterRoomWrite = undefined; newKey = await f.replace("source", replacement); };
    const response = await f.doc[method](request(method));
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: "サイトが見つかりません" });
    assert.deepEqual(f.notifications, []);
    assert.ok(newKey); assert.notEqual(oldKey, newKey);
    assert.deepEqual(JSON.parse(f.room(newKey).snapshot()!.body), replacement);
  });
  test(`${method} conflict snapshots preserve their public shape and never broadcast`, async t => {
    const f = await setup(t); const key = await f.create("source");
    const response = await f.doc[method](request(method, "2"));
    assert.equal(response.status, 409);
    const payload = await response.json();
    assert.deepEqual(payload, { conflict: true, rev: "1", savedAt: f.room(key).meta()!.savedAt, doc: original });
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    publicPayload(payload, key);
    assert.deepEqual(f.notifications, []);
  });
  test(`${method} an obsolete conflict snapshot is not returned or broadcast`, async t => {
    const f = await setup(t); await f.create("source");
    f.hooks.afterRoomWrite = async () => { f.hooks.afterRoomWrite = undefined; await f.replace("source", replacement); };
    const response = await f.doc[method](request(method, "2"));
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: "サイトが見つかりません" });
    assert.deepEqual(f.notifications, []);
  });
}

test("server target envelopes leave the existing storage result APIs unchanged", async t => {
  const f = await setup(t); const key = await f.create("source");
  for (const method of ["saveSiteDocument", "patchSiteDocument"]) {
    const value = method === "saveSiteDocument" ? JSON.stringify(edit) : patch;
    const rev = f.room(key).meta()!.rev;
    const result = await f.services[method](f.rawDb, "source", value, rev);
    assert.deepEqual(result, { kind: "saved", rev: String(Number(rev) + 1), savedAt: f.room(key).meta()!.savedAt });
    const internal = await f.services[method + "WithTarget"](f.rawDb, "source", value, result.rev);
    assert.deepEqual(Object.keys(internal).sort(), ["result", "roomKey"]);
    assert.equal(internal.roomKey, key);
    assert.deepEqual(Object.keys(internal.result).sort(), ["kind", "rev", "savedAt"]);
    const conflict = await f.services[method + "WithTarget"](f.rawDb, "source", value, "1");
    assert.equal(conflict.result.kind, "conflict");
    assert.equal(conflict.roomKey, null);
  }
  await sites.deleteSite(f.rawDb, "source", key);
  const missing = await f.services.saveSiteDocumentWithTarget(f.rawDb, "source", JSON.stringify(edit), null);
  assert.deepEqual(missing, { result: { kind: "missing" }, roomKey: null });
});

for (const method of ["save", "patch"] as const) {
  test(`WebSocket ${method} success, conflict and broadcasts do not contain server-only target keys`, async t => {
    const f = await setup(t); const key = await f.create("source");
    const { CollaborationRoom } = load("../../custom-worker.ts", {
      "cloudflare:workers": { DurableObject: class { constructor(public ctx: unknown, public env: unknown) {} } },
      "./.open-next/worker.js": {}, "./document-room": { DocumentRoom: class {} },
      "./lib/db": { getDbFromBinding: async () => f.rawDb },
    });
    const socket = () => ({
      messages: [] as string[],
      deserializeAttachment: () => ({ siteId: "source", roomKey: key }),
      send(raw: string) { this.messages.push(raw); },
      close() { assert.fail("unexpected generation or auth rejection"); },
    });
    const sender = socket(); const peer = socket();
    const room = new CollaborationRoom({ getWebSockets: () => [sender, peer] }, { DB: {}, DOC_STORE: {
      idFromName: (key: string) => key,
      get: (key: string) => ({
        getSnapshot: async () => f.room(key).snapshot(),
        replaceDocument: async (raw: string, base: string | null) => f.room(key).replace(raw, base),
        patchDocument: async (value: any, base: string) => f.room(key).patch(value, base),
      }),
    } });
    const input = { type: method, requestId: "first", base: "1", ...(method === "save" ? { doc: edit } : { patch }) };
    await room.webSocketMessage(sender, JSON.stringify(input));
    assert.deepEqual(JSON.parse(sender.messages[0]), { type: "saved", requestId: "first", rev: "2", savedAt: f.room(key).meta()!.savedAt });
    assert.equal(peer.messages.length, 1);
    const update = JSON.parse(peer.messages[0]);
    assert.deepEqual(Object.keys(update).sort(), method === "save" ? ["doc", "rev", "savedAt", "type"] : ["base", "patch", "rev", "savedAt", "type"]);
    publicPayload(update, key);
    await room.webSocketMessage(sender, JSON.stringify({ ...input, requestId: "stale" }));
    const conflict = JSON.parse(sender.messages[1]);
    assert.deepEqual(conflict, { type: "conflict", requestId: "stale", rev: "2", savedAt: f.room(key).meta()!.savedAt, doc: edit });
    publicPayload(JSON.parse(sender.messages[0]), key); publicPayload(conflict, key);
    assert.equal(peer.messages.length, 1);
  });
}
