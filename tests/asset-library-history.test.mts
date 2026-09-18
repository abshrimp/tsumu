import assert from "node:assert/strict";
import { test } from "node:test";
import { useEditor } from "../lib/store";
import { assetSrc, replaceEmbeddedAsset } from "../lib/assets";
import type { Asset, SiteDoc } from "../lib/types";
import { assetLibraryCallbacks, assetLibraryDoc } from "./helpers/asset-library";
import { elements } from "./helpers/pending-import";

const state = () => useEditor.getState();
const tick = () => new Promise((resolve) => setImmediate(resolve));
const uploaded: Asset = { id: "uploaded", name: "new.wav", path: "assets/new.wav", mimeType: "audio/wav", width: 0, height: 0 };
const retain = (doc: SiteDoc, asset = uploaded) => ({ ...doc, assets: { ...doc.assets, [asset.id]: asset } });
function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function setup(upload?: (file: File) => Promise<Asset>, migrate?: (asset: Asset) => Promise<string | null>) {
  state().endGesture(); state().replaceDoc(assetLibraryDoc()); state().setActivePage("p"); state().select("a");
  const ui = assetLibraryCallbacks(upload, migrate);
  const render = () => elements(ui.render());
  const add = (count = 1) => render().find((e) => e.type === "input" && e.props.type === "file").props.onChange({ target: { files: Array.from({ length: count }, () => new File(["audio"], "new.wav", { type: "audio/wav" })), value: "new.wav" } });
  const move = () => render().find((e) => e.props?.["data-tip"] === "Upload to server").props.onClick();
  const busy = () => render().find((e) => e.props?.["data-tutorial"] === "asset-upload").props.disabled;
  render();
  return { ui, render, add, move, busy };
}

for (const boundary of ["undo", "undo-redo", "replace", "restore", "reset"]) {
  test(`library uploads preserve document/history across ${boundary}`, async () => {
    const work = deferred<Asset>(); const f = setup(() => work.promise);
    try {
      state().updateNode("a", { name: "Important edit" }); f.add();
      if (boundary.startsWith("undo")) state().undo();
      if (boundary === "undo-redo") state().redo();
      if (boundary === "replace") state().replaceDoc(structuredClone(state().doc));
      if (boundary === "restore") state().restoreDoc({ ...structuredClone(state().doc), siteName: "Restored" });
      if (boundary === "reset") state().resetDoc();
      const before = state(); work.resolve(uploaded); await tick();
      assert.deepEqual(state().doc, retain(before.doc));
      assert.deepEqual(state().past, before.past.map((d) => retain(d)));
      assert.deepEqual(state().future, before.future.map((d) => retain(d)));
      assert.equal(state().historyRevision, before.historyRevision);
      for (let n = 0; n < 2; n++) {
        if (before.future.length) { state().redo(); assert.deepEqual(state().doc, retain(before.future[0])); state().undo(); }
        else if (before.past.length) { state().undo(); assert.deepEqual(state().doc, retain(before.past.at(-1)!)); state().redo(); }
        assert.deepEqual(state().doc, retain(before.doc));
      }
    } finally { f.ui.unmount(); }
  });
}

test("uninterrupted uploads preserve edits and remain undoable after page navigation or closing the tab", async () => {
  for (const close of [false, true]) {
    const work = deferred<Asset>(); const f = setup(() => work.promise);
    try {
      f.add(); state().updateNode("a", { name: "Unrelated edit" }); state().setActivePage("q");
      if (close) f.ui.unmount();
      const before = structuredClone(state().doc); work.resolve(uploaded); await tick();
      assert.deepEqual(state().doc, retain(before)); assert.equal(state().activePageId, "q");
      state().undo(); assert.deepEqual(state().doc, before);
      state().redo(); assert.deepEqual(state().doc, retain(before));
    } finally { f.ui.unmount(); }
  }
});

test("Undo between batch completions keeps the remaining uploaded files and the first file's Redo", async () => {
  const first = deferred<Asset>(); const second = deferred<Asset>(); let calls = 0;
  const f = setup(() => ++calls === 1 ? first.promise : second.promise);
  try {
    f.add(2); first.resolve(uploaded); await tick(); assert.equal(calls, 2);
    state().undo(); const before = state();
    const later = { ...uploaded, id: "later", name: "later.wav" }; second.resolve(later); await tick();
    assert.deepEqual(state().doc, retain(before.doc, later)); assert.equal(state().future.length, 1);
    state().redo(); assert.deepEqual(state().doc.assets, { ...assetLibraryDoc().assets, uploaded, later });
    state().undo(); assert.equal(state().doc.assets.uploaded, undefined); assert.deepEqual(state().doc.assets.later, later);
  } finally { f.ui.unmount(); }
});

test("overlapping drops remain busy until all complete and old errors cannot overwrite a newer request", async () => {
  for (const rejectOld of [false, true]) {
    const first = deferred<Asset>(); const second = deferred<Asset>(); let calls = 0;
    const f = setup(() => ++calls === 1 ? first.promise : second.promise);
    try {
      f.add(); f.add(); second.resolve(uploaded); await tick(); assert.equal(f.busy(), true);
      if (rejectOld) first.reject(new Error("stale error")); else first.resolve({ ...uploaded, id: "first" });
      await tick(); assert.equal(f.busy(), false);
      assert.ok(!JSON.stringify(f.render()).includes("stale error"));
      assert.deepEqual(state().doc.assets.uploaded, uploaded);
    } finally { f.ui.unmount(); }
  }
});

test("a current upload failure can be retried and fallback files remain available", async () => {
  const first = deferred<Asset>(); const second = deferred<Asset>(); let calls = 0;
  const f = setup(() => ++calls === 1 ? first.promise : second.promise);
  try {
    f.add(); first.reject(new Error("テストのアップロード失敗")); await tick(); assert.equal(f.busy(), false);
    assert.ok(JSON.stringify(f.render()).includes("テストのアップロード失敗"));
    f.add(); const local = { ...uploaded, path: undefined, dataUrl: "data:audio/wav;base64,bG9jYWw=" }; second.resolve(local); await tick();
    assert.deepEqual(state().doc.assets.uploaded, local); assert.equal(f.busy(), false);
    assert.ok(!JSON.stringify(f.render()).includes("テストのアップロード失敗"));
  } finally { f.ui.unmount(); }
});

for (const boundary of ["undo", "undo-redo", "replace", "restore", "reset", "remote-source", "remote-path", "delete"]) {
  test(`migration does not rewrite a stale asset after ${boundary}`, async () => {
    const work = deferred<string>(); const f = setup(undefined, () => work.promise);
    try {
      state().updateNode("a", { name: "Important edit" }); f.move();
      if (boundary.startsWith("undo")) state().undo();
      if (boundary === "undo-redo") state().redo();
      if (boundary === "replace") state().replaceDoc(structuredClone(state().doc));
      if (boundary === "restore") state().restoreDoc({ ...structuredClone(state().doc), siteName: "Restored" });
      if (boundary === "reset") state().resetDoc();
      if (boundary === "remote-source" || boundary === "remote-path") {
        const remote = structuredClone(state().doc);
        if (boundary === "remote-source") remote.assets.embedded.dataUrl = "data:audio/wav;base64,bmV3";
        else replaceEmbeddedAsset(remote, "embedded", "assets/newer.wav");
        state().applyRemoteDoc(remote);
      }
      if (boundary === "delete") state().updateDoc((d) => { delete d.assets.embedded; });
      const before = state(); work.resolve("assets/old.wav"); await tick();
      assert.deepEqual(state().doc, before.doc); assert.deepEqual(state().past, before.past); assert.deepEqual(state().future, before.future);
    } finally { f.ui.unmount(); }
  });
}

test("migration survives navigation, rename, and tab closure, updates all supported references, and can be undone/redone", async () => {
  for (const close of [false, true]) {
    const work = deferred<string>(); const f = setup(undefined, () => work.promise);
    try {
      f.move(); state().setActivePage("q"); state().updateDoc((d) => { d.assets.embedded.name = "renamed.wav"; d.nodes.a.name = "Edited"; });
      if (close) f.ui.unmount();
      const before = structuredClone(state().doc); work.resolve("assets/migrated.wav"); await tick();
      const after = structuredClone(before); replaceEmbeddedAsset(after, "embedded", "assets/migrated.wav");
      assert.deepEqual(state().doc, after); assert.equal(after.assets.embedded.name, "renamed.wav");
      const src = assetSrc(after.assets.embedded);
      assert.equal(after.nodes.a.media?.src, src);
      assert.equal(after.nodes.a.styles.base?.default?.backgroundImage, `url("${src}")`);
      assert.equal(after.pages.p.bodyStyles?.base?.default?.backgroundImage, `url("${src}")`);
      for (let n = 0; n < 2; n++) { state().undo(); assert.deepEqual(state().doc, before); state().redo(); assert.deepEqual(state().doc, after); }
    } finally { f.ui.unmount(); }
  }
});

test("migration errors and unavailable storage can be retried without changing the asset", async () => {
  for (const fail of ["error", "unavailable"]) {
    const first = deferred<string | null>(); const second = deferred<string | null>(); let calls = 0;
    const f = setup(undefined, () => ++calls === 1 ? first.promise : second.promise);
    try {
      f.move(); if (fail === "error") first.reject(new Error("テストの移行失敗")); else first.resolve(null);
      await tick(); assert.equal(f.busy(), false); assert.deepEqual(state().doc, assetLibraryDoc());
      f.move(); second.resolve("assets/retry.wav"); await tick(); assert.equal(f.busy(), false);
      assert.equal(state().doc.assets.embedded.path, "assets/retry.wav");
    } finally { f.ui.unmount(); }
  }
});

test("a late upload retains files without consuming a new active gesture checkpoint", async () => {
  const work = deferred<Asset>(); const f = setup(() => work.promise);
  try {
    state().updateNode("a", { name: "Redo" }); f.add(); state().undo();
    const before = structuredClone(state().doc); const end = state().beginGesture();
    work.resolve(uploaded); await tick(); assert.equal(state().future.length, 1);
    state().setStyleProps("a", { color: "blue" }); state().setStyleProps("a", { color: "green" }); end();
    state().undo(); assert.deepEqual(state().doc, retain(before));
    state().redo(); assert.equal(state().doc.nodes.a.styles.base?.default?.color, "green"); assert.deepEqual(state().doc.assets.uploaded, uploaded);
  } finally { state().endGesture(); f.ui.unmount(); }
});

for (const kind of ["upload", "migration"]) {
  test(`${kind} completion waits for active gestures and receives its own Undo/Redo step`, async () => {
    const work = deferred<any>(); const f = setup(() => work.promise, () => work.promise);
    try {
      const before = structuredClone(state().doc); if (kind === "upload") f.add(); else f.move();
      const end = state().beginGesture(); state().setStyleProps("a", { width: "110px" });
      const edited = structuredClone(state().doc); work.resolve(kind === "upload" ? uploaded : "assets/migrated.wav"); await tick();
      assert.deepEqual(state().doc, edited); assert.equal(f.busy(), true);
      state().setStyleProps("a", { width: "120px" }); const finished = structuredClone(state().doc);
      end(); await tick(); assert.equal(f.busy(), false); const completed = structuredClone(state().doc);
      state().undo(); assert.deepEqual(state().doc, finished); state().undo(); assert.deepEqual(state().doc, before);
      state().redo(); assert.deepEqual(state().doc, finished); state().redo(); assert.deepEqual(state().doc, completed);
    } finally { state().endGesture(); f.ui.unmount(); }
  });

  for (const interruption of ["undo", "restore", "unmount"]) {
    test(`${kind} waiting on a gesture handles ${interruption} without a stale write or stuck subscription`, async () => {
      const work = deferred<any>(); const f = setup(() => work.promise, () => work.promise);
      try {
        if (kind === "upload") f.add(); else f.move();
        const end = state().beginGesture(); state().setStyleProps("a", { width: "110px" });
        work.resolve(kind === "upload" ? uploaded : "assets/migrated.wav"); await tick();
        if (interruption === "undo") state().undo();
        if (interruption === "restore") state().restoreDoc({ ...structuredClone(state().doc), siteName: "Restored" });
        if (interruption === "unmount") f.ui.unmount();
        const before = state(); await tick();
        if (interruption !== "unmount") {
          assert.deepEqual(state().doc, kind === "upload" ? retain(before.doc) : before.doc);
          assert.equal(f.busy(), false);
          assert.deepEqual(state().future, kind === "upload" ? before.future.map((d) => retain(d)) : before.future);
        } else assert.deepEqual(state().doc, before.doc, "closing the tab does not interrupt the independent gesture");
        end(); await tick();
        if (interruption === "unmount") {
          const after = structuredClone(state().doc); assert.notDeepEqual(after, before.doc);
          state().undo(); assert.deepEqual(state().doc, before.doc); state().redo(); assert.deepEqual(state().doc, after);
        }
      } finally { state().endGesture(); f.ui.unmount(); }
    });
  }
}
