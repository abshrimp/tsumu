import { describe, before, test, afterEach, mock, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { readActivity, recordActivity, type ActivityKind } from "../lib/activity";
import { edit, isRoomLookup, load, replacement, setup, sqlOf, original as original_2 } from "./helpers/document-generation-api";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as join_2, join as join_3 } from "node:path";
import { getDbFromBinding as getDbFromBinding_2, type Db, getDb, getDbFromBinding as getDbFromBinding_3, type D1LikeDatabase } from "../lib/db";
import { nodeDatabase } from "../lib/node-storage";
import { deleteSite, insertSite } from "../lib/sites";
import { canReceiveCloudDoc, CLOUD_SAVE_DEBOUNCE_MS, scheduleCloudSave, sendCloudDoc, type CloudAutosave } from "../lib/cloud-save";
import { createDocPatch, applyDocPatch, type DocPatch } from "../lib/doc-patch";
import { createInitialDoc, makeBox, makeImage } from "../lib/presets";
import { validSiteDoc, validNodeForest } from "../lib/doc-tree";
import { useEditor } from "../lib/store";
import { type CollabServerMessage, type DocUpdatedMessage, type DocChangeMessage } from "../lib/collab";
import { DatabaseSync } from "node:sqlite";
import { StructuredDocumentStore, type DocumentSqlStorage } from "../lib/structured-document-store";
import { publishDocUpdate, subscribeDocUpdates as subscribeDocUpdates_2 } from "../lib/collab-events";
import { mergeDocs, rebaseNodePatch } from "../lib/merge";
import { type SiteDoc } from "../lib/types";
import { createRequire } from "node:module";
import { transformSync } from "./helpers/bundle";
import { addAllowedEmail, removeAllowedEmail } from "../lib/allowlist";
import { readCurrentDoc, saveCurrentDoc, saveDocPatch, validateDocValue } from "../lib/doc-storage";
import { assetSrc } from "../lib/assets";
import { validateImportedDoc } from "../lib/site-import-format";

describe("activity-generation", () => {
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
});

describe("activity-storage", () => {
async function database(run: (db: Db) => Promise<void>) {
  const dir = mkdtempSync(join_2(tmpdir(), "tsumu-activity-"));
  const previous = process.env.TSUMU_DATA_DIR;
  process.env.TSUMU_DATA_DIR = dir;
  try {
    const db = await getDbFromBinding_2(nodeDatabase()!);
    await insertSite(db, "site", { name: "Site", repo: null, branch: "main", previewBranch: "preview", siteUrl: null, previewUrl: null });
    await run(db);
  } finally {
    if (previous === undefined) delete process.env.TSUMU_DATA_DIR; else process.env.TSUMU_DATA_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  }
}
const author = { email: "author@example.test", name: "Current name", image: null };
for (const kind of ["edit", "publish", "publish-test"] as ActivityKind[]) {
  test(`a late ${kind} activity cannot replace a newer event`, async () => database(async db => {
    await recordActivity(db, "site", kind, author, 2000);
    await recordActivity(db, "site", kind, { ...author, name: "Old name" }, 1000);
    const activity = await readActivity(db, "site", 2500);
    const last = kind === "edit" ? activity.lastEdit : kind === "publish" ? activity.lastPublish : activity.lastTestPublish;
    assert.equal(last?.at, 2000);
    assert.equal(last?.name, "Current name");
    await recordActivity(db, "site", kind, { ...author, name: "New name" }, 3000);
    const rows = await db.execute({ sql: "SELECT at, name FROM site_activity WHERE site_id = ? AND kind = ?", args: ["site", kind] });
    assert.equal(rows.rows[0].at, 3000);
    assert.equal(rows.rows[0].name, "New name");
  }));
}

test("a delayed activity cannot resurrect records after the site was deleted", async () => database(async db => {
  await recordActivity(db, "site", "edit", author, 1);
  await deleteSite(db, "site");
  await recordActivity(db, "site", "edit", author, 2);
  const rows = await db.execute("SELECT COUNT(*) AS n FROM site_activity WHERE site_id = 'site'");
  assert.equal(rows.rows[0].n, 0);
}));
});

describe("autosave", () => {
// 実際の自動保存の処理を動かし、通信とタイマーが完了する順序を制御する。
const ref = <T,>(current: T) => ({ current });
afterEach(() => mock.reset());

function harness() {
  mock.timers.enable({ apis: ["setTimeout"] });
  const original = { title: "original" };
  const state = { doc: { title: "first edit" }, cloudState: "synced", cloudError: null as string | null, editingText: null,
    setCloud(value: string, _savedAt?: number, error?: string) { this.cloudState = value; this.cloudError = error ?? null; } };
  const requests: { doc: object; base: string; resolve: (result: any) => void; reject: (error: Error) => void }[] = [];
  let retries = 0;
  let later = 0;
  let unsynced = false;
  const scope = {
    observedDoc: ref(original), cloudReady: ref(true), cloudDirty: ref(false),
    cloudTimer: ref<any>(null),
    activeCloudSave: ref<Promise<void> | null>(null), cloudSaveQueued: ref(false),
    lastSyncedRev: ref("1"), lastSyncedDoc: ref<object>(original), retrySaveAfterEdit: ref(false),
    deferredCloudConflict: ref(null),
    getState: () => state,
    setUnsyncedFlag: (value: boolean) => { unsynced = value; },
    requestRetry: () => { retries++; },
    retryLater: () => { later++; },
    saveCloudDoc: (doc: object, base: string) => new Promise((resolve, reject) => requests.push({ doc, base, resolve, reject })),
  };
  const effect = () => scheduleCloudSave(scope as any, state.doc as any);
  const tick = () => mock.timers.tick(CLOUD_SAVE_DEBOUNCE_MS);
  return { state, scope, effect, tick, requests, retries: () => retries, later: () => later, unsynced: () => unsynced };
}

test("reopening an already synchronized document does not create an unsynced flag", () => {
  const h = harness();
  h.state.doc = h.scope.observedDoc.current;
  h.effect();
  h.tick();
  assert.equal(h.state.cloudState, "synced");
  assert.equal(h.unsynced(), false);
  assert.equal(h.scope.cloudDirty.current, false);
  assert.equal(h.requests.length, 0);
  assert.equal(h.scope.activeCloudSave.current, null);
});

test("pending debounce is already shown as unsaved, before the network request starts", async () => {
  const h = harness();
  h.effect();
  assert.equal(h.requests.length, 0);
  assert.equal(h.state.cloudState, "saving", "saved must describe the current document, not the previous one");
  assert.equal(h.unsynced(), true);
  h.tick();
  assert.equal(h.state.cloudState, "saving");
  h.requests[0].resolve({ ok: true, data: { rev: "2" } });
  await h.scope.activeCloudSave.current;
  assert.equal(h.state.cloudState, "synced");
});

test("undo to the acknowledged snapshot during debounce clears pending status without a write", async () => {
  const h = harness();
  const cleanup = h.effect();
  assert.equal(h.state.cloudState, "saving");
  cleanup?.();
  h.state.doc = h.scope.lastSyncedDoc.current as any;
  h.effect(); h.tick();
  await h.scope.activeCloudSave.current;
  assert.equal(h.requests.length, 0);
  assert.equal(h.state.cloudState, "synced");
  assert.equal(h.unsynced(), false);
});

test("remote echoes and local-only documents do not enter pending cloud save", () => {
  const h = harness();
  h.scope.lastSyncedDoc.current = h.state.doc;
  h.effect(); h.tick();
  assert.equal(h.state.cloudState, "synced");
  assert.equal(h.unsynced(), false);
  h.state.cloudState = "local";
  h.state.doc = { title: "local edit" };
  h.effect(); h.tick();
  assert.equal(h.state.cloudState, "local");
  assert.equal(h.requests.length, 0);
  assert.equal(h.unsynced(), false);
});

test("an edit batched with a received document saves against that document's revision", async () => {
  const h = harness();
  const remote = { title: "peer edit" };
  h.scope.lastSyncedRev.current = "2";
  h.scope.lastSyncedDoc.current = remote;
  h.state.doc = remote;
  assert.equal(canReceiveCloudDoc(h.state as any, remote as any, false), true);
  h.state.doc = { ...remote, title: "new edit" };
  assert.equal(canReceiveCloudDoc(h.state as any, remote as any, false), false,
    "another incoming update must wait even before the autosave effect marks the edit dirty");
  h.effect();
  assert.equal(h.unsynced(), true);
  h.tick();
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].base, "2");
  assert.equal(h.requests[0].doc, h.state.doc);
  h.requests[0].resolve({ ok: true, data: { rev: "3", savedAt: 3 } });
  await h.scope.activeCloudSave.current;
  assert.equal(h.unsynced(), false);
});

test("edits during a slow save are coalesced and use the acknowledged revision", async () => {
  const h = harness();
  h.effect(); h.tick();
  assert.equal(h.requests.length, 1);
  for (const title of ["second edit", "latest edit"]) {
    h.state.doc = { title };
    h.effect(); h.tick();
  }
  assert.equal(h.requests.length, 1, "only one save may be in flight");
  h.requests[0].resolve({ ok: true, data: { rev: "2", savedAt: 1 } });
  await h.scope.activeCloudSave.current;
  assert.equal(h.retries(), 1);
  assert.equal(h.unsynced(), true, "the newer edits must remain unsaved");
  assert.equal(h.state.cloudState, "saving");
  h.effect(); h.tick();
  assert.equal(h.requests.length, 2);
  assert.deepEqual(h.requests[1].doc, { title: "latest edit" });
  assert.equal(h.requests[1].base, "2");
  h.requests[1].resolve({ ok: true, data: { rev: "3", savedAt: 2 } });
  await h.scope.activeCloudSave.current;
  assert.equal(h.unsynced(), false);
  assert.equal(h.state.cloudState, "synced");
  h.effect(); h.tick();
  assert.equal(h.requests.length, 2, "a redundant retry must not save the same snapshot again");
});

test("failed saves release the queue and do not discard pending edits", async () => {
  const h = harness();
  h.effect(); h.tick();
  h.state.doc = { title: "pending edit" };
  h.effect(); h.tick();
  h.requests[0].resolve({ ok: false, status: 502 });
  await h.scope.activeCloudSave.current;
  assert.equal(h.scope.activeCloudSave.current, null);
  assert.equal(h.unsynced(), true);
  assert.equal(h.retries(), 1);
  h.effect(); h.tick();
  assert.equal(h.requests[1].base, "1", "failed saves must not advance the revision");
  assert.deepEqual(h.requests[1].doc, { title: "pending edit" });
  h.requests[1].resolve({ ok: true, data: { rev: "2" } });
  await h.scope.activeCloudSave.current;
});

test("only temporary save failures are retried automatically, and the reason is shown", async () => {
  const h = harness();
  h.effect(); h.tick();
  h.requests[0].reject(new Error("Failed to fetch"));
  await h.scope.activeCloudSave.current;
  assert.equal(h.state.cloudState, "error");
  assert.equal(h.later(), 1, "network failures are retried later");
  h.effect(); h.tick();
  h.requests[1].resolve({ ok: false, status: 413, data: { error: "ドキュメントが大きすぎます（2MBまで）" } });
  await h.scope.activeCloudSave.current;
  assert.equal(h.later(), 1, "a document that is too large fails the same way on every retry");
  assert.equal(h.state.cloudError, "ドキュメントが大きすぎます（2MBまで）");
  h.effect(); h.tick();
  h.requests[2].resolve({ ok: false, status: 502, data: {} });
  await h.scope.activeCloudSave.current;
  assert.equal(h.later(), 2);
  assert.equal(h.unsynced(), true, "failed saves keep the edit marked as unsaved");
});

test("returning to the synced content after a failed save clears the error", async () => {
  const h = harness();
  h.effect(); h.tick();
  h.requests[0].resolve({ ok: false, status: 502, data: {} });
  await h.scope.activeCloudSave.current;
  assert.equal(h.state.cloudState, "error");
  h.state.doc = h.scope.lastSyncedDoc.current as any;
  h.effect(); h.tick();
  await h.scope.activeCloudSave.current;
  assert.equal(h.requests.length, 1, "nothing is left to save");
  assert.equal(h.state.cloudState, "synced");
  assert.equal(h.unsynced(), false);
});

test("initial sync failure continues to block autosave", () => {
  const h = harness();
  h.scope.cloudReady.current = false;
  h.effect(); h.tick();
  assert.equal(h.requests.length, 0);
  assert.equal(h.unsynced(), true);
});

function transport(connected: boolean, httpStatus = 200) {
  const messages: any[] = [];
  const requests: { url: string; method: string; body: any }[] = [];
  const scope = {
    collabSocket: ref(connected ? { readyState: WebSocket.OPEN } : null),
    clientId: "client1", savedAt: () => 10,
    requestViaWebSocket: async (message: any) => { messages.push(message); return { type: "saved", rev: message.base === null ? "1" : "2", savedAt: 20 } as any; },
  };
  mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    requests.push({ url, method: init.method!, body: JSON.parse(String(init.body)) });
    return Response.json({ ok: true, rev: "2", savedAt: 20 }, { status: requests.length === 1 ? httpStatus : 200 });
  });
  const save = (...args: Parameters<typeof sendCloudDoc> extends [any, ...infer R] ? R : never) => sendCloudDoc(scope, ...args);
  return { save, scope, messages, requests };
}

test("the client sends deltas on WebSocket and HTTP and skips semantically unchanged documents", async () => {
  const base = createInitialDoc();
  const next = { ...base, siteName: "Small update" };
  for (const connected of [true, false]) {
    const h = transport(connected);
    assert.equal((await h.save(next, "1", base)).ok, true);
    const expected = createDocPatch(base, next);
    if (connected) {
      assert.deepEqual(h.messages, [{ type: "patch", base: "1", patch: expected }]);
      assert.equal(h.requests.length, 0);
    } else {
      assert.equal(h.requests[0].method, "PATCH");
      assert.deepEqual(h.requests[0].body, expected);
      assert.ok(h.requests[0].url.includes("base=1"));
    }
    await h.save(structuredClone(base), "1", base);
    assert.equal(h.requests.length + h.messages.length, 1, "unchanged data should not be transmitted");
  }
});

test("new sites use full saves and an HTTP patch failure cannot silently downgrade to PUT", async () => {
  const base = createInitialDoc();
  const next = { ...base, siteName: "New name" };
  const fresh = transport(true);
  await fresh.save(base, null);
  assert.deepEqual(fresh.messages[0], { type: "save", base: null, doc: base });

  const rejected = transport(false, 405);
  const result = await rejected.save(next, "1", base);
  assert.equal(result.ok, false);
  assert.equal(result.status, 405);
  assert.deepEqual(rejected.requests.map((request) => request.method), ["PATCH"]);
  assert.deepEqual(rejected.requests[0].body, createDocPatch(base, next));
  assert.ok(rejected.requests[0].url.includes("base=1"));
});

test("an incomplete HTTP success keeps the edit pending until the original base is acknowledged", async () => {
  const h = harness();
  const original = createInitialDoc();
  const snapshot = { ...original, siteName: "Pending edit" };
  h.scope.lastSyncedDoc.current = original;
  h.state.doc = snapshot as any;
  const responses = [
    new Response("<html>Sign in</html>"),
    Response.json(null),
    Response.json({ ok: true }),
    Response.json({ ok: false, rev: "2", savedAt: 20 }),
    Response.json({ ok: true, rev: "1", savedAt: 20 }),
    Response.json({ ok: true, rev: "2", savedAt: 20 }),
  ];
  const writes = mock.method(globalThis, "fetch", async () => responses.shift()!);
  const transport = {
    collabSocket: ref(null), clientId: "client1", savedAt: () => 10,
    requestViaWebSocket: () => Promise.reject(new Error("No WebSocket")),
  };
  h.scope.saveCloudDoc = (doc, base) => sendCloudDoc(transport, doc as typeof original, base, original);
  for (let attempt = 1; attempt <= 5; attempt++) {
    h.effect(); h.tick(); await h.scope.activeCloudSave.current;
    assert.equal(h.state.cloudState, "error");
    assert.equal(h.scope.lastSyncedRev.current, "1");
    assert.equal(h.scope.lastSyncedDoc.current, original);
    assert.equal(h.unsynced(), true);
    assert.equal(h.later(), attempt);
  }
  h.effect(); h.tick(); await h.scope.activeCloudSave.current;
  assert.equal(h.state.cloudState, "synced");
  assert.equal(h.scope.lastSyncedRev.current, "2");
  assert.equal(h.unsynced(), false);
  assert.ok(writes.mock.calls.every(call => String(call.arguments[0]).includes("base=1")));
});

test("an unacknowledged WebSocket revision falls back to HTTP with the original base", async () => {
  const h = transport(true);
  const original = createInitialDoc();
  h.scope.requestViaWebSocket = async () => ({ type: "saved", rev: "1", savedAt: 20 } as any);
  const result = await h.save({ ...original, siteName: "New name" }, "1", original);
  assert.equal(result.ok, true);
  assert.equal(result.data.rev, "2");
  assert.equal(h.requests.length, 1);
  assert.ok(h.requests[0].url.includes("base=1"));
});
});

describe("cloud-save-deferred-recovery", () => {
  before(() => {
    useEditor.setState({
      breakpoint: "base", customWidth: null, styleState: "default", mode: "design",
      pageTheme: "light", selection: null, selectedIds: [], editingComponentId: null, scriptEditor: null,
    });
  });
const ref = <T,>(current: T) => ({ current });
afterEach(() => mock.reset());

for (const editTiming of ["before", "after"] as const) for (const laterEdit of ["undo", "rename", "none"] as const) {
  test(`a deferred lost acknowledgment preserves ${laterEdit} ${editTiming} the conflict and retries after blur`, async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    const original = createInitialDoc();
    useEditor.getState().replaceDoc(original);
    useEditor.getState().setCloud("synced");
    const pageId = original.pageOrder[0];
    let server = original, rev = "1", unsynced = false;
    let disconnect!: (error: Error) => void;
    let writes = 0;
    const socket = ref<{ readyState: number } | null>({ readyState: WebSocket.OPEN });
    const scope: CloudAutosave = {
      observedDoc: ref(original), cloudReady: ref(true), cloudDirty: ref(false),
      cloudTimer: ref(null),
      activeCloudSave: ref(null), cloudSaveQueued: ref(false),
      lastSyncedRev: ref("1"), lastSyncedDoc: ref(original), retrySaveAfterEdit: ref(false),
      deferredCloudConflict: ref(null),
      getState: useEditor.getState,
      setUnsyncedFlag: value => { unsynced = value; },
      requestRetry() {}, retryLater() { assert.fail("HTTP recovery is available"); },
      saveCloudDoc: (snapshot, base, baseDoc) => sendCloudDoc({
        collabSocket: socket, clientId: "test", savedAt: () => 1,
        requestViaWebSocket(input) {
          assert.equal(input.type, "patch");
          if (input.type !== "patch") throw new Error("Expected patch");
          server = applyDocPatch(server, input.patch);
          rev = "2";
          // 自分の保存が確定した後、別の編集者が独立した変更を加える。
          server = { ...server, pages: { ...server.pages,
            [pageId]: { ...server.pages[pageId], name: "Collaborator page" } } };
          rev = "3";
          return new Promise<CollabServerMessage>((_resolve, reject) => { disconnect = reject; });
        },
      }, snapshot, base, baseDoc),
    };
    mock.method(globalThis, "fetch", async (url: string | URL | Request, init?: RequestInit) => {
      writes++;
      const base = new URL(String(url), "https://example.test").searchParams.get("base");
      if (base !== rev) return Response.json({ rev, doc: server, savedAt: 3 }, { status: 409 });
      assert.equal(init?.method, "PATCH");
      server = applyDocPatch(server, JSON.parse(String(init?.body)));
      rev = String(Number(rev) + 1);
      return Response.json({ ok: true, rev, savedAt: Number(rev) });
    });
    const save = () => {
      scheduleCloudSave(scope, useEditor.getState().doc);
      mock.timers.tick(CLOUD_SAVE_DEBOUNCE_MS);
      return scope.activeCloudSave.current;
    };
    useEditor.getState().updateDoc(doc => { doc.siteName = "Sent edit"; });
    const inFlight = save();
    assert.equal(server.siteName, "Sent edit", "server committed before the acknowledgment was lost");
    const change = () => {
      if (laterEdit === "undo") useEditor.getState().undo();
      if (laterEdit === "rename") useEditor.getState().updateDoc(doc => { doc.siteName = "Latest edit"; });
    };
    if (editTiming === "before") change();
    socket.current = null;
    useEditor.setState({ editingText: "active-text" });
    disconnect(new Error("Connection lost after commit"));
    await inFlight;
    assert.equal(writes, 1, "the HTTP fallback received a stale-base conflict");
    assert.equal(scope.deferredCloudConflict.current?.snapshot.siteName, "Sent edit");
    assert.equal(scope.lastSyncedRev.current, "1", "do not advance the baseline until the deferred merge applies");
    if (editTiming === "after") change();
    useEditor.setState({ editingText: "active-text" });
    const wanted = useEditor.getState().doc.siteName;
    const before = structuredClone({ doc: useEditor.getState().doc, past: useEditor.getState().past, future: useEditor.getState().future });
    for (let i = 0; i < 3; i++) await save();
    assert.deepEqual({ doc: useEditor.getState().doc, past: useEditor.getState().past, future: useEditor.getState().future }, before);
    assert.equal(writes, 1, "repeat schedules cannot resend or replace the retained conflict while typing");
    assert.equal(scope.retrySaveAfterEdit.current, true);
    useEditor.setState({ editingText: null });
    scope.retrySaveAfterEdit.current = false; // Editor の blur の購読と同じ通知。
    assert.equal(unsynced, true);
    assert.equal(validSiteDoc(useEditor.getState().doc), true);
    // 確定を待つ間に別の編集者がさらに保存しても、最新の競合を解決する。
    if (editTiming === "after") {
      server = { ...server, pages: { ...server.pages,
        [pageId]: { ...server.pages[pageId], description: "Newer collaborator change" } } };
      rev = "4";
    }
    await save();
    if (editTiming === "after") {
      assert.equal(unsynced, true, "a second conflict remains pending until the retry succeeds");
      assert.equal(scope.lastSyncedRev.current, "4");
      await save();
      assert.equal(server.pages[pageId].description, "Newer collaborator change");
    }
    assert.equal(scope.deferredCloudConflict.current, null);
    assert.equal(server.siteName, wanted);
    assert.equal(server.pages[pageId].name, "Collaborator page");
    assert.equal(unsynced, false);
    assert.equal(useEditor.getState().cloudState, "synced");
    if (laterEdit === "undo") {
      useEditor.getState().redo();
      assert.equal(useEditor.getState().doc.siteName, "Sent edit");
      assert.equal(useEditor.getState().doc.pages[pageId].name, "Collaborator page");
    }
  });
}


test("a deferred conflict cannot overwrite a newer synchronized baseline", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const original = createInitialDoc();
  const snapshot = { ...original, siteName: "Old attempt" };
  const fresh = { ...original, siteName: "New synchronized document" };
  useEditor.getState().replaceDoc(fresh);
  useEditor.getState().setCloud("saving");
  const scope: CloudAutosave = {
    observedDoc: ref(original), cloudReady: ref(true), cloudDirty: ref(true),
    cloudTimer: ref(null), activeCloudSave: ref(null),
    cloudSaveQueued: ref(false), lastSyncedRev: ref("5"), lastSyncedDoc: ref(fresh),
    retrySaveAfterEdit: ref(false),
    deferredCloudConflict: ref({ base: "1", baseDoc: original, snapshot, remoteDoc: snapshot, remoteRev: "2" }),
    getState: useEditor.getState,
    setUnsyncedFlag() {}, requestRetry() {},
    retryLater() { assert.fail("No retry is needed"); },
    async saveCloudDoc() { throw new Error("The current document is already synchronized"); },
  };
  scheduleCloudSave(scope, fresh);
  mock.timers.tick(CLOUD_SAVE_DEBOUNCE_MS);
  await scope.activeCloudSave.current;
  assert.equal(scope.deferredCloudConflict.current, null);
  assert.equal(useEditor.getState().doc, fresh);
  assert.equal(scope.lastSyncedRev.current, "5");
  assert.equal(useEditor.getState().cloudState, "synced");
});

for (const failure of ["malformed", "apply"] as const) {
  test(`a deferred ${failure} failure stays retryable without losing Undo or the conflict baseline`, async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    const original = createInitialDoc();
    const pageId = original.pageOrder[0];
    useEditor.getState().replaceDoc(original);
    useEditor.getState().setCloud("synced");
    let resolveConflict!: (result: Awaited<ReturnType<CloudAutosave["saveCloudDoc"]>>) => void;
    let retries = 0, writes = 0, unsynced = false;
    let server = original;
    let failApply = failure === "apply";
    const scope: CloudAutosave = {
      observedDoc: ref(original), cloudReady: ref(true), cloudDirty: ref(false),
      cloudTimer: ref(null), activeCloudSave: ref(null),
      cloudSaveQueued: ref(false), lastSyncedRev: ref("1"), lastSyncedDoc: ref(original),
      retrySaveAfterEdit: ref(false), deferredCloudConflict: ref(null),
      getState: () => {
        const state = useEditor.getState();
        return { ...state, applyRemoteDoc(doc) {
          if (failApply) throw new Error("Injected store application failure");
          state.applyRemoteDoc(doc);
        } };
      },
      setUnsyncedFlag(value) { unsynced = value; },
      requestRetry() {}, retryLater() { retries++; },
      async saveCloudDoc(snapshot, base) {
        writes++;
        if (writes === 1) {
          server = { ...snapshot, pages: { ...snapshot.pages,
            [pageId]: { ...snapshot.pages[pageId], name: "Keep collaborator change" } } };
          return new Promise(resolve => { resolveConflict = resolve; });
        }
        assert.equal(base, "3");
        server = snapshot;
        return { ok: true, status: 200, data: { rev: "4", savedAt: 4 } };
      },
    };
    const save = () => {
      scheduleCloudSave(scope, useEditor.getState().doc);
      mock.timers.tick(CLOUD_SAVE_DEBOUNCE_MS);
      return scope.activeCloudSave.current!;
    };
    useEditor.getState().updateDoc(doc => { doc.siteName = "Sent edit"; });
    const inFlight = save();
    useEditor.getState().undo();
    useEditor.setState({ editingText: "active-text" });
    resolveConflict({ ok: false, status: 409, data: { rev: "3", doc: failure === "malformed" ? {} : server } });
    await inFlight;
    const conflict = scope.deferredCloudConflict.current;
    assert.ok(conflict);
    useEditor.setState({ editingText: null });
    scope.retrySaveAfterEdit.current = false;
    const before = structuredClone({ doc: useEditor.getState().doc, past: useEditor.getState().past, future: useEditor.getState().future });
    await assert.doesNotReject(save());
    assert.equal(scope.activeCloudSave.current, null);
    assert.equal(useEditor.getState().cloudState, "error");
    assert.equal(retries, 1);
    assert.equal(scope.cloudDirty.current, true);
    assert.equal(unsynced, true);
    assert.equal(scope.deferredCloudConflict.current, conflict, "a failed merge or application must retain the original attempt");
    assert.equal(scope.lastSyncedRev.current, "1");
    assert.equal(scope.lastSyncedDoc.current, original);
    assert.deepEqual({ doc: useEditor.getState().doc, past: useEditor.getState().past, future: useEditor.getState().future }, before);
    assert.equal(writes, 1);
    if (failure === "apply") {
      failApply = false;
      await save();
      assert.equal(scope.deferredCloudConflict.current, null);
      assert.equal(server.siteName, original.siteName, "retry still preserves the Undo");
      assert.equal(server.pages[pageId].name, "Keep collaborator change");
      assert.equal(unsynced, false);
      assert.equal(useEditor.getState().cloudState, "synced");
      useEditor.getState().redo();
      assert.equal(useEditor.getState().doc.siteName, "Sent edit");
      assert.equal(useEditor.getState().doc.pages[pageId].name, "Keep collaborator change");
    }
  });
}
});

describe("cloud-save-recovery", () => {
  before(() => {
    useEditor.setState({
      breakpoint: "base", customWidth: null, styleState: "default", mode: "design",
      pageTheme: "light", selection: null, selectedIds: [], editingComponentId: null, scriptEditor: null,
    });
  });
const ref = <T,>(current: T) => ({ current });
afterEach(() => mock.reset());

for (const laterEdit of ["undo", "rename", "none"] as const) {
  test(`a lost WebSocket save acknowledgment preserves ${laterEdit} during HTTP conflict recovery`, async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    const original = createInitialDoc();
    useEditor.getState().replaceDoc(original);
    useEditor.getState().setCloud("synced");
    const pageId = original.pageOrder[0];
    let server = original, rev = "1", unsynced = false;
    let disconnect!: (error: Error) => void;
    let writes = 0;
    const socket = ref<{ readyState: number } | null>({ readyState: WebSocket.OPEN });
    const scope: CloudAutosave = {
      observedDoc: ref(original), cloudReady: ref(true), cloudDirty: ref(false),
      cloudTimer: ref(null),
      activeCloudSave: ref(null), cloudSaveQueued: ref(false),
      lastSyncedRev: ref("1"), lastSyncedDoc: ref(original), retrySaveAfterEdit: ref(false),
      deferredCloudConflict: ref(null),
      getState: useEditor.getState,
      setUnsyncedFlag: value => { unsynced = value; },
      requestRetry() {}, retryLater() { assert.fail("HTTP recovery is available"); },
      saveCloudDoc: (snapshot, base, baseDoc) => sendCloudDoc({
        collabSocket: socket, clientId: "test", savedAt: () => 1,
        requestViaWebSocket(input) {
          assert.equal(input.type, "patch");
          if (input.type !== "patch") throw new Error("Expected patch");
          server = applyDocPatch(server, input.patch);
          rev = "2";
          // 自分のコミットの後で、別の編集者が独立した変更を加える。
          server = { ...server, pages: { ...server.pages,
            [pageId]: { ...server.pages[pageId], name: "Collaborator page" } } };
          rev = "3";
          return new Promise<CollabServerMessage>((_resolve, reject) => { disconnect = reject; });
        },
      }, snapshot, base, baseDoc),
    };
    mock.method(globalThis, "fetch", async (url: string | URL | Request, init?: RequestInit) => {
      writes++;
      const base = new URL(String(url), "https://example.test").searchParams.get("base");
      if (base !== rev) return Response.json({ rev, doc: server, savedAt: 3 }, { status: 409 });
      assert.equal(init?.method, "PATCH");
      server = applyDocPatch(server, JSON.parse(String(init?.body)));
      rev = String(Number(rev) + 1);
      return Response.json({ ok: true, rev, savedAt: Number(rev) });
    });
    const save = () => {
      scheduleCloudSave(scope, useEditor.getState().doc);
      mock.timers.tick(CLOUD_SAVE_DEBOUNCE_MS);
      return scope.activeCloudSave.current;
    };
    useEditor.getState().updateDoc(doc => { doc.siteName = "Sent edit"; });
    const inFlight = save();
    assert.equal(server.siteName, "Sent edit", "server committed before the acknowledgment was lost");
    if (laterEdit === "undo") useEditor.getState().undo();
    if (laterEdit === "rename") useEditor.getState().updateDoc(doc => { doc.siteName = "Latest edit"; });
    const wanted = useEditor.getState().doc.siteName;
    socket.current = null;
    disconnect(new Error("Connection lost after commit"));
    await inFlight;
    assert.equal(writes, 1, "the HTTP fallback received a stale-base conflict");
    assert.equal(useEditor.getState().doc.siteName, wanted, "conflict resolution must preserve edits made after dispatch");
    assert.equal(useEditor.getState().doc.pages[pageId].name, "Collaborator page");
    assert.equal(scope.lastSyncedRev.current, "3");
    assert.equal(unsynced, true);
    assert.equal(validSiteDoc(useEditor.getState().doc), true);
    await save();
    assert.equal(server.siteName, wanted);
    assert.equal(server.pages[pageId].name, "Collaborator page");
    assert.equal(unsynced, false);
    assert.equal(useEditor.getState().cloudState, "synced");
    if (laterEdit === "undo") {
      useEditor.getState().redo();
      assert.equal(useEditor.getState().doc.siteName, "Sent edit");
      assert.equal(useEditor.getState().doc.pages[pageId].name, "Collaborator page");
    }
  });
}
});

describe("collab-commit-acknowledgment", () => {
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
});

describe("collab-error-privacy", () => {
const fallback = "処理に失敗しました";
const marker = "PRIVATE_秘密";
const patch = [{ path: ["siteName"], value: "Changed" }];
async function fixture(t: TestContext) {
  const h = await setup(t);
  const roomKey = await h.create("source");
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  const storage: DocumentSqlStorage = {
    sql: { exec(sql, ...args) {
      const stmt = sqlite.prepare(sql);
      if (stmt.columns().length) return { toArray: () => stmt.all(...args) as Record<string, unknown>[] };
      stmt.run(...args); return { toArray: () => [] };
    } },
    transactionSync(fn) {
      sqlite.exec("BEGIN");
      try { const result = fn(); sqlite.exec("COMMIT"); return result; }
      catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    },
  };
  const store = new StructuredDocumentStore(storage);
  store.replace(JSON.stringify(original_2), null);
  const remote = {
    getSnapshot: async () => store.snapshot(),
    replaceDocument: async (raw: string, base: string | null) => store.replace(raw, base),
    patchDocument: async (value: any, base: string) => store.patch(value, base),
  };
  const { CollaborationRoom } = load("../../custom-worker.ts", {
    "cloudflare:workers": { DurableObject: class { constructor(public ctx: unknown, public env: unknown) {} } },
    "./.open-next/worker.js": {}, "./document-room": {},
    "./lib/db": { getDbFromBinding: async () => h.db },
  });
  const socket = () => ({ messages: [] as string[],
    deserializeAttachment: () => ({ clientId: "synthetic", siteId: "source", roomKey }),
    send(raw: string) { this.messages.push(raw); },
    close() { assert.fail("unexpected socket close"); },
  });
  const sender = socket(), peer = socket();
  const env: any = { ALLOW_ANONYMOUS: "true", DB: {}, DOC_STORE: { idFromName: (key: string) => key, get: () => remote } };
  const room = new CollaborationRoom({ getWebSockets: () => [sender, peer] }, env);
  const send = async (input: Record<string, unknown>) => {
    const before = sender.messages.length;
    await room.webSocketMessage(sender, JSON.stringify({ requestId: "req-1", ...input }));
    assert.equal(sender.messages.length, before + 1);
    return JSON.parse(sender.messages.at(-1)!);
  };
  return { ...h, sqlite, store, remote, sender, peer, env, send };
}

for (const scenario of ["load-props", "load-entry", "patch-props", "patch-node", "patch-structural", "save-conflict", "patch-conflict", "save-backup", "patch-backup"]) {
  test(`WebSocket redacts stored JSON failures: ${scenario}`, async t => {
    const h = await fixture(t);
    const props = scenario.endsWith("props");
    if (props) h.sqlite.prepare("UPDATE document_meta SET props=?").run(marker);
    else h.sqlite.prepare("UPDATE document_entries SET body=? WHERE bucket='nodes'").run(marker);
    if (scenario.endsWith("backup")) h.sqlite.exec("UPDATE document_meta SET saved_at=1");
    const input = scenario.startsWith("load") ? { type: "load" }
      : scenario.startsWith("save") ? { type: "save", doc: edit, base: scenario.endsWith("conflict") ? "9" : "1" }
      : { type: "patch", base: scenario.endsWith("conflict") ? "9" : "1", patch:
        scenario === "patch-node" ? [{ path: ["nodes", Object.keys(original_2.nodes)[0]], value: Object.values(original_2.nodes)[0] }]
        : scenario === "patch-structural" ? [{ path: ["pages"], value: original_2.pages }] : patch };
    // ハンドラーの模擬の例外だけに頼らず、実際の保存の層で起きた例外を確かめる。
    const operation = () => input.type === "load" ? h.store.snapshot()
      : input.type === "save" ? h.store.replace(JSON.stringify(edit), input.base!)
      : h.store.patch(input.patch!, input.base!);
    assert.throws(operation, error => error instanceof SyntaxError && error.message.includes(marker));
    assert.deepEqual(await h.send(input), { type: "error", requestId: "req-1", message: fallback });
    assert.equal(h.store.meta()!.rev, "1");
    assert.deepEqual(h.peer.messages, []);
    assert.deepEqual(h.logs(), []);
  });
}

test("WebSocket preserves normal snapshots, saves, patches and conflicts", async t => {
  const h = await fixture(t);
  const first = await h.send({ type: "load" });
  assert.equal(first.type, "snapshot"); assert.equal(first.requestId, "req-1"); assert.deepEqual(first.doc, original_2);
  const saved = await h.send({ type: "save", doc: edit, base: "1" });
  assert.equal(saved.type, "saved"); assert.equal(saved.rev, "2"); assert.equal(saved.requestId, "req-1");
  assert.deepEqual(JSON.parse(h.peer.messages[0]).doc, edit);
  const updated = await h.send({ type: "patch", patch, base: "2" });
  assert.equal(updated.type, "saved"); assert.equal(updated.rev, "3"); assert.equal(updated.requestId, "req-1");
  assert.deepEqual(JSON.parse(h.peer.messages[1]).patch, patch);
  for (const input of [{ type: "save", doc: edit }, { type: "patch", patch }]) {
    const conflict = await h.send({ ...input, base: "1" });
    assert.equal(conflict.type, "conflict"); assert.equal(conflict.requestId, "req-1"); assert.equal(conflict.rev, "3");
    assert.deepEqual(conflict.doc, { ...edit, siteName: "Changed" });
    assert.equal(conflict.savedAt, updated.savedAt);
  }
  assert.equal(h.peer.messages.length, 2);
});

test("WebSocket preserves fixed public errors but redacts arbitrary English and Japanese failures", async t => {
  const h = await fixture(t);
  const publicMessages = [
    "保存先が設定されていません", "サイトが指定されていません", "サイトが見つかりません",
    "DOC_STORE binding is missing", "未対応のメッセージです", "不正なリクエスト", "JSONが壊れています",
    "ドキュメントが大きすぎて、保存先に入りきりません", "編集データの1項目が大きすぎます",
    "保存済み編集データが破損しています", "バックアップが破損しています", "Unsupported document storage schema",
    "Invalid document path", "Invalid document patch", "Missing patch collection", "Invalid patch key",
    "Unsupported storage schema", "D1バインディング（DB）がありません",
  ];
  for (const message of publicMessages) {
    h.remote.getSnapshot = async () => { throw new Error(message); };
    assert.deepEqual(await h.send({ type: "load" }), { type: "error", requestId: "req-1", message });
  }
  for (const error of [new Error(`Database failed: ${marker}`), new Error(`保存失敗: ${marker}`), new Error(`${publicMessages[0]} ${marker}`), marker, { message: marker }]) {
    h.remote.getSnapshot = async () => { throw error; };
    assert.deepEqual(await h.send({ type: "load" }), { type: "error", requestId: "req-1", message: fallback });
  }
  assert.deepEqual(h.logs(), []);
});

test("WebSocket keeps real validation, configuration, corruption, missing and capacity errors", async t => {
  const h = await fixture(t);
  const check = async (input: Record<string, unknown>, message: string) =>
    assert.deepEqual(await h.send(input), { type: "error", requestId: "req-1", message });
  await check({ type: "unknown" }, "未対応のメッセージです");
  await check({ type: "save", doc: {}, base: "1" }, "不正なリクエスト");
  await check({ type: "patch", patch, base: "invalid" }, "不正なリクエスト");
  await check({ type: "patch", patch: [{ path: ["siteName"], value: "x".repeat(7_000_001) }], base: "1" }, "編集データの1項目が大きすぎます");
  await check({ type: "patch", patch: [{ path: ["components", "absent"], remove: true }], base: "1" }, "Missing patch collection");
  h.sqlite.exec("UPDATE document_meta SET props='null'");
  await check({ type: "load" }, "保存済み編集データが破損しています");
  h.store.erase();
  await check({ type: "patch", patch, base: "1" }, "サイトが見つかりません");
  h.env.DOC_STORE = undefined;
  await check({ type: "load" }, "DOC_STORE binding is missing");
  h.env.DB = undefined;
  await check({ type: "load" }, "保存先が設定されていません");
  assert.deepEqual(h.logs(), [["D1 database is not configured: set database_id on the DB binding in wrangler.jsonc"]]);
});
});

describe("collab-events", () => {
const message = (rev: string): DocUpdatedMessage => ({
  type: "doc-updated",
  rev,
  savedAt: 1,
  senderId: "a",
  doc: { siteName: "S", pages: {}, pageOrder: [], nodes: {}, assets: {} } as never,
});

test("保存の通知は、同じサイトの購読者だけに届く", () => {
  const got: string[] = [];
  const offA = subscribeDocUpdates_2("site-a", (m, raw) => {
    got.push(`a:${m.rev}`);
    assert.equal(JSON.parse(raw).rev, m.rev);
  });
  const offB = subscribeDocUpdates_2("site-b", (m) => got.push(`b:${m.rev}`));
  publishDocUpdate("site-a", message("1"));
  publishDocUpdate("site-c", message("2"));
  assert.deepEqual(got, ["a:1"]);
  offA();
  offB();
});

test("購読をやめたら届かず、1つの購読者の失敗はほかに影響しない", () => {
  const got: string[] = [];
  const off1 = subscribeDocUpdates_2("s", () => {
    throw new Error("closed");
  });
  const off2 = subscribeDocUpdates_2("s", (m) => got.push(m.rev));
  publishDocUpdate("s", message("1"));
  off2();
  publishDocUpdate("s", message("2"));
  off1();
  assert.deepEqual(got, ["1"]);
});
});

describe("collab-history-performance", () => {
  before(() => {
    useEditor.setState({
      breakpoint: "base", customWidth: null, styleState: "default", mode: "design",
      pageTheme: "light", selection: null, selectedIds: [], editingComponentId: null, scriptEditor: null,
    });
  });
function fixture(count = 64): SiteDoc {
  const ids = Array.from({ length: count }, (_, i) => `node-${i}`);
  return {
    schemaVersion: 1,
    siteName: "History performance",
    pages: {
      home: { id: "home", name: "Home", slug: "", title: "Home",
        description: "", children: ids },
    },
    pageOrder: ["home"],
    nodes: Object.fromEntries(ids.map((id) => [
      id, { ...makeBox(), id, name: id,
        styles: { base: { default: { color: "red" } } } },
    ])),
    assets: {},
    components: {},
  };
}

function remoteRename(base: SiteDoc, id = "node-0", name = "Remote") {
  const updated: SiteDoc = {
    ...base,
    nodes: { ...base.nodes, [id]: { ...base.nodes[id], name } },
  };
  const patch = createDocPatch(base, updated);
  assert.ok(patch?.length, "a node change produces a nonempty patch");
  return { updated, patch };
}

test("a collaborator's node edit rebases checkpoints without cloning unrelated nodes", () => {
  const base = fixture(128);
  const { updated, patch } = remoteRename(base);
  const checkpoint = {
    ...base,
    nodes: { ...base.nodes,
      "node-0": { ...base.nodes["node-0"],
        styles: { base: { default: { color: "green" } } } },
      "node-4": { ...base.nodes["node-4"], name: "Older local name" },
    },
  };
  const originals = structuredClone([base, updated, checkpoint]);
  const rebased = rebaseNodePatch(base, updated, checkpoint, patch!);
  assert.ok(rebased);
  assert.deepEqual(rebased, mergeDocs(base, updated, checkpoint));
  assert.equal(rebased.nodes["node-0"].name, "Remote");
  assert.equal(rebased.nodes["node-0"].styles.base?.default?.color, "green");
  assert.equal(rebased.nodes["node-4"], checkpoint.nodes["node-4"]);
  assert.equal(rebased.nodes["node-64"], checkpoint.nodes["node-64"]);
  assert.equal(rebased.pages, checkpoint.pages);
  assert.deepEqual([base, updated, checkpoint], originals);
});

test("multiple node property patches preserve edits to different nested properties", () => {
  const base = fixture();
  const updated = {
    ...base,
    nodes: { ...base.nodes,
      "node-0": { ...base.nodes["node-0"],
        styles: { base: { default: { color: "blue" } } } },
      "node-1": { ...base.nodes["node-1"], name: "Collaborator" },
    },
  };
  const checkpoint = {
    ...base,
    nodes: { ...base.nodes,
      "node-0": { ...base.nodes["node-0"], name: "Local name" },
      "node-1": { ...base.nodes["node-1"],
        styles: { base: { default: { color: "purple" } } } },
    },
  };
  const patch = createDocPatch(base, updated)!;
  assert.equal(patch.length, 2);
  const result = rebaseNodePatch(base, updated, checkpoint, patch);
  assert.ok(result);
  assert.deepEqual(result, mergeDocs(base, updated, checkpoint));
  assert.equal(result.nodes["node-0"].name, "Local name");
  assert.equal(result.nodes["node-0"].styles.base?.default?.color, "blue");
  assert.equal(result.nodes["node-1"].name, "Collaborator");
  assert.equal(result.nodes["node-1"].styles.base?.default?.color, "purple");
});

test("structural edits and incomplete checkpoints retain the full-merge fallback", () => {
  const base = fixture(3);
  const { updated, patch } = remoteRename(base);
  assert.equal(rebaseNodePatch(base, updated, { ...base,
    nodes: { ...base.nodes, "node-0": undefined },
  } as unknown as SiteDoc, patch!), null);
  const moved = { ...base,
    nodes: { ...base.nodes,
      "node-0": { ...base.nodes["node-0"], children: ["node-2"] },
    },
  };
  assert.equal(rebaseNodePatch(base, moved, base, createDocPatch(base, moved)!), null);
  assert.equal(rebaseNodePatch(base, { ...base, siteName: "Different" }, base,
    [{ path: ["siteName"], value: "Different" }] as DocPatch), null);
  assert.equal(rebaseNodePatch(base, updated, base,
    [{ path: ["nodes", "node-0"], remove: true }] as DocPatch), null);
  assert.equal(rebaseNodePatch(base, updated, base, []), null);
});

test("Undo keeps collaborative edits while sharing unchanged history data", () => {
  useEditor.getState().replaceDoc(fixture(80));
  useEditor.getState().updateNode("node-0", { name: "Local name" });
  useEditor.getState().setStyleProps("node-0", { color: "green" });
  const before = useEditor.getState();
  const checkpoint = before.past.at(-1)!;
  const { updated, patch } = remoteRename(before.doc);
  before.applyRemoteDoc(updated, { baseDoc: before.doc, patch: patch! });
  const after = useEditor.getState();
  assert.equal(after.past.at(-1)!.nodes["node-70"], checkpoint.nodes["node-70"]);
  after.undo();
  assert.equal(useEditor.getState().doc.nodes["node-0"].name, "Remote");
  assert.equal(useEditor.getState().doc.nodes["node-0"].styles.base?.default?.color, "red");
  useEditor.getState().redo();
  assert.equal(useEditor.getState().doc.nodes["node-0"].name, "Remote");
  assert.equal(useEditor.getState().doc.nodes["node-0"].styles.base?.default?.color, "green");
});
});

describe("collab-security", () => {
// 実際のハンドラーを実行し、Cloudflare のホストの環境と Next.js のリクエストの文脈だけを置き換える。
function loadHandler(path: string, mocks: Record<string, unknown>): any {
  const url = new URL(path, import.meta.url);
  const require = createRequire(url);
  const source = readFileSync(url, "utf8");
  const { code } = transformSync(source, { loader: "ts", format: "cjs", target: "es2022" });
  const module = { exports: {} };
  const securityMocks: Record<string, unknown> = {
    "../../../../lib/site-access": { requireSiteAccess: async () => null, siteRole: async () => "editor", permits: () => true },
    "../../../lib/site-access": { requireSiteAccess: async () => null, siteRole: async () => "editor", permits: () => true },
    "../../../../lib/db": { dbConfigured: () => false },
  };
  new Function("require", "module", "exports", code)(
    (name: string) => name === "./document-room"
      ? { DocumentRoom: class {} } // Durable Object のクラスは、専用の保存先のテストで確かめる。
      : Object.hasOwn(mocks, name) ? mocks[name] : Object.hasOwn(securityMocks,name) ? securityMocks[name] : require(name), module, module.exports,
  );
  return module.exports;
}

async function withAllowlist(run: () => Promise<void>) {
  const dir = mkdtempSync(join_3(tmpdir(), "tsumu-collab-auth-"));
  const previous = { TSUMU_DATA_DIR: process.env.TSUMU_DATA_DIR, ALLOWED_EMAILS: process.env.ALLOWED_EMAILS };
  process.env.TSUMU_DATA_DIR = dir;
  process.env.ALLOWED_EMAILS = "owner@example.com";
  try {
    await addAllowedEmail("editor@example.com", "editor");
    await run();
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(dir, { recursive: true, force: true });
  }
}

function d1Binding(): D1LikeDatabase {
  const raw = nodeDatabase()!;
  return { prepare: raw.prepare, batch: raw.batch };
}

function createDocStore(initial?: string) {
  const sqlite = new DatabaseSync(":memory:");
  const storage: DocumentSqlStorage = {
    sql: { exec(sql, ...args) {
      const stmt = sqlite.prepare(sql);
      if (stmt.columns().length) return { toArray: () => stmt.all(...args) as Record<string, unknown>[] };
      stmt.run(...args); return { toArray: () => [] };
    } },
    transactionSync(fn) {
      sqlite.exec("BEGIN");
      try { const result = fn(); sqlite.exec("COMMIT"); return result; }
      catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    },
  };
  const store = new StructuredDocumentStore(storage);
  if (initial !== undefined) store.replace(initial, null);
  const remote = {
    getSnapshot: async () => store.snapshot(),
    getMetadata: async () => store.meta(),
    replaceDocument: async (raw: string, base: string | null) => store.replace(raw, base),
    patchDocument: async (patch: Parameters<StructuredDocumentStore["patch"]>[0], base: string) => store.patch(patch, base),
  };
  return {
    store,
    close: () => sqlite.close(),
    DOC_STORE: { idFromName: (key: string) => key, get: () => remote },
  };
}

function socket(email: string, roomKey = "room-s1") {
  return {
    messages: [] as string[], closed: false,
    deserializeAttachment: () => ({ clientId: email, siteId: "s1", roomKey, user: { email } }),
    send(raw: string) { this.messages.push(raw); },
    close(code: number) { assert.equal(code, 1008); this.closed = true; },
  };
}

test("WebSocket sender and recipient follow the current anonymous mode", async () => {
  const { CollaborationRoom } = loadHandler("../custom-worker.ts", {
    "cloudflare:workers": { DurableObject: class {
      constructor(public ctx: unknown, public env: unknown) {}
    } },
    "./.open-next/worker.js": {},
  });
  for (const change of [{ ALLOW_ANONYMOUS: "false" }, {
    AUTH_SECRET: "secret", AUTH_GOOGLE_ID: "client", AUTH_GOOGLE_SECRET: "secret",
  }]) {
    const peer = { ...socket("peer"), deserializeAttachment: () => ({ user: null }) };
    const sender = { ...socket("sender"), deserializeAttachment: () => ({ user: null }) };
    const env = { ALLOW_ANONYMOUS: "true" };
    const room = new CollaborationRoom({ getWebSockets: () => [peer] }, env);
    const broadcast = () => room.fetch(new Request("https://room/broadcast", { method: "POST", body: "{}" }));
    await room.webSocketMessage(sender, "ping");
    await broadcast();
    Object.assign(env, change);
    await room.webSocketMessage(sender, "ping");
    await broadcast();
    assert.deepEqual(sender.messages, ["pong"]);
    assert.deepEqual(peer.messages, ["{}"]);
    assert.ok(sender.closed && peer.closed);
  }
});

test("an anonymous event stream rechecks access on the next notification", async t => {
  const previous = process.env.ALLOW_ANONYMOUS;
  t.after(() => {
    if (previous === undefined) delete process.env.ALLOW_ANONYMOUS;
    else process.env.ALLOW_ANONYMOUS = previous;
  });
  process.env.ALLOW_ANONYMOUS = "true";
  const { GET } = loadHandler("../app/api/collab/events/route.ts", {
    "../../../../lib/server": { requireAuth: async () => null },
    "../../../../auth": { authConfigured: () => false },
    "../../../../lib/site-server": { siteIdOf: async () => "s1" },
    "../../../../lib/collab": { collabRoomAvailable: () => false },
  });
  const abort = new AbortController();
  t.after(() => abort.abort());
  const res = await GET(new Request("https://editor.example/api/collab/events?site=s1", { signal: abort.signal }));
  const reader = res.body.getReader();
  assert.equal(new TextDecoder().decode((await reader.read()).value), ": connected\n\n");
  delete process.env.ALLOW_ANONYMOUS;
  publishDocUpdate("s1", { type: "doc-updated", doc: createInitialDoc(), rev: "1", savedAt: 1 });
  assert.equal((await reader.read()).done, true);
});

test("each broadcast reads the allowlist once and refreshes it before the next broadcast", async () => {
  let emails = ["first@example.com", "second@example.com"];
  let reads = 0;
  const { CollaborationRoom } = loadHandler("../custom-worker.ts", {
    "cloudflare:workers": { DurableObject: class {
      constructor(public ctx: unknown, public env: unknown) {}
    } },
    "./.open-next/worker.js": {},
    "./lib/db": { getDbFromBinding: async () => ({ execute: async (stmt: unknown) => {
      const sql = typeof stmt === "string" ? stmt : (stmt as {sql: string}).sql;
      if (sql.includes("site_members")) return { rows: [{role: "editor"}] };
      reads++;
      return { rows: emails.map((email) => ({ email })) };
    } }) },
  });
  const first = socket("first@example.com");
  const second = socket("second@example.com");
  const room = new CollaborationRoom({ getWebSockets: () => [first, second] }, {
    DB: {}, ALLOWED_EMAILS: "", AUTH_SECRET: "test", AUTH_GOOGLE_ID: "test", AUTH_GOOGLE_SECRET: "test",
  });
  const broadcast = () => room.fetch(new Request("https://room/broadcast", {
    method: "POST", body: '{"type":"doc-updated"}',
  }));
  await broadcast();
  assert.equal(reads, 1);
  assert.equal(first.messages.length, 1);
  assert.equal(second.messages.length, 1);
  emails = ["second@example.com"];
  await broadcast();
  assert.equal(reads, 2);
  assert.equal(first.closed, true);
  assert.equal(first.messages.length, 1, "revoked recipients must not receive another update");
  assert.equal(second.messages.length, 2);
});

test("WebSocket patch saves broadcast deltas to all authorized peers", async () => {
  await withAllowlist(async () => {
    const { CollaborationRoom } = loadHandler("../custom-worker.ts", {
      "cloudflare:workers": { DurableObject: class {
        constructor(public ctx: unknown, public env: unknown) {}
      } },
      "./.open-next/worker.js": {},
    });
    const d1 = d1Binding();
    const db = await getDbFromBinding_3(d1);
    const roomKey = (await insertSite(db, "s1", { name: "s1", repo: null, branch: "main", previewBranch: "preview", siteUrl: null, previewUrl: null }, "owner@example.com"))!;
    await db.execute({ sql: "INSERT INTO site_members(site_id,email,role) VALUES(?,?,'editor')", args: ["s1", "editor@example.com"] });
    const base = createInitialDoc();
    const docs = createDocStore(JSON.stringify(base));
    try {
      const next = { ...base, siteName: "Changed through a patch" };
      const patch = createDocPatch(base, next)!;
      const sender = socket("owner@example.com", roomKey);
      const first = socket("editor@example.com", roomKey);
      const second = socket("editor@example.com", roomKey);
      const room = new CollaborationRoom({ getWebSockets: () => [sender, first, second] }, {
        DB: d1, DOC_STORE: docs.DOC_STORE, ALLOWED_EMAILS: "owner@example.com",
        AUTH_SECRET: "test", AUTH_GOOGLE_ID: "test", AUTH_GOOGLE_SECRET: "test",
      });
      await room.webSocketMessage(sender, JSON.stringify({ type: "patch", requestId: "p1", base: "1", patch }));
      assert.equal(JSON.parse(sender.messages[0]).type, "saved");
      for (const peer of [first, second]) {
        const delta = JSON.parse(peer.messages[0]);
        assert.equal(delta.type, "doc-patched");
        assert.deepEqual(delta.patch, patch);
        assert.equal(delta.doc, undefined);
        assert.equal(delta.base, "1");
      }
      await room.webSocketMessage(sender, JSON.stringify({ type: "patch", requestId: "p2", base: "1", patch }));
      assert.equal(JSON.parse(sender.messages[1]).type, "conflict");
      assert.equal(first.messages.length, 1, "rejected patches must not be broadcast");
      assert.equal(second.messages.length, 1, "rejected patches must not be broadcast");
    } finally {
      docs.close();
    }
  });
});

test("HTTP PATCH enforces revision checks and publishes only the delta", async () => {
  await withAllowlist(async () => {
    const updates: any[] = [];
    const { PATCH } = loadHandler("../app/api/doc/route.ts", {
      "../../../lib/server": { requireAuth: async () => null, sessionUser: async () => ({ email: "owner@example.com" }) },
      "../../../lib/i18n-server": { serverTr: async () => (value: string) => value },
      "../../../lib/site-server": { siteIdOf: async () => "s1" },
      "../../../lib/collab": { notifyDocUpdated: (_site: string, message: any) => updates.push(message) },
    });
    const db = await getDb();
    await insertSite(db, "s1", { name: "s1", repo: null, branch: "main", previewBranch: "preview", siteUrl: null, previewUrl: null });
    const base = createInitialDoc();
    await saveCurrentDoc(db, "s1", JSON.stringify(base), null);
    const next = { ...base, siteName: "HTTP delta" };
    const patch = createDocPatch(base, next)!;
    const request = (query: string, body = patch) => new Request(`https://editor.example/api/doc?site=s1${query}`, {
      method: "PATCH", headers: { "Content-Type": "application/json", "X-Collab-Client-Id": "client1" }, body: JSON.stringify(body),
    });
    assert.equal((await PATCH(request(""))).status, 400);
    assert.equal((await PATCH(request("&base=1", [{ path: ["pages"], remove: true }]))).status, 400);
    assert.equal((await PATCH(request("&base=1"))).status, 200);
    assert.equal(updates.length, 1);
    assert.equal(updates[0].type, "doc-patched");
    assert.equal(updates[0].doc, undefined);
    assert.equal(updates[0].senderId, "client1");
    assert.equal((await PATCH(request("&base=1"))).status, 409);
    assert.equal(updates.length, 1);
    assert.deepEqual(JSON.parse((await readCurrentDoc(db, "s1"))!.body), next);
  });
});

test("SSE broadcasts patch deltas to all authorized clients", async () => {
  await withAllowlist(async () => {
    const { GET } = loadHandler("../app/api/collab/events/route.ts", {
      "../../../../lib/server": { requireAuth: async (mode: string) => { assert.equal(mode, "user"); return { email: "editor@example.com" }; } },
      "../../../../auth": { authConfigured: () => true },
      "../../../../lib/site-server": { siteIdOf: async () => "s1" },
      "../../../../lib/collab": { collabRoomAvailable: () => false },
    });
    const db = await getDb();
    await insertSite(db, "s1", { name: "s1", repo: null, branch: "main", previewBranch: "preview", siteUrl: null, previewUrl: null });
    const base = createInitialDoc();
    await saveCurrentDoc(db, "s1", JSON.stringify(base), null);
    const next = { ...base, siteName: "SSE delta" };
    const patch = createDocPatch(base, next)!;
    await saveDocPatch(db, "s1", patch, "1");
    const abort = new AbortController();
    const first = (await GET(new Request("https://editor.example/api/collab/events?site=s1", { signal: abort.signal }))).body.getReader();
    const second = (await GET(new Request("https://editor.example/api/collab/events?site=s1&clientId=second", { signal: abort.signal }))).body.getReader();
    try {
      await Promise.all([first.read(), second.read()]);
      publishDocUpdate("s1", { type: "doc-patched", base: "1", rev: "2", savedAt: 1, patch });
      const decode = (data: Uint8Array) => JSON.parse(new TextDecoder().decode(data).slice(6).trim());
      for (const reader of [first, second]) {
        const delta = decode((await reader.read()).value);
        assert.equal(delta.type, "doc-patched");
        assert.deepEqual(delta.patch, patch);
        assert.equal(delta.doc, undefined);
      }
    } finally {
      abort.abort();
      await Promise.all([first.cancel(), second.cancel()]);
    }
  });
});

test("open WebSockets lose read, write and broadcast access when their account is removed", async () => {
  await withAllowlist(async () => {
    const { CollaborationRoom } = loadHandler("../custom-worker.ts", {
      "cloudflare:workers": { DurableObject: class {
        constructor(public ctx: unknown, public env: unknown) {}
      } },
      "./.open-next/worker.js": {},
    });
    const d1 = d1Binding();
    const db = await getDbFromBinding_3(d1);
    const roomKey = (await insertSite(db, "s1", {
      name: "s1", repo: null, branch: "main", previewBranch: "preview", siteUrl: null, previewUrl: null,
    }, "owner@example.com"))!;
    await db.execute({ sql: "INSERT INTO site_members(site_id,email,role) VALUES(?,?,'editor')", args: ["s1", "editor@example.com"] });
    const docs = createDocStore();
    try {
      const editor = socket("editor@example.com", roomKey);
      const owner = socket("owner@example.com", roomKey);
      const room = new CollaborationRoom({ getWebSockets: () => [editor, owner] }, {
        DB: d1, DOC_STORE: docs.DOC_STORE, ALLOWED_EMAILS: "owner@example.com",
        AUTH_SECRET: "test", AUTH_GOOGLE_ID: "test", AUTH_GOOGLE_SECRET: "test",
      });
      await room.webSocketMessage(editor, "ping");
      assert.deepEqual(editor.messages, ["pong"]);
      editor.messages = [];
      await removeAllowedEmail("editor@example.com");
      await room.webSocketMessage(editor, JSON.stringify({ type: "save", requestId: "save1", doc: createInitialDoc(), base: null }));
      assert.equal(docs.store.snapshot(), null, "revoked sockets cannot save");
      await room.webSocketMessage(editor, JSON.stringify({ type: "load", requestId: "load1" }));
      await room.webSocketMessage(owner, JSON.stringify({ type: "save", requestId: "save2", doc: createInitialDoc(), base: null }));
      assert.ok(docs.store.snapshot());
      assert.equal(JSON.parse(owner.messages[0]).type, "saved");
      await room.fetch(new Request("https://room/broadcast", { method: "POST", body: '{"type":"doc-updated"}' }));
      assert.equal(owner.messages.length, 2, "allowed recipients still receive updates");
      assert.equal(editor.closed, true);
      assert.deepEqual(editor.messages, [], "revoked recipients cannot load or receive either broadcast path");
    } finally {
      docs.close();
    }
  });
});

test("an open SSE stream closes without leaking the next document after revocation", async () => {
  await withAllowlist(async () => {
    const { GET } = loadHandler("../app/api/collab/events/route.ts", {
      "../../../../lib/server": { requireAuth: async (mode: string) => { assert.equal(mode, "user"); return { email: "editor@example.com" }; } },
      "../../../../auth": { authConfigured: () => true },
      "../../../../lib/site-server": { siteIdOf: async () => "s1" },
      "../../../../lib/collab": { collabRoomAvailable: () => false },
    });
    const abort = new AbortController();
    const response = await GET(new Request("https://editor.example/api/collab/events?site=s1", { signal: abort.signal }));
    const reader = response.body.getReader();
    try {
      assert.equal(new TextDecoder().decode((await reader.read()).value), ": connected\n\n");
      await removeAllowedEmail("editor@example.com");
      publishDocUpdate("s1", { type: "doc-updated", doc: createInitialDoc(), rev: "1", savedAt: 1 });
      assert.equal((await reader.read()).done, true);
    } finally {
      abort.abort();
      await reader.cancel();
    }
  });
});

test("a disconnected saving sender does not prevent persistence, activity or peer notifications", async () => {
  await withAllowlist(async () => {
    const { CollaborationRoom } = loadHandler("../custom-worker.ts", {
      "cloudflare:workers": { DurableObject: class { constructor(public ctx: unknown, public env: unknown) {} } },
      "./.open-next/worker.js": {},
    });
    const d1 = d1Binding();
    const db = await getDbFromBinding_3(d1);
    const roomKey = (await insertSite(db, "s1", { name: "s1", repo: null, branch: "main", previewBranch: "preview", siteUrl: null, previewUrl: null }, "owner@example.com"))!;
    await db.execute({ sql: "INSERT INTO site_members(site_id,email,role) VALUES(?,?,'editor')", args: ["s1", "editor@example.com"] });
    let base = createInitialDoc();
    const docs = createDocStore(JSON.stringify(base));
    try {
      for (const type of ["save", "patch"] as const) {
        const sender = socket("owner@example.com", roomKey);
        sender.deserializeAttachment = () => ({ clientId: "sender", siteId: "s1", roomKey, user: { email: "owner@example.com", name: null, image: null } });
        sender.send = () => { throw new Error("WebSocket is closed"); };
        const peer = socket("editor@example.com", roomKey);
        const room = new CollaborationRoom({ getWebSockets: () => [sender, peer] }, {
          DB: d1, DOC_STORE: docs.DOC_STORE, ALLOWED_EMAILS: "owner@example.com", AUTH_SECRET: "test", AUTH_GOOGLE_ID: "test", AUTH_GOOGLE_SECRET: "test",
        });
        const current = docs.store.snapshot();
        const next = { ...base, siteName: `Saved through ${type}` };
        const input = type === "save" ? { type, doc: next } : { type, patch: createDocPatch(base, next) };
        await assert.doesNotReject(room.webSocketMessage(sender, JSON.stringify({ ...input, base: current!.rev, requestId: type })));
        assert.equal(JSON.parse(docs.store.snapshot()!.body).siteName, next.siteName);
        assert.equal(peer.messages.length, 1);
        assert.equal(JSON.parse(peer.messages[0]).type, type === "save" ? "doc-updated" : "doc-patched");
        assert.equal((await db.execute("SELECT email FROM site_activity WHERE site_id = 's1' AND kind = 'edit'")).rows[0]?.email, "owner@example.com");
        base = next;
      }
      const oversized = socket("owner@example.com", roomKey);
      const room = new CollaborationRoom({ getWebSockets: () => [oversized] }, {
        DB: d1, DOC_STORE: docs.DOC_STORE, ALLOWED_EMAILS: "owner@example.com", AUTH_SECRET: "test", AUTH_GOOGLE_ID: "test", AUTH_GOOGLE_SECRET: "test",
      });
      await room.webSocketMessage(oversized, new ArrayBuffer(64 * 1024 * 1024 + 1));
      assert.equal(oversized.messages.length, 1);
      assert.equal(JSON.parse(oversized.messages[0]).type, "error");
    } finally {
      docs.close();
    }
  });
});
});

describe("collab-stream-backpressure", () => {
function handler(authorize: () => Promise<boolean> = async () => true) {
  let listener: ((message: DocChangeMessage, raw: string) => void) | null = null;
  let unsubscribed = 0;
  const mocks: Record<string, unknown> = {
    "next/server": { NextResponse: class extends Response {} },
    "../../../../lib/anonymous": { collaborationIdentityAllowed: () => true },
    "../../../../lib/server": { requireAuth: async () => ({ email: "editor@example.com" }) },
    "../../../../lib/allowlist": { isEmailAllowed: authorize },
    "../../../../lib/db": { dbConfigured: () => false },
    "../../../../lib/site-access": { requireSiteAccess: async () => null, permits: () => true, siteRole: async () => "editor" },
    "../../../../auth": { authConfigured: () => true },
    "../../../../lib/site-server": { siteIdOf: async () => "site" },
    "../../../../lib/collab": { collabRoomAvailable: () => false },
    "../../../../lib/collab-events": { subscribeDocUpdates: (_: string, callback: typeof listener) => {
      listener = callback;
      return () => { listener = null; unsubscribed++; };
    } },
  };
  const source = readFileSync(new URL("../app/api/collab/events/route.ts", import.meta.url), "utf8");
  const { code } = transformSync(source, { loader: "ts", format: "cjs", target: "es2022" });
  const module = { exports: {} as { GET(req: Request): Promise<Response> } };
  new Function("require", "module", "exports", code)((name: string) => {
    assert.ok(Object.hasOwn(mocks, name), `unexpected dependency ${name}`);
    return mocks[name];
  }, module, module.exports);
  return {
    GET: module.exports.GET,
    emit: (raw: string) => listener?.({ type: "doc-patched", rev: "2", base: "1", savedAt: 1, patch: [] }, raw),
    unsubscribed: () => unsubscribed,
  };
}

const tick = () => new Promise<void>(resolve => setImmediate(resolve));

test("a stalled authorization cannot retain an unlimited queue of collaboration notifications", async t => {
  let finish!: (allowed: boolean) => void;
  let checks = 0;
  const h = handler(() => {
    checks++;
    return new Promise<boolean>(resolve => { finish = resolve; });
  });
  const abort = new AbortController();
  t.after(() => abort.abort());
  const response = await h.GET(new Request("https://editor.example/api/collab/events?site=site", { signal: abort.signal }));
  const reader = response.body!.getReader();
  for (let i = 0; i < 100; i++) h.emit(JSON.stringify({ revision: i }));
  assert.equal(h.unsubscribed(), 1, "overflow immediately removes the listener");
  await assert.rejects(reader.read(), /buffer exceeded/);
  finish(true);
  await tick();
  assert.equal(checks, 1, "discarded messages must not continue querying authorization");
});

test("an unread stream is bounded by UTF-8 bytes and releases its queued data on overflow", async t => {
  const h = handler();
  const abort = new AbortController();
  t.after(() => abort.abort());
  const response = await h.GET(new Request("https://editor.example/api/collab/events?site=site", { signal: abort.signal }));
  const reader = response.body!.getReader();
  await reader.read();
  const large = "あ".repeat(4 * 1024 * 1024); // UTF-8 では 12 MiB だが、コード単位では 4 MiB にすぎない。
  for (let i = 0; i < 6; i++) {
    h.emit(large);
    await tick();
  }
  assert.equal(h.unsubscribed(), 1);
  await assert.rejects(reader.read(), /buffer exceeded/, "overflow discards old chunks instead of draining an obsolete queue");
});

test("a consuming client keeps notification order and cancellation removes the listener once", async () => {
  const h = handler();
  const abort = new AbortController();
  const response = await h.GET(new Request("https://editor.example/api/collab/events?site=site", { signal: abort.signal }));
  const reader = response.body!.getReader();
  assert.equal(new TextDecoder().decode((await reader.read()).value), ": connected\n\n");
  for (let i = 0; i < 80; i++) {
    const raw = JSON.stringify({ revision: i });
    h.emit(raw);
    assert.equal(new TextDecoder().decode((await reader.read()).value), `data: ${raw}\n\n`);
  }
  await reader.cancel();
  abort.abort();
  assert.equal(h.unsubscribed(), 1);
});

test("aborting during authorization discards pending output", async () => {
  let finish!: (allowed: boolean) => void;
  const h = handler(() => new Promise<boolean>(resolve => { finish = resolve; }));
  const abort = new AbortController();
  const response = await h.GET(new Request("https://editor.example/api/collab/events?site=site", { signal: abort.signal }));
  const reader = response.body!.getReader();
  h.emit('{"secret":"pending"}');
  abort.abort();
  finish(true);
  assert.deepEqual(await reader.read(), { value: undefined, done: true });
  assert.equal(h.unsubscribed(), 1);
});
});

describe("collab-transport", () => {
class NextResponse extends Response {
  static json(value: unknown, init?: ResponseInit) {
    return new NextResponse(JSON.stringify(value), init);
  }
}

const source = transformSync(readFileSync(new URL("../app/api/status/route.ts", import.meta.url), "utf8"), {
  loader: "ts", format: "cjs", target: "es2022",
}).code;

async function statusWith(db: boolean, room: boolean) {
  let roomChecks = 0;
  const imports: Record<string, unknown> = {
    NextResponse,
    requireAuth: async () => null,
    authConfigured: () => false,
    dbConfigured: () => db,
    collabRoomAvailable: () => { roomChecks++; return room; },
    assetStore: () => null,
    getAccountRole: async () => "editor",
  };
  const module = { exports: {} as Record<string, any> };
  new Function("require", "module", "exports", source)(
    () => new Proxy({}, { get: (_target, key) => typeof key === "string" ? imports[key] : undefined }),
    module, module.exports,
  );
  const response = await module.exports.GET();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  return { body: await response.json(), roomChecks };
}

test("browser-only mode disables collaboration even if a room binding exists", async () => {
  const { body, roomChecks } = await statusWith(false, true);
  assert.equal(body.db, false);
  assert.equal(body.collabTransport, "none");
  assert.equal(roomChecks, 0);
});

test("Node.js and Docker use SSE when server storage exists without Durable Objects", async () => {
  const { body, roomChecks } = await statusWith(true, false);
  assert.equal(body.db, true);
  assert.equal(body.collabTransport, "sse");
  assert.equal(roomChecks, 1);
});

test("Cloudflare Workers use WebSockets when server storage and collaboration rooms exist", async () => {
  const { body, roomChecks } = await statusWith(true, true);
  assert.equal(body.db, true);
  assert.equal(body.collabTransport, "websocket");
  assert.equal(roomChecks, 1);
});
});

describe("merge-asset-deletion", () => {
  before(() => {
    useEditor.setState({
      breakpoint: "base", customWidth: null, styleState: "default", mode: "design",
      pageTheme: "light", selection: null, selectedIds: [], editingComponentId: null, scriptEditor: null,
    });
  });
function fixture(): SiteDoc {
  return {
    schemaVersion: 1, siteName: "Concurrent assets", pageOrder: ["home"],
    pages: { home: { id: "home", name: "Home", slug: "", title: "", description: "", children: ["box"] } },
    nodes: { box: { ...makeBox(), id: "box" } },
    assets: Object.fromEntries(["shared-image", "unused-image"].map(id => [id, {
      id, name: `${id}.png`, mimeType: "image/png", width: 10, height: 10, path: `assets/${id}.png`,
    }])),
  };
}

for (const reverse of [false, true]) {
  test(`concurrent asset reuse survives ${reverse ? "local" : "remote"} deletion without restoring unused assets`, () => {
    const base = fixture();
    const reuse = structuredClone(base);
    reuse.nodes.image = { ...makeImage(), id: "image", image: {
      src: "", alt: "", width: 10, height: 10, assetId: "shared-image",
    } };
    reuse.pages.home.children.push("image");
    const deletion = { ...base, assets: {} };
    const originals = structuredClone([base, reuse, deletion]);
    assert.ok([base, reuse, deletion].every(validSiteDoc));
    const result = reverse ? mergeDocs(base, deletion, reuse) : mergeDocs(base, reuse, deletion);
    assert.ok(validSiteDoc(result), "the merged document must remain saveable");
    assert.equal(result.nodes.image.image?.assetId, "shared-image");
    assert.deepEqual(result.assets, { "shared-image": base.assets["shared-image"] });
    assert.deepEqual([base, reuse, deletion], originals, "merge must not modify history snapshots");
  });
}

test("concurrent site, page, media and secondary source references retain their assets", () => {
  for (const add of [
    (d: SiteDoc) => { d.favicon = { assetId: "shared-image" }; },
    (d: SiteDoc) => { d.appleTouchIcon = { assetId: "shared-image" }; },
    (d: SiteDoc) => { d.ogImage = { assetId: "shared-image" }; },
    (d: SiteDoc) => { d.pwa = { enabled: false, icon: { assetId: "shared-image" } }; },
    (d: SiteDoc) => { d.pages.home.ogImage = { assetId: "shared-image" }; },
    (d: SiteDoc) => { d.nodes.box.media = { kind: "video", src: "", assetId: "shared-image" }; },
    (d: SiteDoc) => { d.nodes.box.media = { kind: "video", src: "", sources: [{ src: "", assetId: "shared-image" }] }; },
  ]) {
    const base = fixture(), local = structuredClone(base);
    add(local);
    assert.ok(validSiteDoc(local));
    const result = mergeDocs(base, local, { ...base, assets: {} });
    assert.ok(validSiteDoc(result));
    assert.deepEqual(Object.keys(result.assets), ["shared-image"]);
  }
});

test("CSS URLs and imported HTML retain deleted assets and their ZIP stylesheet dependencies", () => {
  const base = fixture();
  base.assets.stylesheet = {
    id: "stylesheet", name: "main.css", width: 0, height: 0, mimeType: "text/css",
    zip: { version: 1, group: "import", path: "main.css", stylesheet: {
      source: "body { background: url(image.png) }",
      references: [{ url: "image.png", assetId: "shared-image", suffix: "" }],
    } },
  };
  for (const add of [
    (d: SiteDoc) => { d.nodes.box.styles = { base: { default: { backgroundImage: `url('${assetSrc(base.assets["shared-image"])}#icon')` } } }; },
    (d: SiteDoc) => { d.pages.home.rawHtml = '<link href="tsumu-zip-css:stylesheet">'; },
  ]) {
    const local = structuredClone(base);
    add(local);
    const result = mergeDocs(base, local, { ...base, assets: {} });
    assert.ok(validSiteDoc(result));
    assert.ok(result.assets["shared-image"]);
    assert.equal(result.assets["unused-image"], undefined);
    if (local.pages.home.rawHtml) assert.ok(result.assets.stylesheet);
  }
});

test("asset deletion still wins when neither surviving document references it", () => {
  const base = fixture();
  const local = structuredClone(base);
  local.nodes.box.name = "Unrelated edit";
  const result = mergeDocs(base, local, { ...base, assets: {} });
  assert.deepEqual(result.assets, {});
  assert.equal(result.nodes.box.name, "Unrelated edit");
  assert.ok(validSiteDoc(result));
});

test("Undo before an upload retains an asset newly referenced by a collaborator's node patch", () => {
  const original = fixture();
  original.assets = {};
  useEditor.getState().replaceDoc(original);
  useEditor.getState().updateDoc(doc => { doc.assets = fixture().assets; });
  const base = useEditor.getState().doc;
  const updated = structuredClone(base);
  updated.nodes.box.styles = { base: { default: {
    backgroundImage: `url('${assetSrc(base.assets["shared-image"])}')`,
  } } };
  useEditor.getState().applyRemoteDoc(updated, { baseDoc: base, patch: createDocPatch(base, updated)! });
  useEditor.getState().undo();
  const result = useEditor.getState().doc;
  assert.ok(validSiteDoc(result));
  assert.deepEqual(result.nodes.box.styles, updated.nodes.box.styles);
  assert.deepEqual(Object.keys(result.assets), ["shared-image"]);
});
});

describe("merge-concurrency-integrity", () => {
const SEED = 0x4a202611;
function seeded(seed: number) {
  let value = seed >>> 0;
  return () => {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    return value >>> 0;
  };
}
function fixture(): SiteDoc {
  return {
    schemaVersion: 1, siteName: "Concurrent Site",
    pageOrder: ["home", "about"],
    pages: {
      home: { id: "home", name: "Home", slug: "", title: "", description: "", children: ["a"] },
      about: { id: "about", name: "About", slug: "about", title: "", description: "", children: ["b"] },
    },
    nodes: {
      a: { ...makeBox(), id: "a", name: "A", children: [], text: { content: "A", heading: 0 } },
      b: { ...makeBox(), id: "b", name: "B", children: [], text: { content: "B", heading: 0 } },
    },
    assets: {},
  } as SiteDoc;
}
const changes: ((doc: SiteDoc) => void)[] = [
  // もう一方の利用者が兄弟を動かすかもしれない間に、ページをまたいで移動する。
  doc => { doc.pages.home.children = []; doc.pages.about.children.push("a"); },
  doc => { doc.pages.about.children = []; doc.pages.home.children.push("b"); },
  // 逆向きの祖先の移動は、それぞれは正しいが、マージすると循環になることがある。
  doc => { doc.pages.home.children = []; doc.nodes.b.children = ["a"]; },
  doc => { doc.pages.about.children = []; doc.nodes.a.children = ["b"]; },
  doc => { doc.nodes.a.text = { content: "local update", heading: 0 }; },
  doc => { doc.nodes.b.text = { content: "remote update", heading: 0 }; },
  doc => { doc.pages.home.children = []; delete doc.nodes.a; },
  doc => { doc.pages.about.children = []; delete doc.nodes.b; },
  doc => { delete doc.pages.home; doc.pageOrder = ["about"]; },
  doc => { delete doc.pages.about; doc.pageOrder = ["home"]; },
  doc => {
    doc.nodes.c = { ...doc.nodes.a, id: "c", children: [], text: { content: "new node", heading: 0 } };
    doc.pages.home.children.push("c");
  },
  doc => {
    doc.nodes.d = { ...doc.nodes.b, id: "d", children: [], text: { content: "new node", heading: 0 } };
    doc.pages.about.children.push("d");
  },
];

test("concurrent independent valid edits never produce a cyclic or invalid merged document", () => {
  const next = seeded(SEED ^ 0x1111);
  for (let i = 0; i < 240; i++) {
    const base = fixture();
    const local = structuredClone(base);
    const remote = structuredClone(base);
    const first = next() % changes.length;
    const second = next() % changes.length;
    changes[first](local);
    changes[second](remote);
    assert.doesNotThrow(() => validateImportedDoc(local), "seed=" + SEED + " local=" + first);
    assert.doesNotThrow(() => validateImportedDoc(remote), "seed=" + SEED + " remote=" + second);
    const merged = mergeDocs(base, local, remote);
    assert.equal(merged.pageOrder.length > 0, true,
      "lost the last page; seed=" + SEED + " case=" + i + " ops=" + first + "," + second);
    assert.equal(validNodeForest(merged.pages, merged.nodes, merged.components), true,
      "invalid node forest; seed=" + SEED + " case=" + i + " ops=" + first + "," + second);
    assert.doesNotThrow(() => validateImportedDoc(merged),
      "invalid document; seed=" + SEED + " case=" + i + " ops=" + first + "," + second);
  }
});

test("opposing moves across parent trees cannot introduce a merge-only cycle", () => {
  const base = fixture();
  const local = structuredClone(base);
  const remote = structuredClone(base);
  changes[2](local);
  changes[3](remote);
  assert.doesNotThrow(() => validateImportedDoc(local));
  assert.doesNotThrow(() => validateImportedDoc(remote));
  const merged = mergeDocs(base, local, remote);
  assert.equal(validNodeForest(merged.pages, merged.nodes, merged.components), true);
  assert.doesNotThrow(() => validateImportedDoc(merged));
});
});

describe("merge-deletion", () => {
  before(() => {
    useEditor.setState({
      breakpoint: "base", customWidth: null, styleState: "default", mode: "design",
      pageTheme: "light", selection: null, selectedIds: [], editingComponentId: null, scriptEditor: null,
    });
  });
function fixture(): SiteDoc {
  return {
    siteName: "Test", assets: {},
    pages: {
      p: { id: "p", name: "Home", slug: "", title: "", description: "", children: ["a", "outside"] },
      q: { id: "q", name: "Other", slug: "other", title: "", description: "", children: [] },
    },
    pageOrder: ["p", "q"],
    nodes: {
      a: { ...makeBox(), id: "a", children: ["b", "sibling"] },
      b: { ...makeBox(), id: "b", children: ["leaf"] },
      leaf: { ...makeBox(), id: "leaf", text: { content: "Original", heading: 0 } },
      sibling: { ...makeBox(), id: "sibling" },
      outside: { ...makeBox(), id: "outside" },
    },
  };
}

function deleted(base: SiteDoc, id: string): SiteDoc {
  useEditor.setState({ doc: structuredClone(base), activePageId: "p", past: [], future: [], editingComponentId: null });
  useEditor.getState().deleteNode(id);
  return structuredClone(useEditor.getState().doc);
}
function edited(base: SiteDoc): SiteDoc {
  const local = structuredClone(base);
  local.nodes.leaf.text!.content = "Unsaved edit";
  return local;
}
function assertTree(doc: SiteDoc) {
  const all = [...Object.values(doc.pages), ...Object.values(doc.nodes)];
  const owners = new Map<string, string>();
  for (const item of all) for (const child of item.children) {
    assert.ok(doc.nodes[child], "missing child " + child);
    assert.ok(!owners.has(child), "multiple parents for " + child);
    owners.set(child, item.id);
  }
  const walk = (id: string, ancestors: Set<string>) => {
    assert.ok(!ancestors.has(id), "cycle at " + id);
    for (const child of doc.nodes[id]?.children ?? []) walk(child, new Set([...ancestors, id]));
  };
  for (const id of Object.keys(doc.nodes)) walk(id, new Set());
}

for (const target of ["leaf", "b", "a"]) {
  test("local edit survives remote deletion of " + target + " with its necessary ancestors", () => {
    const base = fixture();
    const local = edited(base);
    const remote = deleted(base, target);
    const originals = structuredClone([base, local, remote]);
    const merged = mergeDocs(base, local, remote);
    assert.deepEqual(merged.pages.p.children, ["a", "outside"]);
    assert.deepEqual(merged.nodes.a.children, target === "a" ? ["b"] : ["b", "sibling"]);
    assert.deepEqual(merged.nodes.b.children, ["leaf"]);
    assert.equal(merged.nodes.leaf.text!.content, "Unsaved edit");
    if (target === "a") assert.equal(merged.nodes.sibling, undefined);
    assert.deepEqual([base, local, remote], originals);
    assertTree(merged);
  });

  test("local deletion of " + target + " wins over the remote descendant edit", () => {
    const base = fixture();
    const merged = mergeDocs(base, deleted(base, target), edited(base));
    assert.equal(merged.nodes[target], undefined);
    assert.equal(merged.nodes.leaf, undefined);
    assertTree(merged);
  });
}

test("deletion alone does not restore an unchanged subtree", () => {
  const base = fixture();
  const remote = deleted(base, "a");
  const merged = mergeDocs(base, structuredClone(base), remote);
  assert.deepEqual(merged.pages.p.children, ["outside"]);
  assert.deepEqual(Object.keys(merged.nodes), ["outside"]);
  assertTree(merged);
});

test("editing a descendant of a deleted page restores only its necessary tree", () => {
  const base = fixture();
  useEditor.setState({ doc: structuredClone(base), activePageId: "p", past: [], future: [] });
  useEditor.getState().deletePage("p");
  const remote = structuredClone(useEditor.getState().doc);
  const merged = mergeDocs(base, edited(base), remote);
  assert.ok(merged.pageOrder.includes("p"));
  assert.deepEqual(merged.pages.p.children, ["a"]);
  assert.deepEqual(merged.nodes.a.children, ["b"]);
  assert.equal(merged.nodes.sibling, undefined);
  assert.equal(merged.nodes.outside, undefined);
  assert.equal(merged.nodes.leaf.text!.content, "Unsaved edit");
  assertTree(merged);
});

function componentFixture(): SiteDoc {
  const base = fixture();
  base.pages.p.children = ["instance", "outside"];
  base.components = { card: { id: "card", name: "Card", rootId: "a" } };
  base.nodes.instance = { ...makeBox(), id: "instance", type: "instance", componentId: "card", styles: {} };
  return base;
}
function deleteComponent(base: SiteDoc): SiteDoc {
  useEditor.setState({ doc: structuredClone(base), activePageId: "p", past: [], future: [] });
  useEditor.getState().deleteComponent("card");
  return structuredClone(useEditor.getState().doc);
}

test("edited master descendants remain reachable through the restored component definition", () => {
  const base = componentFixture();
  const merged = mergeDocs(base, edited(base), deleteComponent(base));
  assert.equal(merged.components!.card.rootId, "a");
  assert.deepEqual(merged.nodes.a.children, ["b"]);
  assert.deepEqual(merged.nodes.b.children, ["leaf"]);
  assert.equal(merged.nodes.leaf.text!.content, "Unsaved edit");
  assert.equal(merged.nodes.instance, undefined);
  assert.equal(merged.nodes.sibling, undefined);
  assertTree(merged);
});

test("an edited instance keeps the master required to render it", () => {
  const base = componentFixture();
  const local = structuredClone(base);
  local.nodes.instance.hiddenOn = ["sm"];
  const merged = mergeDocs(base, local, deleteComponent(base));
  assert.deepEqual(merged.pages.p.children, ["instance", "outside"]);
  assert.deepEqual(merged.nodes.instance.hiddenOn, ["sm"]);
  assert.equal(merged.components!.card.rootId, "a");
  assert.deepEqual(merged.nodes.a.children, ["b", "sibling"]);
  assert.equal(merged.nodes.leaf.text!.content, "Original");
  assertTree(merged);
});

test("local component deletion still wins over a remote master edit", () => {
  const base = componentFixture();
  const merged = mergeDocs(base, deleteComponent(base), edited(base));
  assert.equal(merged.components!.card, undefined);
  assert.equal(merged.nodes.a, undefined);
  assert.equal(merged.nodes.leaf, undefined);
  assert.deepEqual(merged.pages.p.children, ["outside"]);
  assertTree(merged);
});

test("restoring ancestor paths does not interfere with conflicting move cycle repair", () => {
  const base = fixture();
  base.pages.p.children.push("other");
  base.nodes.other = { ...makeBox(), id: "other" };
  const local = edited(base);
  local.pages.p.children = ["a", "outside"];
  local.nodes.a.children.push("other");
  const remote = deleted(base, "b");
  remote.pages.p.children = ["outside", "other"];
  remote.nodes.other.children = ["a"];
  const merged = mergeDocs(base, local, remote);
  assert.equal(merged.nodes.leaf.text!.content, "Unsaved edit");
  assert.ok(merged.nodes.a.children.includes("b"));
  assert.deepEqual(merged.nodes.b.children, ["leaf"]);
  assertTree(merged);
});

test("an existing ancestor follows its remote move without restoring its old deleted page", () => {
  const base = fixture();
  const local = edited(base);
  const remote = deleted(base, "b");
  remote.pages.q.children = ["a"];
  remote.pages.p.children = [];
  delete remote.pages.p;
  remote.pageOrder = ["q"];
  delete remote.nodes.outside;
  const merged = mergeDocs(base, local, remote);
  assert.equal(merged.pages.p, undefined);
  assert.deepEqual(merged.pageOrder, ["q"]);
  assert.deepEqual(merged.pages.q.children, ["a"]);
  assert.deepEqual(merged.nodes.a.children, ["b", "sibling"]);
  assert.deepEqual(merged.nodes.b.children, ["leaf"]);
  assert.equal(merged.nodes.leaf.text!.content, "Unsaved edit");
  assertTree(merged);
});

test("a local addition inside a deleted subtree remains attached without restoring old siblings", () => {
  const base = fixture();
  const local = structuredClone(base);
  local.nodes.b.children.push("new");
  local.nodes.new = { ...makeBox(), id: "new" };
  const merged = mergeDocs(base, local, deleted(base, "a"));
  assert.deepEqual(merged.pages.p.children, ["a", "outside"]);
  assert.deepEqual(merged.nodes.a.children, ["b"]);
  assert.deepEqual(merged.nodes.b.children, ["new"]);
  assert.equal(merged.nodes.leaf, undefined);
  assert.equal(merged.nodes.sibling, undefined);
  assertTree(merged);
});

test("local component metadata edits preserve the required root and honor locally deleted children", () => {
  const base = componentFixture();
  const local = structuredClone(base);
  local.components!.card.name = "Renamed";
  delete local.nodes.sibling;
  local.nodes.a.children = ["b"];
  const merged = mergeDocs(base, local, deleteComponent(base));
  assert.equal(merged.components!.card.name, "Renamed");
  assert.deepEqual(merged.nodes.a.children, ["b"]);
  assert.equal(merged.nodes.sibling, undefined);
  assert.equal(merged.nodes.leaf.text!.content, "Original");
  assertTree(merged);
});

function move(base: SiteDoc, id: string, parent: string): SiteDoc {
  useEditor.setState({ doc: structuredClone(base), activePageId: "p", past: [], future: [], editingComponentId: null });
  useEditor.getState().moveNode(id, { kind: "node", id: parent }, 0);
  return structuredClone(useEditor.getState().doc);
}

test("a move-only local leaf edit survives remote deletion at its new parent", () => {
  const base = fixture();
  const local = move(base, "leaf", "outside");
  assert.deepEqual(local.nodes.leaf, base.nodes.leaf, "a move changes only parent child lists");
  const remote = deleted(base, "leaf");
  const originals = structuredClone([base, local, remote]);
  const merged = mergeDocs(base, local, remote);
  assert.deepEqual(merged.nodes.outside.children, ["leaf"]);
  assert.deepEqual(merged.nodes.b.children, []);
  assert.deepEqual(merged.nodes.leaf, base.nodes.leaf);
  assert.deepEqual([base, local, remote], originals);
  assertTree(merged);
});

test("moving a subtree preserves its unchanged contents after remote subtree deletion", () => {
  const base = fixture();
  const local = move(base, "b", "outside");
  const merged = mergeDocs(base, local, deleted(base, "a"));
  assert.deepEqual(merged.pages.p.children, ["outside"]);
  assert.equal(merged.nodes.a, undefined, "the emptied source parent stays deleted");
  assert.deepEqual(merged.nodes.outside.children, ["b"]);
  assert.deepEqual(merged.nodes.b.children, ["leaf"]);
  assert.equal(merged.nodes.leaf.text!.content, "Original");
  assert.equal(merged.nodes.sibling, undefined);
  assertTree(merged);
});

test("local deletion wins over a move-only remote edit", () => {
  const base = fixture();
  const merged = mergeDocs(base, deleted(base, "b"), move(base, "b", "outside"));
  assert.equal(merged.nodes.b, undefined);
  assert.equal(merged.nodes.leaf, undefined);
  assert.deepEqual(merged.nodes.outside.children, []);
  assertTree(merged);
});

test("restoring moved contents does not bring back locally deleted descendants", () => {
  const base = fixture();
  base.nodes.b.children.push("removed");
  base.nodes.removed = { ...makeBox(), id: "removed" };
  const local = move(deleted(base, "removed"), "b", "outside");
  const merged = mergeDocs(base, local, deleted(base, "b"));
  assert.deepEqual(merged.nodes.outside.children, ["b"]);
  assert.deepEqual(merged.nodes.b.children, ["leaf"]);
  assert.equal(merged.nodes.removed, undefined);
  assertTree(merged);
});

test("an untouched node is not resurrected merely because its sibling was moved", () => {
  const base = fixture();
  const local = move(base, "sibling", "outside");
  const merged = mergeDocs(base, local, deleted(base, "b"));
  assert.equal(merged.nodes.b, undefined);
  assert.equal(merged.nodes.leaf, undefined);
  assert.deepEqual(merged.nodes.outside.children, ["sibling"]);
  assertTree(merged);
});

test("local child deletion does not resurrect its remotely deleted empty parent", () => {
  const base = fixture();
  const local = deleted(base, "leaf");
  const merged = mergeDocs(base, local, deleted(base, "b"));
  assert.equal(merged.nodes.b, undefined);
  assert.equal(merged.nodes.leaf, undefined);
  assert.deepEqual(merged.nodes.a.children, ["sibling"]);
  assertTree(merged);
});

test("local child removals do not restore a remotely deleted page", () => {
  const base = fixture();
  const local = deleted(deleted(base, "a"), "outside");
  useEditor.setState({ doc: structuredClone(base), activePageId: "p", past: [], future: [] });
  useEditor.getState().deletePage("p");
  const merged = mergeDocs(base, local, structuredClone(useEditor.getState().doc));
  assert.equal(merged.pages.p, undefined);
  assert.deepEqual(merged.pageOrder, ["q"]);
  assert.deepEqual(merged.nodes, {});
  assertTree(merged);
});

test("removal-only ancestors are restored when a surviving descendant actually needs them", () => {
  const base = fixture();
  const local = edited(deleted(base, "sibling"));
  const merged = mergeDocs(base, local, deleted(base, "a"));
  assert.deepEqual(merged.pages.p.children, ["a", "outside"]);
  assert.deepEqual(merged.nodes.a.children, ["b"]);
  assert.deepEqual(merged.nodes.b.children, ["leaf"]);
  assert.equal(merged.nodes.leaf.text!.content, "Unsaved edit");
  assert.equal(merged.nodes.sibling, undefined);
  assertTree(merged);
});

test("a real parent property edit survives even when its children were also removed", () => {
  const base = fixture();
  const local = deleted(base, "leaf");
  local.nodes.b.name = "Renamed";
  const merged = mergeDocs(base, local, deleted(base, "b"));
  assert.equal(merged.nodes.b.name, "Renamed");
  assert.deepEqual(merged.nodes.b.children, []);
  assert.ok(merged.nodes.a.children.includes("b"));
  assertTree(merged);
});

test("remote additions keep their relative order around locally reordered siblings", () => {
  const base = fixture();
  const local = structuredClone(base);
  local.pages.p.children.reverse();
  const remote = structuredClone(base);
  for (const id of ["leading", "first", "second", "trailing"]) {
    remote.nodes[id] = { ...makeBox(), id };
  }
  remote.pages.p.children = ["leading", "a", "first", "second", "outside", "trailing"];
  const merged = mergeDocs(base, local, remote);
  assert.deepEqual(merged.pages.p.children, ["first", "second", "outside", "leading", "a", "trailing"]);
  assertTree(merged);
});
});

describe("merge-new-properties", () => {
function fixture(): SiteDoc {
  return {
    siteName: "Merge", assets: {}, pageOrder: ["p"],
    pages: { p: { id: "p", name: "Home", slug: "", children: ["a"] } },
    nodes: { a: { ...makeBox(), id: "a", styles: {} } },
  };
}

test("concurrent first edits to a style state preserve independent properties", () => {
  const base = fixture(), local = structuredClone(base), remote = structuredClone(base);
  local.nodes.a.styles = { base: { hover: { color: "red" } } };
  remote.nodes.a.styles = { base: { hover: { backgroundColor: "blue" } } };
  const snapshots = structuredClone([base, local, remote]);
  assert.deepEqual(mergeDocs(base, local, remote).nodes.a.styles, {
    base: { hover: { color: "red", backgroundColor: "blue" } },
  });
  assert.deepEqual([base, local, remote], snapshots);
});

test("new nested settings retain both editors' independent changes and local conflicts", () => {
  const base = fixture(), local = structuredClone(base), remote = structuredClone(base);
  local.nodes.a.styles = { base: { hover: { color: "red" } } };
  remote.nodes.a.styles = { base: { hover: { color: "blue", opacity: "0.5" } } };
  assert.deepEqual(mergeDocs(base, local, remote).nodes.a.styles.base?.hover, { color: "red", opacity: "0.5" });
});

test("explicit null and scalar replacements keep local conflict precedence", () => {
  for (const original of [null, "old"]) {
    const base = fixture(), local = structuredClone(base), remote = structuredClone(base);
    Object.assign(base, { customSetting: original });
    Object.assign(local, { customSetting: { a: 1 } });
    Object.assign(remote, { customSetting: { b: 2 } });
    assert.deepEqual((mergeDocs(base, local, remote) as any).customSetting, { a: 1 });
  }
});

test("concurrent new collection IDs do not merge unrelated entities", () => {
  const base = fixture(), local = structuredClone(base), remote = structuredClone(base);
  local.nodes.fresh = { ...makeBox(), id: "fresh", name: "Local", styles: { base: { default: { color: "red" } } } };
  remote.nodes.fresh = { ...makeBox(), id: "fresh", name: "Remote", styles: { base: { default: { backgroundColor: "blue" } } } };
  local.pages.p.children.push("fresh");
  remote.pages.p.children.push("fresh");
  assert.deepEqual(mergeDocs(base, local, remote).nodes.fresh, local.nodes.fresh);
});

test("new optional site settings are merged by property", () => {
  const base = fixture(), local = structuredClone(base), remote = structuredClone(base);
  Object.assign(local, { customSetting: { a: 1 } });
  Object.assign(remote, { customSetting: { b: 2 } });
  assert.deepEqual((mergeDocs(base, local, remote) as any).customSetting, { a: 1, b: 2 });
});

function pwaFixture(): SiteDoc {
  return {
    schemaVersion: 1, siteName: "Merge",
    pages: { home: { id: "home", name: "Home", slug: "", title: "", description: "", children: [] } },
    pageOrder: ["home"], nodes: {}, assets: {},
    pwa: { enabled: true, name: "Initial" },
  };
}

test("concurrent settings preserve explicit null added beside a remote edit", () => {
  const base = pwaFixture(), local = structuredClone(base), remote = structuredClone(base);
  local.pwa!.icon = null;
  remote.pwa!.name = "Remote";
  const merged = mergeDocs(base, local, remote);
  assert.equal(merged.pwa!.name, "Remote");
  assert.ok(Object.hasOwn(merged.pwa!, "icon"));
  assert.equal(merged.pwa!.icon, null);
  assert.equal(base.pwa!.icon, undefined);
});

test("removing a null property is not mistaken for leaving it unchanged", () => {
  const base = pwaFixture(), local = structuredClone(base), remote = structuredClone(base);
  base.pwa!.icon = null;
  local.pwa!.icon = null;
  remote.pwa!.icon = null;
  delete local.pwa!.icon;
  remote.pwa!.name = "Remote";
  const merged = mergeDocs(base, local, remote);
  assert.equal(merged.pwa!.name, "Remote");
  assert.equal(Object.hasOwn(merged.pwa!, "icon"), false);
});

test("remote null and independent local properties survive three-way merge", () => {
  const base = pwaFixture(), local = structuredClone(base), remote = structuredClone(base);
  remote.pwa!.icon = null;
  local.pwa!.name = "Local";
  const merged = mergeDocs(base, local, remote);
  assert.equal(merged.pwa!.name, "Local");
  assert.equal(merged.pwa!.icon, null);
});

test("merging nested arbitrary JSON keys never changes object prototypes", () => {
  const base = pwaFixture() as SiteDoc & { customData: Record<string, unknown> };
  base.customData = JSON.parse('{"__proto__":{"base":true},"value":"base"}');
  const local = structuredClone(base), remote = structuredClone(base);
  local.customData.value = "local";
  remote.customData = JSON.parse('{"__proto__":{"remote":true},"value":"base"}');
  const merged = mergeDocs(base, local, remote) as typeof base;
  assert.equal(Object.getPrototypeOf(merged.customData), Object.prototype);
  assert.deepEqual(Object.keys(merged.customData).sort(), ["__proto__", "value"]);
  assert.deepEqual(Object.getOwnPropertyDescriptor(merged.customData, "__proto__")?.value, { remote: true });
  assert.equal(({} as { remote?: boolean }).remote, undefined);
  assert.equal(merged.customData.value, "local");
});
});

describe("merge-structural-limits", () => {
function empty(): SiteDoc {
  return { schemaVersion: 1, siteName: "Test", assets: {}, nodes: {}, pages: { p: { id: "p", name: "Home", slug: "", title: "", description: "", children: [] } }, pageOrder: ["p"] };
}
function node(id: string, children: string[] = []) { return { ...makeBox(), id, children }; }
function assertValid(doc: SiteDoc) { assert.equal(validateDocValue(doc), null); }
function componentFixture() {
  const base = empty();
  base.nodes = { a: node("a"), b: node("b") };
  base.components = { A: { id: "A", name: "A", rootId: "a" }, B: { id: "B", name: "B", rootId: "b" } };
  return base;
}
function nested(id: string, componentId: string) { return { ...node(id), type: "instance" as const, componentId }; }

test("concurrent legal move and addition cannot merge into an unsavable depth", () => {
  const base = empty(); base.pages.p.children = ["a0", "b0"];
  for (const prefix of ["a", "b"]) for (let i = 0; i < 128; i++) base.nodes[prefix + i] = node(prefix + i, i < 127 ? [prefix + (i + 1)] : []);
  const local = structuredClone(base), remote = structuredClone(base);
  local.pages.p.children = ["b0"]; local.nodes.b127.children = ["a0"];
  remote.nodes.added = node("added"); remote.nodes.a127.children = ["added"];
  for (const doc of [base, local, remote]) assertValid(doc);
  const snapshots = JSON.stringify([base, local, remote]);
  const merged = mergeDocs(base, local, remote);
  assertValid(merged);
  assert.equal(Object.keys(merged.nodes).length, 257);
  assert.deepEqual(merged.nodes.a127.children, ["added"]);
  assert.ok(merged.pages.p.children.includes("a0"), "fall back to the original parent instead of dropping the addition");
  assert.equal(JSON.stringify([base, local, remote]), snapshots);
});

test("mutual concurrent component insertions retain local nesting and rescue the remote instance", () => {
  const base = componentFixture(), local = structuredClone(base), remote = structuredClone(base);
  local.nodes.ab = nested("ab", "B"); local.nodes.a.children = ["ab"];
  remote.nodes.ba = nested("ba", "A"); remote.nodes.b.children = ["ba"];
  const snapshots = JSON.stringify([base, local, remote]);
  const merged = mergeDocs(base, local, remote);
  assertValid(merged);
  assert.deepEqual(merged.nodes.a.children, ["ab"]);
  assert.deepEqual(merged.nodes.b.children, []);
  assert.deepEqual(merged.pages.p.children, ["ba"]);
  assert.equal(merged.nodes.ba.componentId, "A");
  assert.deepEqual(merged.components, base.components);
  assert.equal(JSON.stringify([base, local, remote]), snapshots);
});

test("component cycle repair prefers an original placement to a new page-root placement", () => {
  const base = componentFixture(); base.nodes.outside = node("outside", ["ba"]); base.pages.p.children = ["outside"];
  base.nodes.ba = nested("ba", "A");
  const local = structuredClone(base), remote = structuredClone(base);
  local.nodes.ab = nested("ab", "B"); local.nodes.a.children = ["ab"];
  remote.nodes.outside.children = []; remote.nodes.b.children = ["ba"];
  const merged = mergeDocs(base, local, remote);
  assert.deepEqual(merged.nodes.outside.children, ["ba"]);
  assert.deepEqual(merged.nodes.b.children, []);
  assert.deepEqual(merged.nodes.a.children, ["ab"]);
  assertValid(merged);
});

test("noncyclic independent nested instances keep their intended master placements", () => {
  const base = componentFixture(); base.nodes.c = node("c"); base.components!.C = { id: "C", name: "C", rootId: "c" };
  const local = structuredClone(base), remote = structuredClone(base);
  local.nodes.ab = nested("ab", "B"); local.nodes.a.children = ["ab"];
  remote.nodes.bc = nested("bc", "C"); remote.nodes.b.children = ["bc"];
  const merged = mergeDocs(base, local, remote);
  assert.deepEqual(merged.nodes.a.children, ["ab"]); assert.deepEqual(merged.nodes.b.children, ["bc"]);
  assert.deepEqual(merged.pages.p.children, []); assertValid(merged);
});

test("a long acyclic component chain is merged without recursive traversal or reparenting", () => {
  const base = empty(); base.components = {};
  for (let i = 0; i < 12000; i++) {
    const root = `r${i}`, instance = `i${i}`;
    base.components[`c${i}`] = { id: `c${i}`, name: `C${i}`, rootId: root };
    base.nodes[root] = node(root, i < 11999 ? [instance] : []);
    if (i < 11999) base.nodes[instance] = nested(instance, `c${i + 1}`);
  }
  const merged = mergeDocs(base, base, { ...base, siteName: "Remote rename" });
  assert.equal(merged.siteName, "Remote rename");
  assert.deepEqual(merged.nodes, base.nodes);
  assert.deepEqual(merged.pages.p.children, []);
});

test("detached nodes remain detached during an ordinary merge", () => {
  const base = empty(); base.nodes.loose = node("loose", ["child"]); base.nodes.child = node("child");
  const merged = mergeDocs(base, base, { ...base, siteName: "Remote rename" });
  assert.deepEqual(merged.pages.p.children, []);
  assert.deepEqual(merged.nodes, base.nodes);
});

test("independent component cycles each retain their own original non-root placement", () => {
  const base = componentFixture();
  base.nodes.c = node("c"); base.nodes.d = node("d");
  base.components!.C = { id: "C", name: "C", rootId: "c" }; base.components!.D = { id: "D", name: "D", rootId: "d" };
  base.nodes.outside = node("outside", ["ba", "dc"]); base.pages.p.children = ["outside"];
  base.nodes.ba = nested("ba", "A"); base.nodes.dc = nested("dc", "C");
  const local = structuredClone(base), remote = structuredClone(base);
  local.nodes.ab = nested("ab", "B"); local.nodes.a.children = ["ab"];
  local.nodes.cd = nested("cd", "D"); local.nodes.c.children = ["cd"];
  remote.nodes.outside.children = []; remote.nodes.b.children = ["ba"]; remote.nodes.d.children = ["dc"];
  const merged = mergeDocs(base, local, remote);
  assert.deepEqual(merged.nodes.outside.children, ["ba", "dc"]);
  assert.deepEqual(merged.pages.p.children, ["outside"]);
  assert.deepEqual(merged.nodes.a.children, ["ab"]); assert.deepEqual(merged.nodes.c.children, ["cd"]);
  assert.deepEqual(merged.nodes.b.children, []); assert.deepEqual(merged.nodes.d.children, []);
  assertValid(merged);
});

test("repairing a master-root reference does not erase it because an unrelated cycle remains", () => {
  const base = empty(); base.components = {};
  for (const id of ["A", "B", "C", "D", "E", "F"]) { base.components[id] = { id, name: id, rootId: id }; base.nodes[id] = node(id); }
  base.nodes.A = nested("A", "C"); base.nodes.D = nested("D", "F");
  const local = structuredClone(base), remote = structuredClone(base);
  local.nodes.ba = nested("ba", "A"); local.nodes.B.children = ["ba"];
  local.nodes.ed = nested("ed", "D"); local.nodes.E.children = ["ed"];
  remote.nodes.A.componentId = "B"; remote.nodes.D.componentId = "E";
  const merged = mergeDocs(base, local, remote);
  assert.equal(merged.nodes.A.componentId, "C");
  assert.equal(merged.nodes.D.componentId, "F");
  assert.deepEqual(merged.nodes.B.children, ["ba"]); assert.deepEqual(merged.nodes.E.children, ["ed"]);
  assertValid(merged);
});
});
