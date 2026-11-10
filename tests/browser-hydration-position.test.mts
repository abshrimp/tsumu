import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { createInitialDoc, makeBox } from "../lib/presets";
import { fakeIndexedDB } from "./helpers/fake-indexeddb";

const bundled = await build({
  stdin: { contents: `export { hydrateBrowserDoc, persistDoc, useEditor } from './lib/store';
    export { createBrowserDoc, readBrowserDoc } from './lib/browser-doc-storage';`,
    resolveDir: resolve("."), loader: "ts" },
  bundle: true, platform: "node", format: "cjs", packages: "external", write: false,
});

async function fixture(stale = false, raw?: string | null) {
  const doc = createInitialDoc();
  const firstPage = doc.pages[doc.pageOrder[0]];
  doc.pages.second = { ...firstPage, id: "second", slug: "second", children: [] };
  doc.pageOrder.push("second");
  doc.nodes.master = { ...makeBox(), id: "master" };
  doc.components = { reusable: { id: "reusable", name: "Reusable", rootId: "master" } };
  doc.breakpoints = [{ id: "compact", label: "Compact", maxWidth: 640 }];
  const ui = {
    selection: stale ? "removed" : "master", selectedIds: [stale ? "removed" : "master"],
    editingComponentId: stale ? "removed" : "reusable",
    scriptEditor: { focusNodeId: stale ? "removed" : "master" },
    breakpoint: stale ? "removed" : "compact", customWidth: null,
    zoom: 0.75, leftTab: "pages", rightTab: "settings",
  };
  const pageKey = "tsumu-active-page-v1:hydration";
  const uiKey = "tsumu-ui-v1:hydration";
  const values = new Map([[pageKey, stale ? "removed" : "second"], [uiKey, JSON.stringify(ui)]]);
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    indexedDB: fakeIndexedDB(), location: { pathname: "/sites/hydration" },
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    },
  } });
  const module = { exports: {} as typeof import("../lib/store") & typeof import("../lib/browser-doc-storage") };
  new Function("require", "module", "exports", bundled.outputFiles[0].text)(
    createRequire(resolve("package.json")), module, module.exports,
  );
  const api = module.exports;
  if (raw !== null) await api.createBrowserDoc("hydration", raw ?? JSON.stringify(doc));
  return {
    ...api, doc, ui, values, pageKey, uiKey,
    async dispose() {
      // Let the real debounced preference writer finish before replacing window.
      await new Promise(resolve => setTimeout(resolve, 250));
      if (previous) Object.defineProperty(globalThis, "window", previous);
      else Reflect.deleteProperty(globalThis, "window");
    },
  };
}

test("the starter document cannot overwrite the remembered page before IndexedDB hydration", async () => {
  const f = await fixture();
  try {
    assert.equal(f.values.get(f.pageKey), "second");
    await f.hydrateBrowserDoc();
    assert.equal(f.useEditor.getState().activePageId, "second");
    assert.deepEqual(f.useEditor.getState().doc, f.doc);
  } finally { await f.dispose(); }
});

test("hydration validates saved editor position against the persisted document and its breakpoints", async () => {
  const f = await fixture();
  try {
    await f.hydrateBrowserDoc();
    for (const [key, value] of Object.entries(f.ui)) {
      assert.deepEqual(f.useEditor.getState()[key as keyof typeof f.ui], value, key);
    }
    assert.equal(await f.persistDoc(f.doc), "saved");
    assert.equal(await f.readBrowserDoc("hydration"), JSON.stringify(f.doc));
    f.useEditor.getState().replaceDoc(structuredClone(f.doc));
    assert.equal(f.useEditor.getState().selection, "master", "cloud reconciliation preserves restored selection");
    f.useEditor.getState().select(null);
    await f.hydrateBrowserDoc();
    assert.equal(f.useEditor.getState().selection, null, "reconnect does not replay startup preferences");
  } finally { await f.dispose(); }
});

test("hydration discards stale page, node, component and breakpoint references", async () => {
  const f = await fixture(true);
  try {
    await f.hydrateBrowserDoc();
    const state = f.useEditor.getState();
    assert.equal(state.activePageId, f.doc.pageOrder[0]);
    assert.equal(state.selection, null);
    assert.deepEqual(state.selectedIds, []);
    assert.equal(state.editingComponentId, null);
    assert.deepEqual(state.scriptEditor, { focusNodeId: null });
    assert.equal(state.breakpoint, "base");
  } finally { await f.dispose(); }
});

for (const raw of [null, "{broken"]) {
  test(`editor position remains writable after ${raw === null ? "empty" : "failed"} cache hydration`, async () => {
    const f = await fixture(false, raw);
    try {
      await f.hydrateBrowserDoc();
      // A server snapshot may still load even if the browser cache is unavailable.
      f.useEditor.getState().replaceDoc(f.doc);
      f.useEditor.getState().setActivePage(f.doc.pageOrder[0]);
      f.useEditor.getState().select("master");
      await new Promise(resolve => setTimeout(resolve, 250));
      assert.equal(f.values.get(f.pageKey), f.doc.pageOrder[0]);
      assert.equal(JSON.parse(f.values.get(f.uiKey)!).selection, "master");
      assert.equal(await f.readBrowserDoc("hydration"), raw, "preferences do not modify cached document data");
    } finally { await f.dispose(); }
  });
}
