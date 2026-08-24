import assert from "node:assert/strict";
import { test } from "node:test";
import { useEditor } from "../lib/store";
import { makeText } from "../lib/presets";
import { elements, importCallbacks, pendingImportBundle } from "./helpers/pending-import";
import type { Asset, ImageRef } from "../lib/types";

const state = () => useEditor.getState();
function open() {
  state().replaceDoc({
    siteName: "Imports", assets: {}, pageOrder: ["p"],
    pages: { p: { id: "p", name: "P", slug: "", title: "", description: "", children: ["a", "b"] } },
    nodes: { a: { ...makeText("A"), id: "a" }, b: { ...makeText("B"), id: "b" } },
  });
  state().select("a");
  state().setBreakpoint("base");
  state().setStyleState("default");
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const uploaded: Asset = { id: "new", name: "new.png", width: 1, height: 1, path: "assets/new.png" };
const tick = () => new Promise((resolve) => setImmediate(resolve));

function imageFixture(apply: (v: ImageRef | null) => void = () => {}, setup = () => {}) {
  open();
  setup();
  const work = deferred<Asset>();
  const ui = importCallbacks("image", () => work.promise);
  const writes: (ImageRef | null)[] = [];
  const props = { value: { url: "https://example.test/original.png" } as ImageRef | null, editTarget: "a/base", onChange: (v: ImageRef | null) => { writes.push(v); apply(v); } };
  const render = () => elements(ui.render(props));
  render().find((e) => e.props?.className?.startsWith("img-pick-thumb")).props.onClick();
  const input = render().find((e) => e.type === "input" && e.props.type === "file");
  input.props.onChange({ target: { files: [new File(["image"], "new.png", { type: "image/png" })], value: "new.png" } });
  render();
  return { work, ui, writes, props, render };
}

test("image upload does not replace a newer chosen image or cleared value", async () => {
  for (const choose of [true, false]) {
    const f = imageFixture();
    if (choose) f.render().find((e) => e.props?.onPick).props.onPick({ id: "existing" });
    else f.render().find((e) => e.props?.["data-tip"] === "クリア").props.onClick();
    f.work.resolve(uploaded);
    await tick();
    assert.deepEqual(f.writes, [choose ? { assetId: "existing" } : null]);
    assert.deepEqual(state().doc.assets, { new: uploaded });
    f.ui.unmount();
  }
});

test("typing a URL cancels the pending image assignment before blur, including stale errors", async () => {
  for (const initial of [undefined, { url: "https://example.test/original.png" }]) {
    for (const fail of [false, true]) {
      open();
      if (initial) state().updatePage("p", { ogImage: initial });
      const work = deferred<Asset>();
      const ui = importCallbacks("image", () => work.promise);
      const render = () => elements(ui.render({
        editTarget: "p", value: state().doc.pages.p.ogImage,
        onChange: (value: ImageRef | null) => state().updatePage("p", { ogImage: value }),
      }));
      const urlInput = () => render().find((e) => e.type === "input" && e.props.className === "input");
      try {
        render().find((e) => e.props?.className?.startsWith("img-pick-thumb")).props.onClick();
        render().find((e) => e.type === "input" && e.props.type === "file").props.onChange({
          target: { files: [new File(["image"], "new.png", { type: "image/png" })], value: "new.png" },
        });
        const draft = "  https://example.test/newer.png  ";
        urlInput().props.onChange?.({ target: { value: draft } });
        assert.deepEqual(state().doc.pages.p.ogImage, initial, "typing does not commit the draft");
        if (fail) work.reject(new Error("stale upload failed"));
        else work.resolve(uploaded);
        await tick();
        assert.deepEqual(state().doc.pages.p.ogImage, initial, "completion cannot assign over the unblurred draft");
        assert.deepEqual(state().doc.assets, fail ? {} : { new: uploaded });
        assert.deepEqual(ui.alerts, []);
        assert.ok(urlInput(), "the URL field remains mounted");
        urlInput().props.onBlur({ target: { value: draft } });
        assert.deepEqual(state().doc.pages.p.ogImage, { url: draft.trim() });
      } finally { ui.unmount(); }
    }
  }
});

test("completed uploads stay in Assets without assignment after closing, unmounting, target changes, or new values", async () => {
  for (const stop of ["close", "unmount", "target", "value"]) {
    const f = imageFixture();
    if (stop === "close") f.render().find((e) => e.props?.className?.startsWith("img-pick-thumb")).props.onClick();
    if (stop === "unmount") f.ui.unmount();
    if (stop === "target") { f.props.editTarget = "a/mobile"; f.render(); }
    if (stop === "value") { f.props.value = { url: "https://example.test/newer.png" }; f.render(); }
    f.work.resolve(uploaded);
    await tick();
    assert.deepEqual(f.writes, [], stop);
    assert.deepEqual(state().doc.assets, { new: uploaded }, stop);
    f.ui.unmount();
  }
});

test("cancelled image errors stay silent and a retry owns the result and busy state", async () => {
  const f = imageFixture();
  f.render().find((e) => e.props?.className?.startsWith("img-pick-thumb")).props.onClick();
  f.work.reject(new Error("old upload failed"));
  await tick();
  assert.deepEqual(f.ui.alerts, []);
  f.ui.unmount();

  const first = deferred<Asset>(); const second = deferred<Asset>();
  let count = 0;
  const ui = importCallbacks("image", () => ++count === 1 ? first.promise : second.promise);
  const writes: unknown[] = [];
  const render = () => elements(ui.render({ value: null, onChange: (v: unknown) => writes.push(v) }));
  render().find((e) => e.props?.className?.startsWith("img-pick-thumb")).props.onClick();
  const input = () => render().find((e) => e.type === "input" && e.props.type === "file");
  const change = () => input().props.onChange({ target: { files: [new File([], "new.png")], value: "" } });
  change(); change();
  first.resolve({ ...uploaded, id: "old-request" }); await tick();
  assert.equal(render().find((e) => e.props?.className === "img-pick-cell is-upload").props.disabled, true);
  assert.deepEqual(writes, []);
  second.resolve(uploaded); await tick();
  assert.deepEqual(writes, [{ assetId: "new" }]);
  assert.deepEqual(Object.keys(state().doc.assets), ["old-request", "new"]);
  ui.unmount();
});


test("a failed old upload cannot clear a newer retry's busy state or show its error", async () => {
  open();
  const old = deferred<Asset>(); const current = deferred<Asset>();
  let count = 0;
  const ui = importCallbacks("image", () => ++count === 1 ? old.promise : current.promise);
  const writes: unknown[] = [];
  const render = () => elements(ui.render({ value: null, onChange: (v: unknown) => writes.push(v) }));
  const toggle = () => render().find((e) => e.props?.className?.startsWith("img-pick-thumb")).props.onClick();
  const chooseFile = () => render().find((e) => e.type === "input" && e.props.type === "file").props.onChange({
    target: { files: [new File([], "new.png")], value: "" },
  });
  toggle(); chooseFile(); toggle(); toggle(); chooseFile();
  old.reject(new Error("old upload failed")); await tick();
  assert.equal(render().find((e) => e.props?.className === "img-pick-cell is-upload").props.disabled, true);
  assert.deepEqual(ui.alerts, []);
  assert.deepEqual(writes, []);
  current.resolve(uploaded); await tick();
  assert.deepEqual(writes, [{ assetId: "new" }]);
  assert.deepEqual(state().doc.assets, { new: uploaded });
  ui.unmount();
});

test("late upload registration has its own undo step and preserves the newer image choice", async () => {
  const f = imageFixture((value) => state().updatePage("p", { ogImage: value }));
  try {
    f.render().find((e) => e.props?.onPick).props.onPick({ id: "existing" });
    const chosen = structuredClone(state().doc);
    f.work.resolve(uploaded); await tick();
    const completed = structuredClone(state().doc);
    assert.deepEqual(completed.pages.p.ogImage, { assetId: "existing" });
    assert.deepEqual(completed.assets.new, uploaded);
    state().undo(); assert.deepEqual(state().doc, chosen, "undo the completed upload without undoing the newer image choice");
    state().redo(); assert.deepEqual(state().doc, completed);
    state().undo(); state().undo(); assert.equal(state().doc.pages.p.ogImage, undefined);
    state().redo(); state().redo(); assert.deepEqual(state().doc, completed);
  } finally { f.ui.unmount(); }
});

test("uninterrupted image upload preserves unrelated edits and the complete undo/redo snapshots", async () => {
  const f = imageFixture((value) => state().updatePage("p", { ogImage: value }));
  try {
    state().updateNode("b", { name: "Edited while uploading" }); f.render();
    const before = structuredClone(state().doc);
    f.work.resolve(uploaded); await tick();
    const imported = structuredClone(state().doc);
    assert.deepEqual(imported.pages.p.ogImage, { assetId: "new" });
    assert.deepEqual(imported.assets.new, uploaded);
    assert.equal(imported.nodes.b.name, "Edited while uploading");
    state().undo(); state().undo(); assert.deepEqual(state().doc, before);
    state().redo(); state().redo(); assert.deepEqual(state().doc, imported);
  } finally { f.ui.unmount(); }
});


test("an upload interrupted by unrelated Undo retains its file without clearing Redo, even before a rerender", async () => {
  const f = imageFixture(undefined, () => state().updateNode("b", { name: "Redo this edit" }));
  try {
    const edited = structuredClone(state().doc);
    state().undo();
    assert.equal(state().future.length, 1);
    f.work.resolve(uploaded); await tick();
    assert.deepEqual(f.writes, []);
    assert.equal(state().past.length, 0); assert.equal(state().future.length, 1);
    assert.deepEqual(state().doc.assets.new, uploaded);
    state().redo(); assert.deepEqual(state().doc, { ...edited, assets: { new: uploaded } });
    state().undo(); assert.deepEqual(state().doc.assets.new, uploaded);
    state().redo(); assert.deepEqual(state().doc, { ...edited, assets: { new: uploaded } });
  } finally { f.ui.unmount(); }
});

test("Undo then Redo invalidates the old assignment even when its target and content return unchanged", async () => {
  const f = imageFixture(undefined, () => state().updateNode("b", { name: "Same when complete" }));
  try {
    const edited = structuredClone(state().doc);
    state().undo(); state().redo();
    f.work.resolve(uploaded); await tick();
    assert.deepEqual(f.writes, []);
    assert.equal(state().past.length, 1); assert.equal(state().future.length, 0);
    assert.deepEqual(state().doc, { ...edited, assets: { new: uploaded } });
    state().undo(); assert.deepEqual(state().doc.assets.new, uploaded);
  } finally { f.ui.unmount(); }
});

test("replacement, restoration, and reset retain the completed upload without applying an old picker", async () => {
  for (const boundary of ["replace", "restore", "reset"]) {
    const f = imageFixture();
    try {
      const replacement = structuredClone(state().doc);
      if (boundary === "replace") state().replaceDoc(replacement);
      if (boundary === "restore") { replacement.siteName = "Restored"; state().restoreDoc(replacement); }
      if (boundary === "reset") state().resetDoc();
      const before = structuredClone(state().doc);
      const past = state().past.length;
      f.work.resolve(uploaded); await tick();
      assert.deepEqual(f.writes, [], boundary);
      assert.deepEqual(state().doc, { ...before, assets: { ...before.assets, new: uploaded } });
      assert.equal(state().past.length, past);
    } finally { f.ui.unmount(); }
  }
});

test("an ineffective Undo or Redo leaves the pending upload valid and normally undoable", async () => {
  const f = imageFixture((value) => state().updatePage("p", { ogImage: value }));
  try {
    const before = structuredClone(state().doc);
    state().undo(); state().redo(); f.render();
    f.work.resolve(uploaded); await tick();
    assert.deepEqual(f.writes, [{ assetId: "new" }]);
    state().undo(); state().undo(); assert.deepEqual(state().doc, before);
    state().redo(); state().redo(); assert.deepEqual(state().doc.pages.p.ogImage, { assetId: "new" });
  } finally { f.ui.unmount(); }
});

function fontFixture() {
  open();
  const work = deferred<Response>();
  const oldFetch = globalThis.fetch;
  globalThis.fetch = () => work.promise;
  const ui = importCallbacks("font");
  const render = () => elements(ui.render({ inheritedValue: "Arial" }));
  render().find((e) => e.props?.["data-tip"] === "Google Fontsから追加").props.onClick();
  render().find((e) => e.type === "input").props.onChange({ target: { value: "New Font" } });
  render().find((e) => e.type === "button" && e.props.className === "btn btn-sm").props.onClick();
  render();
  return { work, ui, render, close: () => { ui.unmount(); globalThis.fetch = oldFetch; } };
}

test("pending fonts cannot write into a changed breakpoint, state, selection, or multiselection", async () => {
  for (const change of [
    () => state().setBreakpoint("sm"),
    () => state().setStyleState("hover"),
    () => state().select("b"),
    () => useEditor.setState({ selectedIds: ["a", "b"] }),
  ]) {
    const f = fontFixture();
    try {
      change(); f.render();
      const before = structuredClone(state().doc);
      f.work.resolve(new Response("@font-face { font-weight: 100 900; }")); await tick(); await tick();
      assert.deepEqual(state().doc, before);
    } finally { f.close(); }
  }
});

test("closing or editing a pending font request leaves styles and font registrations unchanged", async () => {
  for (const change of ["close", "edit", "unmount", "external"]) {
    const f = fontFixture();
    try {
      if (change === "close") f.render().find((e) => e.props?.["data-tip"] === "Google Fontsから追加").props.onClick();
      if (change === "edit") f.render().find((e) => e.type === "input").props.onChange({ target: { value: "Different Font" } });
      if (change === "unmount") f.ui.unmount();
      if (change === "external") { state().setStyleProps("a", { fontFamily: "Arial" }); f.render(); }
      const before = structuredClone(state().doc);
      f.work.resolve(new Response("@font-face { font-weight: 100 900; }")); await tick(); await tick();
      assert.deepEqual(state().doc, before, change);
    } finally { f.close(); }
  }
});

test("uninterrupted font import preserves unrelated edits and undo/redo data", async () => {
  const f = fontFixture();
  try {
    state().updateNode("b", { name: "Edited while loading" }); f.render();
    const before = structuredClone(state().doc);
    f.work.resolve(new Response("@font-face { font-weight: 100 900; }")); await tick(); await tick();
    const imported = structuredClone(state().doc);
    assert.equal(imported.nodes.a.styles.base?.default?.fontFamily, "New Font");
    assert.equal(imported.nodes.b.name, "Edited while loading");
    assert.deepEqual(imported.customFonts, [{ family: "New Font", weights: "variable" }]);
    state().undo(); state().undo(); assert.deepEqual(state().doc, before);
    state().redo(); state().redo(); assert.deepEqual(state().doc, imported);
  } finally { f.close(); }
});


test("font validation cannot add a font after unrelated Undo or document replacement", async () => {
  for (const replace of [false, true]) {
    const f = fontFixture();
    try {
      if (replace) state().replaceDoc(structuredClone(state().doc));
      else { state().updateNode("b", { name: "Redo this edit" }); state().undo(); }
      const before = structuredClone(state().doc);
      const future = structuredClone(state().future);
      f.work.resolve(new Response("@font-face { font-weight: 100 900; }")); await tick(); await tick();
      assert.deepEqual(state().doc, before);
      assert.deepEqual(state().future, future);
    } finally { f.close(); }
  }
});

test("pending import browser fixture bundles the actual inspector and upload path", async () => {
  const bundle = await pendingImportBundle();
  assert.match(bundle, /function RightPanel/);
  assert.match(bundle, /function uploadStaticAsset/);
  assert.match(bundle, /importEditor/);
});
