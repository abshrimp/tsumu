import assert from "node:assert/strict";
import { test } from "node:test";
import { useEditor } from "../lib/store";
import { elements, importCallbacks } from "./helpers/pending-import";
import type { Asset } from "../lib/types";

const state = () => useEditor.getState();
const tick = () => new Promise((r) => setImmediate(r));
const original = "<p>Original</p>";
const imported = '<link rel="stylesheet" href="tsumu-zip-css:css">';
const assets: Asset[] = [
  { id: "image", name: "a.png", path: "assets/a.png", width: 1, height: 1, zip: { version: 1, group: "g", path: "a.png" } },
  { id: "css", name: "a.css", path: "assets/a.css", width: 0, height: 0, zip: { version: 1, group: "g", path: "a.css", stylesheet: { source: 'p{background:url(a.png)}', references: [{ url: "a.png", assetId: "image", suffix: "" }] } } },
];
function fixture() {
  state().endGesture();
  state().replaceDoc({ siteName: "HTML imports", assets: {}, nodes: {}, pageOrder: ["p", "q"], pages: Object.fromEntries(["p", "q"].map(id => [id, { id, name: id, slug: id, title: "", description: "", children: [], rawHtml: original }])) });
  state().setActivePage("p");
  const jobs: { resolve: (v: any) => void; reject: (e: Error) => void; progress: (s: string) => void }[] = [];
  const ui = importCallbacks("html", undefined, async (_file, progress = () => {}) => new Promise((resolve, reject) => jobs.push({ resolve, reject, progress })));
  const readers: any[] = [];
  const oldReader = globalThis.FileReader;
  globalThis.FileReader = class { result = ""; onload?: () => void; readAsText() { readers.push(this); } } as any;
  const render = () => elements(ui.render());
  const start = (zip: boolean) => render().find(e => e.type === "input" && e.props.accept?.startsWith(zip ? ".zip" : ".html")).props.onChange({ target: { files: [new File([], zip ? "site.zip" : "index.html")], value: "" } });
  const complete = async (zip: boolean, index = 0) => { if (zip) jobs[index].resolve({ html: imported, source: imported, zip: { path: "index.html", assetIds: assets.map(a => a.id) }, assets, name: "index.html" }); else { readers[index].result = imported; readers[index].onload(); } await tick(); };
  render();
  return { ui, render, start, complete, jobs, readers, close() { ui.unmount(); globalThis.FileReader = oldReader; } };
}

for (const zip of [false, true]) {
  for (const change of ["edit", "typing", "kind", "page", "delete", "unmount", "undo", "undo-redo", "restore", "replace"]) {
    test(`${zip ? "ZIP" : "HTML"} import cannot overwrite ${change} or clear its history`, async () => {
      const f = fixture();
      try {
        state().updatePage("p", { title: "Keep this edit" });
        f.start(zip); f.render();
        if (change === "edit") state().updatePage("p", { rawHtml: "Newer" });
        if (change === "typing") f.render().find(e => e.props?.rows === 14).props.onChange();
        if (change === "kind") await f.render().find(e => e.props?.options?.some((o: any) => o.value === "html")).props.onChange("normal");
        if (change === "page") state().setActivePage("q");
        if (change === "delete") state().updateDoc(d => { delete d.pages.p; });
        if (change === "unmount") f.ui.unmount();
        if (change.startsWith("undo")) state().undo();
        if (change === "undo-redo") state().redo();
        if (change === "restore") state().restoreDoc({ ...structuredClone(state().doc), siteName: "Restored" });
        if (change === "replace") state().replaceDoc(structuredClone(state().doc));
        // 再描画の前にわざと解決する。現在の状態での確認も働かなければならない。
        const before = structuredClone(state().doc); const past = structuredClone(state().past); const future = structuredClone(state().future);
        await f.complete(zip);
        const retain = (d: typeof before) => zip ? { ...d, assets: Object.fromEntries(assets.map(a => [a.id, a])) } : d;
        assert.deepEqual(state().doc, retain(before));
        assert.deepEqual(state().past, past.map(retain));
        assert.deepEqual(state().future, future.map(retain));
      } finally { f.close(); }
    });
  }
  test(`${zip ? "ZIP" : "HTML"} normal import preserves unrelated edits and is one Undo/Redo step`, async () => {
    const f = fixture();
    try {
      f.start(zip); state().updatePage("q", { name: "Keep this name" }); f.render();
      const before = structuredClone(state().doc);
      await f.complete(zip); const completed = structuredClone(state().doc);
      assert.equal(completed.pages.p.rawHtml, imported);
      if (zip) assert.deepEqual(completed.assets, Object.fromEntries(assets.map(a => [a.id, a])));
      state().undo(); assert.deepEqual(state().doc, before);
      state().redo(); assert.deepEqual(state().doc, completed);
    } finally { f.close(); }
  });
}

for (const firstZip of [false, true]) test(`newer ${firstZip ? "HTML" : "ZIP"} selection supersedes earlier import`, async () => {
  const f = fixture();
  try {
    f.start(firstZip); f.start(!firstZip); f.render();
    await f.complete(firstZip);
    assert.equal(state().doc.pages.p.rawHtml, original);
    if (firstZip) assert.deepEqual(state().doc.assets, Object.fromEntries(assets.map(a => [a.id, a])));
    await f.complete(!firstZip);
    assert.equal(state().doc.pages.p.rawHtml, imported);
  } finally { f.close(); }
});

test("old ZIP progress, failure and completion do not affect a new page/import", async () => {
  const f = fixture();
  try {
    f.start(true); state().setActivePage("q"); f.render(); f.start(true); f.render();
    f.jobs[0].progress("Old progress"); f.jobs[0].reject(new Error("Old failure")); await tick();
    assert.equal(f.render().some(e => e.props?.role === "status"), false);
    assert.equal(f.render().find(e => e.type === "button" && e.props.disabled)?.props.disabled, true);
    await f.complete(true, 1); assert.equal(state().doc.pages.q.rawHtml, imported);
    assert.equal(state().doc.pages.p.rawHtml, original);
  } finally { f.close(); }
});

for (const event of ["onerror", "onabort"]) test(`HTML ${event} settles its request without cancelling a newer ZIP`, async () => {
  const f = fixture();
  try {
    f.start(false); f.readers[0][event](); f.render();
    f.start(false); f.start(true); f.render();
    f.readers[1][event]();
    assert.equal(f.render().find(e => e.type === "button" && e.props.disabled)?.props.disabled, true);
    await f.complete(true);
    assert.equal(state().doc.pages.p.rawHtml, imported);
    assert.equal(f.render().some(e => e.type === "button" && e.props.disabled), false);
  } finally { f.close(); }
});

for (const zip of [false, true]) for (const interrupt of ["finish", "undo", "unmount", "edit"]) test(`${zip ? "ZIP" : "HTML"} waits for manual gesture: ${interrupt}`, async () => {
  const f = fixture();
  try {
    f.start(zip); f.render(); const before = structuredClone(state().doc);
    const finish = state().beginGesture();
    state().updatePage("p", { htmlBackground: "#ff0000" });
    await f.complete(zip);
    assert.equal(state().doc.pages.p.rawHtml, original);
    assert.deepEqual(state().doc.assets, {});
    state().updatePage("p", { htmlBackground: "#00ff00" });
    const manual = structuredClone(state().doc);
    if (interrupt === "undo") state().undo();
    if (interrupt === "unmount") f.ui.unmount();
    if (interrupt === "edit") { f.render().find(e => e.props?.rows === 14).props.onChange(); f.render(); }
    if (interrupt === "finish") finish();
    await tick();
    if (interrupt === "finish") {
      const completed = structuredClone(state().doc); assert.equal(completed.pages.p.rawHtml, imported);
      state().undo(); assert.deepEqual(state().doc, manual);
      state().undo(); assert.deepEqual(state().doc, before);
      state().redo(); state().redo(); assert.deepEqual(state().doc, completed);
    } else {
      assert.equal(state().doc.pages.p.rawHtml, original);
      if (zip) assert.deepEqual(state().doc.assets, Object.fromEntries(assets.map(a => [a.id, a])));
      if (interrupt === "undo") assert.equal(state().future.length, 1);
    }
  } finally { f.close(); }
});
