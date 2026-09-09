import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { CLOUD_SAVE_DEBOUNCE_MS, scheduleCloudSave, sendCloudDoc, type CloudAutosave } from "../lib/cloud-save";
import { applyDocPatch } from "../lib/doc-patch";
import { validSiteDoc } from "../lib/doc-tree";
import { createInitialDoc } from "../lib/presets";
import { useEditor } from "../lib/store";
import type { CollabServerMessage } from "../lib/collab";

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
      skipNextCloudSave: ref(false), cloudTimer: ref(null),
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
          // 自分の保存確定後、別の編集者が独立した変更を加える。
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
    scope.retrySaveAfterEdit.current = false; // Editor の blur 購読と同じ通知。
    assert.equal(unsynced, true);
    assert.equal(validSiteDoc(useEditor.getState().doc), true);
    // 確定を待つ間に、別の編集者がさらに保存しても最新の競合を解決する。
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
    skipNextCloudSave: ref(false), cloudTimer: ref(null), activeCloudSave: ref(null),
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
      skipNextCloudSave: ref(false), cloudTimer: ref(null), activeCloudSave: ref(null),
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
