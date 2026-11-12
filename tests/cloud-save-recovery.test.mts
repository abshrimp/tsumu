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
