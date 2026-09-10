import assert from "node:assert/strict";
import { test } from "node:test";
import { readActivity, recordActivity } from "../lib/activity";
import { edit, isRoomLookup, load, replacement, setup, sqlOf } from "./helpers/document-generation-api";

for (const method of ["PUT", "PATCH"] as const) {
  test(`${method} cannot record a committed old save on a replacement site`, async t => {
    const f = await setup(t);
    const oldKey = await f.create("source");
    let newKey: string | undefined;
    f.hooks.beforeExecute = async stmt => {
      if (/INSERT INTO site_activity/.test(sqlOf(stmt))) {
        f.hooks.beforeExecute = undefined;
        newKey = await f.replace("source", replacement);
      }
    };
    const response = await f.doc[method](new Request("https://editor.example.test/api/doc?site=source&base=1", {
      method, headers: { "Content-Type": "application/json" },
      body: JSON.stringify(method === "PUT" ? edit : [{ path: ["siteName"], value: edit.siteName }]),
    }));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).rev, "2");
    assert.ok(newKey);
    assert.notEqual(newKey, oldKey);
    assert.equal(f.room(oldKey).meta()?.rev, "2");
    assert.deepEqual(JSON.parse(f.room(newKey).snapshot()!.body), replacement);
    assert.equal((await readActivity(f.rawDb, "source")).lastEdit, null);
    assert.equal(f.notifications[0]?.roomKey, oldKey);
  });

  test(`${method} records activity for the unchanged generation`, async t => {
    const f = await setup(t);
    const key = await f.create("source");
    const response = await f.doc[method](new Request("https://editor.example.test/api/doc?site=source&base=1", {
      method, headers: { "Content-Type": "application/json" },
      body: JSON.stringify(method === "PUT" ? edit : [{ path: ["siteName"], value: edit.siteName }]),
    }));
    assert.equal(response.status, 200);
    assert.equal((await readActivity(f.rawDb, "source")).lastEdit?.at, f.room(key).meta()?.savedAt);
  });
}

test("generation-fenced activity preserves newer entries and rejects absent generations", async t => {
  const f = await setup(t);
  const key = await f.create("source");
  const user = { email: "synthetic@example.test", name: "Synthetic", image: null };
  await recordActivity(f.db, "source", "edit", user, 20, key);
  await recordActivity(f.db, "source", "edit", user, 10, key);
  await recordActivity(f.db, "source", "edit", user, 30, null);
  assert.equal((await readActivity(f.rawDb, "source")).lastEdit?.at, 20);
  await f.replace("source", replacement);
  await recordActivity(f.db, "source", "edit", user, 40, key);
  assert.equal((await readActivity(f.rawDb, "source")).lastEdit, null);
});

for (const method of ["save", "patch"] as const) {
  test(`WebSocket ${method} activity is fenced after a successful generation lookup`, async t => {
    const f = await setup(t);
    const key = await f.create("source");
    let replacementKey: string | undefined;
    let successfulLookups = 0;
    f.hooks.afterExecute = async stmt => {
      if (isRoomLookup(stmt, "source")) successfulLookups++;
    };
    f.hooks.beforeExecute = async stmt => {
      if (/INSERT INTO site_activity/.test(sqlOf(stmt))) {
        assert.equal(successfulLookups, 2);
        f.hooks.beforeExecute = undefined;
        replacementKey = await f.replace("source", replacement);
      }
    };
    const { CollaborationRoom } = load("../../custom-worker.ts", {
      "cloudflare:workers": { DurableObject: class { constructor(public ctx: unknown, public env: unknown) {} } },
      "./.open-next/worker.js": {}, "./document-room": { DocumentRoom: class {} },
      "./lib/db": { getDbFromBinding: async () => f.db },
    });
    const sender = {
      messages: [] as string[],
      deserializeAttachment: () => ({ siteId: "source", roomKey: key }),
      send(raw: string) { this.messages.push(raw); },
      close() { assert.fail("unexpected generation or auth rejection"); },
    };
    const room = new CollaborationRoom({ getWebSockets: () => [sender] }, { ALLOW_ANONYMOUS: "true", DB: {}, DOC_STORE: {
      idFromName: (key: string) => key,
      get: (key: string) => ({
        replaceDocument: async (raw: string, base: string | null) => f.room(key).replace(raw, base),
        patchDocument: async (value: any, base: string) => f.room(key).patch(value, base),
      }),
    } });
    await room.webSocketMessage(sender, JSON.stringify({
      type: method, requestId: "first", base: "1",
      ...(method === "save" ? { doc: edit } : { patch: [{ path: ["siteName"], value: edit.siteName }] }),
    }));
    assert.equal(sender.messages.length, 1);
    assert.equal(JSON.parse(sender.messages[0]).type, "saved");
    assert.ok(replacementKey);
    assert.notEqual(replacementKey, key);
    assert.deepEqual(JSON.parse(f.room(replacementKey).snapshot()!.body), replacement);
    assert.equal((await readActivity(f.rawDb, "source")).lastEdit, null);
  });
}
