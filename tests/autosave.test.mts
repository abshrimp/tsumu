import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { CLOUD_SAVE_DEBOUNCE_MS, scheduleCloudSave, sendCloudDoc } from "../lib/cloud-save";
import { createDocPatch } from "../lib/doc-patch";
import { createInitialDoc } from "../lib/presets";

// 実際の自動保存処理を動かし、通信とタイマーの完了順を制御する。
const ref = <T,>(current: T) => ({ current });
afterEach(() => mock.reset());

function harness() {
  mock.timers.enable({ apis: ["setTimeout"] });
  const original = { title: "original" };
  const state = { doc: { title: "first edit" }, cloudState: "synced", editingText: null,
    setCloud(value: string) { this.cloudState = value; } };
  const requests: { doc: object; base: string; resolve: (result: any) => void }[] = [];
  let retries = 0;
  let unsynced = false;
  const scope = {
    observedDoc: ref(original), cloudReady: ref(true), cloudDirty: ref(false),
    skipNextCloudSave: ref(false), cloudTimer: ref<any>(null),
    activeCloudSave: ref<Promise<void> | null>(null), cloudSaveQueued: ref(false),
    lastSyncedRev: ref("1"), lastSyncedDoc: ref<object>(original), retrySaveAfterEdit: ref(false),
    getState: () => state,
    setUnsyncedFlag: (value: boolean) => { unsynced = value; },
    requestRetry: () => { retries++; },
    saveCloudDoc: (doc: object, base: string) => new Promise((resolve) => requests.push({ doc, base, resolve })),
  };
  const effect = () => scheduleCloudSave(scope as any, state.doc as any);
  const tick = () => mock.timers.tick(CLOUD_SAVE_DEBOUNCE_MS);
  return { state, scope, effect, tick, requests, retries: () => retries, unsynced: () => unsynced };
}

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

test("initial sync failure continues to block autosave", () => {
  const h = harness();
  h.scope.cloudReady.current = false;
  h.effect(); h.tick();
  assert.equal(h.requests.length, 0);
  assert.equal(h.unsynced(), true);
});

function transport(connected: boolean, supported = true, httpStatus = 200) {
  const messages: any[] = [];
  const requests: { url: string; method: string; body: any }[] = [];
  const scope = {
    deltaSupported: ref(supported), collabSocket: ref(connected ? { readyState: WebSocket.OPEN } : null),
    clientId: "client1", savedAt: () => 10,
    requestViaWebSocket: async (message: any) => { messages.push(message); return { type: "saved", rev: "2", savedAt: 20 } as any; },
  };
  mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    requests.push({ url, method: init.method!, body: JSON.parse(String(init.body)) });
    return Response.json({ rev: "2", savedAt: 20 }, { status: requests.length === 1 ? httpStatus : 200 });
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

test("new sites and old servers continue using revision-protected full saves", async () => {
  const base = createInitialDoc();
  const next = { ...base, siteName: "New name" };
  const old = transport(true, false);
  await old.save(next, "1", base);
  assert.deepEqual(old.messages[0], { type: "save", base: "1", doc: next });
  const fresh = transport(true);
  await fresh.save(base, null);
  assert.deepEqual(fresh.messages[0], { type: "save", base: null, doc: base });
  const mixed = transport(false, true, 405);
  await mixed.save(next, "1", base);
  assert.deepEqual(mixed.requests.map((r) => r.method), ["PATCH", "PUT"]);
  assert.deepEqual(mixed.requests[1].body, next);
  assert.ok(mixed.requests[1].url.includes("base=1"));
  assert.equal(mixed.scope.deltaSupported.current, false);
});
