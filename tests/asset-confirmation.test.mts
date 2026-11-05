import assert from "node:assert/strict";
import { test } from "node:test";
import { useEditor } from "../lib/store";
import { closeDialog, useDialogs } from "../lib/dialog";
import { assetSrc } from "../lib/assets";
import { assetConfirmationBundle, assetConfirmationCallbacks, assetConfirmationDoc, candidate, spare } from "./helpers/asset-confirmation";
import type { SiteDoc } from "../lib/types";

const state = () => useEditor.getState();
const tick = () => new Promise((resolve) => setImmediate(resolve));
function fixture(doc = assetConfirmationDoc()) {
  state().replaceDoc(doc);
  const originalFetch = globalThis.fetch;
  const deleted: string[] = [];
  globalThis.fetch = async (url, opts) => {
    assert.equal(opts?.method, "DELETE");
    deleted.push(new URL(String(url), "https://synthetic.test").searchParams.get("path")!);
    return Response.json({ ok: true });
  };
  const ui = assetConfirmationCallbacks();
  const render = () => ui.render();
  render();
  return {
    ui, deleted, render,
    begin(single = false) {
      const tree = render();
      if (!single) tree.find((e) => e.props?.className === "asset-clean").props.onClick();
      else {
        const card = tree.find((e) => e.props?.["data-asset-id"] === candidate.id);
        card.props.children.find((e: any) => e?.props?.["data-tip"] === "削除").props.onClick();
      }
      assert.ok(useDialogs.getState().queue.length);
    },
    async finish(ok = true) {
      const dialog = useDialogs.getState().queue[0];
      assert.equal(dialog.kind, "confirm");
      closeDialog(dialog.id);
      if (dialog.kind === "confirm") dialog.resolve(ok);
      await tick();
    },
    close() { ui.unmount(); globalThis.fetch = originalFetch; useDialogs.setState({ queue: [] }); },
  };
}
function remote(edit: (doc: SiteDoc) => void) {
  const doc = structuredClone(state().doc); edit(doc); state().applyRemoteDoc(doc);
}

const references: Record<string, (doc: SiteDoc) => void> = {
  image: (d) => { d.nodes.image.image!.assetId = candidate.id; },
  media: (d) => { d.nodes.media.media!.assetId = candidate.id; },
  background: (d) => { d.nodes.image.styles = { base: { default: { backgroundImage: `url("${assetSrc(candidate)}")` } } }; },
  pageBackground: (d) => { d.pages.p.bodyStyles = { base: { default: { backgroundImage: `url("${assetSrc(candidate)}")` } } }; },
  favicon: (d) => { d.favicon = { assetId: candidate.id }; },
  pageImage: (d) => { d.pages.p.ogImage = { assetId: candidate.id }; },
  html: (d) => { d.pages.p.rawHtml = `<img src="${assetSrc(candidate)}">`; },
  zipDependency: (d) => {
    d.assets.sheet = { id: "sheet", name: "sheet.css", mimeType: "text/css", width: 0, height: 0, zip: {
      version: 1, group: "zip", path: "sheet.css", stylesheet: {
        source: "body { background: url(a.png) }", references: [{ url: "a.png", assetId: candidate.id, suffix: "" }],
      },
    } };
    d.pages.p.rawHtml = '<link rel="stylesheet" href="tsumu-zip-css:sheet">';
  },
};
for (const [name, reference] of Object.entries(references)) {
  test(`unused cleanup rechecks ${name} references added during confirmation, before rerender`, async () => {
    const f = fixture();
    try {
      f.begin(); remote(reference);
      const before = structuredClone(state().doc);
      await f.finish();
      assert.deepEqual(state().doc, { ...before, assets: Object.fromEntries(Object.entries(before.assets).filter(([id]) => id !== spare.id)) });
      assert.deepEqual(f.deleted, [spare.path]);
      state().undo(); assert.deepEqual(state().doc, before);
      state().redo(); assert.equal(state().doc.assets[spare.id], undefined);
      assert.deepEqual(state().doc.assets[candidate.id], candidate);
    } finally { f.close(); }
  });
}

test("cleanup only removes originally approved unused assets and preserves unrelated edits", async () => {
  const doc = assetConfirmationDoc(); doc.nodes.image.image!.assetId = spare.id;
  const f = fixture(doc);
  try {
    f.begin(); remote((d) => {
      delete d.nodes.image.image!.assetId;
      d.assets.added = { ...spare, id: "added", name: "added.png", path: "assets/added.png" };
      d.nodes.media.name = "Edited while confirming";
    });
    const before = structuredClone(state().doc);
    await f.finish();
    assert.deepEqual(state().doc, { ...before, assets: { [spare.id]: before.assets[spare.id], added: before.assets.added } });
    assert.deepEqual(f.deleted, [candidate.path]);
  } finally { f.close(); }
});

for (const single of [false, true]) {
  for (const change of ["path", "embedded", "zip", "removed"] as const) {
    test(`${single ? "single deletion" : "cleanup"} preserves an asset ${change} during confirmation`, async () => {
      const doc = assetConfirmationDoc();
      if (change === "embedded") { delete doc.assets[candidate.id].path; doc.assets[candidate.id].dataUrl = "data:image/png;base64,b2xk"; }
      const f = fixture(doc);
      try {
        f.begin(single); remote((d) => {
          if (change === "path") d.assets[candidate.id].path = "assets/replacement.png";
          if (change === "embedded") d.assets[candidate.id].dataUrl = "data:image/png;base64,bmV3";
          if (change === "zip") d.assets[candidate.id].zip = { version: 1, group: "new", path: "a.png" };
          if (change === "removed") delete d.assets[candidate.id];
        });
        const before = structuredClone(state().doc);
        await f.finish();
        assert.deepEqual(state().doc.assets[candidate.id], before.assets[candidate.id]);
        assert.deepEqual(f.deleted, single ? [] : [spare.path]);
        if (single) assert.deepEqual(state().doc, before);
      } finally { f.close(); }
    });
  }
  for (const stop of ["cancel", "unmount", "replace", "restore", "reset", "undo", "undoRedo", "site"] as const) {
    test(`${single ? "single deletion" : "cleanup"} is inert after ${stop}`, async () => {
      const f = fixture(); const oldWindow = globalThis.window;
      try {
        state().updateNode("media", { name: "Undoable edit" });
        if (stop === "site") globalThis.window = { location: { pathname: "/sites/original" } } as Window & typeof globalThis;
        f.begin(single);
        if (stop === "unmount") f.ui.unmount();
        if (stop === "replace") state().replaceDoc(structuredClone(state().doc));
        if (stop === "restore") state().restoreDoc({ ...structuredClone(state().doc), siteName: "Restored" });
        if (stop === "reset") state().resetDoc();
        if (stop === "undo" || stop === "undoRedo") state().undo();
        if (stop === "undoRedo") state().redo();
        if (stop === "site") globalThis.window.location.pathname = "/sites/other";
        const before = structuredClone(state().doc);
        const past = structuredClone(state().past); const future = structuredClone(state().future);
        await f.finish(stop !== "cancel");
        assert.deepEqual(state().doc, before);
        assert.deepEqual(state().past, past); assert.deepEqual(state().future, future);
        assert.deepEqual(f.deleted, []);
      } finally { globalThis.window = oldWindow; f.close(); }
    });
  }
}

test("single unused deletion does not detach newly added references", async () => {
  const f = fixture();
  try {
    f.begin(true); remote(references.image);
    const before = structuredClone(state().doc);
    await f.finish();
    assert.deepEqual(state().doc, before); assert.deepEqual(f.deleted, []);
  } finally { f.close(); }
});

test("single used deletion still removes its approved references and only its file", async () => {
  const doc = assetConfirmationDoc(); references.image(doc); references.pageBackground(doc); references.favicon(doc);
  const f = fixture(doc);
  try {
    f.begin(true); state().updateNode("media", { name: "Unrelated" });
    await f.finish();
    assert.equal(state().doc.assets[candidate.id], undefined);
    assert.deepEqual(state().doc.assets[spare.id], spare);
    assert.equal(state().doc.nodes.image.image!.assetId, undefined);
    assert.equal(state().doc.nodes.image.image!.src, "");
    assert.equal(state().doc.favicon, null);
    assert.equal(state().doc.pages.p.bodyStyles!.base!.default!.backgroundImage, undefined);
    assert.equal(state().doc.nodes.media.name, "Unrelated");
    assert.deepEqual(f.deleted, [candidate.path]);
  } finally { f.close(); }
});

test("repeated confirmations do not delete the same file twice or create empty history", async () => {
  const f = fixture();
  try {
    f.begin(); f.begin();
    await f.finish(); const past = structuredClone(state().past);
    await f.finish();
    assert.deepEqual(state().doc.assets, {});
    assert.deepEqual(f.deleted, [candidate.path, spare.path]);
    assert.deepEqual(state().past, past);
  } finally { f.close(); }
});

test("all newly used candidates leave metadata, remote files and history unchanged", async () => {
  const f = fixture();
  try {
    f.begin(); remote((d) => { references.image(d); d.nodes.media.media!.assetId = spare.id; });
    const before = structuredClone(state().doc);
    await f.finish();
    assert.deepEqual(state().doc, before); assert.deepEqual(f.deleted, []); assert.equal(state().past.length, 0);
  } finally { f.close(); }
});

test("renaming and measured metadata do not change file identity", async () => {
  for (const single of [false, true]) {
    const f = fixture();
    try {
      f.begin(single); remote((d) => {
        Object.assign(d.assets[candidate.id], { name: "renamed.png", width: 30, height: 20, bytes: 100, svgFilter: false });
      });
      await f.finish();
      assert.equal(state().doc.assets[candidate.id], undefined);
      assert.deepEqual(f.deleted, single ? [candidate.path] : [candidate.path, spare.path]);
    } finally { f.close(); }
  }
});

for (const single of [false, true]) {
  for (const used of [false, true]) {
    test(`${single ? "single deletion" : "cleanup"} preserves the remote file of a newly added ${used ? "used" : "unused"} alias`, async () => {
      const f = fixture();
      try {
        f.begin(single); remote((d) => {
          d.assets.alias = { ...candidate, id: "alias" };
          if (used) d.nodes.image.image!.assetId = "alias";
        });
        await f.finish();
        assert.equal(state().doc.assets[candidate.id], undefined);
        assert.equal(state().doc.assets.alias.path, candidate.path);
        assert.deepEqual(f.deleted, single ? [] : [spare.path]);
      } finally { f.close(); }
    });
  }
}

test("cleanup preserves files reached through ZIP dependencies under another asset ID", async () => {
  const doc = assetConfirmationDoc();
  references.zipDependency(doc); doc.assets[spare.id].path = candidate.path;
  const f = fixture(doc);
  try {
    f.begin(); await f.finish();
    assert.deepEqual(state().doc.assets[candidate.id], candidate);
    assert.equal(state().doc.assets[spare.id], undefined);
    assert.deepEqual(f.deleted, []);
  } finally { f.close(); }
});

test("cleanup deletes an approved shared path once when none of its aliases remain", async () => {
  const doc = assetConfirmationDoc(); doc.assets[spare.id].path = candidate.path;
  const f = fixture(doc);
  try {
    f.begin(); await f.finish();
    assert.deepEqual(state().doc.assets, {});
    assert.deepEqual(f.deleted, [candidate.path]);
  } finally { f.close(); }
});

test("asset confirmation browser fixture bundles real components and remote deletion", async () => {
  const bundle = await assetConfirmationBundle();
  assert.match(bundle, /function AssetsTab/); assert.match(bundle, /function DialogHost/);
  assert.match(bundle, /function deleteAssetRemote/); assert.match(bundle, /assetEditor/);
});
