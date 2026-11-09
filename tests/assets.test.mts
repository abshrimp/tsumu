import { describe, before, test, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { ZipArchive } from "../lib/zip";
import { exportProjectZip } from "../lib/exportZip";
import { generateExportProject } from "../lib/export-formats";
import { parseSiteImport, restoreImportAssets } from "../lib/site-import";
import { validSiteDoc } from "../lib/doc-tree";
import { makeBox, makeImage, createInitialDoc, makeText } from "../lib/presets";
import { type SiteDoc, type Asset } from "../lib/types";
import { useEditor } from "../lib/store";
import { closeDialog, useDialogs } from "../lib/dialog";
import { assetDocUrl, assetSrc, downloadAsset, mediaSrc, nodeAssetSrc, replaceEmbeddedAsset, withSiteAssetUrl, mapLimit, ASSET_FETCH_CONCURRENCY, fetchWithRetry } from "../lib/assets";
import { createBrowserDoc } from "../lib/browser-doc-storage";
import { fakeIndexedDB } from "./helpers/fake-indexeddb";
import { assetConfirmationCallbacks, assetConfirmationDoc, candidate, spare } from "./helpers/asset-confirmation";
import { DatabaseSync } from "node:sqlite";
import { parseFragment } from "parse5";
import { cssAssetReferences } from "../lib/css-assets";
import { assetUploadedAt, extractAssetReferences, planAssetGc } from "../lib/asset-gc-plan";
import { recordAssetGcCandidates, runAssetGc, type AssetGcDocumentNamespace } from "../lib/asset-gc";
import { type Db, getDbFromBinding } from "../lib/db";
import { type KVLikeNamespace } from "../lib/kv";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { nodeDatabase } from "../lib/node-storage";
import { transformSync } from "./helpers/bundle";
import { readAssetLedger, recordUploadedAsset } from "../lib/asset-ledger";
import { computeStorageUsage } from "../lib/storage-usage";
import { assetLibraryCallbacks, assetLibraryDoc } from "./helpers/asset-library";
import { elements } from "./helpers/pending-import";
import { ASSET_TOKEN_TTL, verifyAssetToken, signAssetPaths } from "../lib/asset-token";
import { signAssetPath } from "./helpers/sign-asset-path";
import { createRequire } from "node:module";
import { permanentlyDeleteTrashedAsset } from "../lib/asset-trash-delete";
import * as apiJson from "../lib/api-json";
import { readAssetForm } from "../lib/asset-upload";
import { assetUsage } from "../lib/asset-usage";
import { referenceAssetUsage } from "./helpers/asset-usage-reference";
import { largeAssetLibrary } from "./helpers/large-asset-library";
import { ASSET_CACHE_MAX_AGE, assetCacheControl } from "../lib/asset-cache";
import { loadAllTrash } from "../lib/asset-trash-client";
import { assetDisplayKind, assetExtensionLabel, isVisualAsset } from "../lib/asset-display";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AssetGrid } from "../components/ImagePicker";
import { assetWindow, assetRowHeight, resizedAssetScrollTop } from "../lib/asset-window";

describe("asset-byte-roundtrip", () => {
const cases = [
  ["empty", "data:application/octet-stream,"],
  ["base64", "data:application/octet-stream;charset=utf-8;base64,AP8A"],
  ["binary-percent", "data:application/octet-stream," + Array.from({ length: 256 }, (_, i) => "%" + i.toString(16).padStart(2, "0")).join("")],
  ["escaped-base64", "data:application/octet-stream;base64,%2F%2B%2B%2F%2Fw%3D%3D"],
  ["uppercase", "DATA:application/octet-stream;BASE64,/w=="],
  ["literal-percent", "data:text/plain,100% complete%2"],
  ["unicode", "data:text/plain;charset=utf-8,雪🌸%00"],
  ["fragment", "data:text/plain,keep%23payload?query#discard-fragment"],
  ["empty-fragment", "data:text/plain,payload#"],
  ["empty-query", "data:text/plain,keep?"],
  ["empty-query-fragment", "data:text/plain,?#discard-fragment"],
  ["authority", "data://host,payload"],
  ["authority-query-fragment", "data://host,payload?query#discard-fragment"],
  ["base64-fragment", "data:application/octet-stream;base64,AQID#discard-fragment"],
  ["large", "data:application/octet-stream," + "%ff%00%80".repeat(12000)],
] as const;

function fixture(dataUrl: string, count = 32): SiteDoc {
  const doc: SiteDoc = {
    schemaVersion: 1, siteName: "Byte roundtrip", pageOrder: ["home"],
    pages: { home: { id: "home", name: "Home", slug: "", title: "雪🌸", description: "", children: [] } },
    nodes: {}, assets: {
      bytes: { id: "bytes", name: "payload.bin", mimeType: "application/octet-stream", width: 0, height: 0,
        dataUrl, zip: { version: 1, group: "original", path: "nested/payload.bin" } },
      module: { id: "module", name: "main.js", mimeType: "text/javascript", width: 0, height: 0,
        dataUrl: "data:text/javascript,export%20default%201", zip: { version: 1, group: "original", path: "main.js" } },
    },
  };
  for (let i = 0; i < count; i++) {
    const id = "node-" + i;
    doc.nodes[id] = { ...makeBox("Nested " + i), id };
    if (i % 16) doc.nodes["node-" + (i - 1)].children.push(id);
    else doc.pages.home.children.push(id);
  }
  return doc;
}

for (const framework of ["nextjs", "react", "vue", "nuxt", "sveltekit", "html"] as const) {
  for (const [name, url] of cases) test(`${framework} preserves ${name} asset bytes and ZIP-relative aliases`, async () => {
    const doc = fixture(url), before = structuredClone(doc);
    assert.equal(validSiteDoc(doc), true);
    const parsed = await parseSiteImport(new TextEncoder().encode(JSON.stringify(doc)), "doc");
    assert.deepEqual(parsed.doc, doc);
    // ネイティブの data URL の取得は、アセットの復元が使うものと同じバイト列のデコーダー。
    const expected = new Uint8Array(await (await fetch(url)).arrayBuffer());
    const project = generateExportProject(parsed.doc, framework);
    const root = framework === "html" ? "" : framework === "sveltekit" ? "static/" : "public/";
    for (const path of ["assets/payload.bin", "assets/_imports/original/nested/payload.bin"]) {
      assert.ok(Object.hasOwn(project.binaries, root + path), path);
      assert.deepEqual(new Uint8Array(Buffer.from(project.binaries[root + path], "base64")), expected, path);
    }
    assert.deepEqual(doc, before);
  });
}

test("invalid and non-data asset URLs are omitted without aborting project generation", () => {
  for (const url of ["not-a-url", "//example.test/a.png", "https://example.test/a.png", "data:text/plain", "data://[broken],payload"]) {
    const project = generateExportProject(fixture(url), "html");
    assert.equal(Object.hasOwn(project.binaries, "assets/payload.bin"), false, url);
    assert.equal(Object.hasOwn(project.binaries, "assets/_imports/original/nested/payload.bin"), false, url);
  }
});

test("4000 nested nodes, 160 scripts and binary assets survive JSON, ZIP, restore and a second export", async () => {
  const doc = fixture(cases.find(([name]) => name === "binary-percent")![1], 4000);
  for (const [name, dataUrl] of cases) doc.assets[name] = {
    id: name, name: name + ".bin", mimeType: "application/octet-stream", width: 0, height: 0, dataUrl,
  };
  for (let i = 0; i < 4000; i += 25) doc.nodes["node-" + i].scripts = [{
    id: "script-" + i, trigger: "click",    steps: [{ id: "step-" + i, kind: "set-var", into: "message", value: "雪<>& " + i }],
  }];
  const before = structuredClone(doc);
  assert.deepEqual((await parseSiteImport(new TextEncoder().encode(JSON.stringify(doc)), "doc")).doc, before);
  const globals = Object.getOwnPropertyDescriptors(globalThis);
  const createUrl = URL.createObjectURL;
  const stored = new Map<string, Uint8Array>();
  let download: Blob | undefined;
  URL.createObjectURL = blob => { download = blob; return "blob:byte-roundtrip"; };
  Object.assign(globalThis, {
    document: { createElement: () => ({ href: "", download: "", click() {} }) },
    fetch: async (input: string, init?: RequestInit) => {
      if (input.startsWith("/api/assets/file?")) {
        const path = new URL(input, "https://editor.test").searchParams.get("path")!;
        assert.ok(stored.has(path));
        return new Response(stored.get(path));
      }
      if (input === "/api/assets") {
        const file = (init!.body as FormData).get("file") as File;
        const path = "assets/restored-" + stored.size;
        stored.set(path, new Uint8Array(await file.arrayBuffer()));
        return Response.json({ path });
      }
      return globals.fetch.value(input, init);
    },
  });
  try {
    const archive = async (value: SiteDoc) => {
      download = undefined;
      assert.deepEqual(await exportProjectZip(value, "html"), []);
      assert.ok(download);
      return new Uint8Array(await (download as Blob).arrayBuffer());
    };
    const imported = await parseSiteImport(await archive(doc), "zip");
    assert.deepEqual(imported.doc, before);
    const expected = new Map<string, Uint8Array>();
    for (const asset of Object.values(doc.assets)) {
      const bytes = new Uint8Array(await (await globals.fetch.value(asset.dataUrl)).arrayBuffer());
      expected.set(asset.id, bytes);
      assert.deepEqual(imported.assets.get(asset.id), bytes, asset.id);
    }
    const restored = await restoreImportAssets(imported);
    assert.deepEqual(restored.warnings, []);
    assert.equal(validSiteDoc(restored.doc), true);
    assert.deepEqual(restored.doc.nodes, doc.nodes);
    assert.deepEqual(restored.doc.pages, doc.pages);
    assert.deepEqual(Object.keys(restored.doc.assets), Object.keys(doc.assets));
    assert.deepEqual(restored.doc.assets.bytes.zip, doc.assets.bytes.zip);
    for (const asset of Object.values(restored.doc.assets)) assert.deepEqual(stored.get(asset.path!), expected.get(asset.id), asset.id);
    const second = await archive(restored.doc);
    assert.deepEqual((await parseSiteImport(second, "zip")).assets, expected);
    const zip = await ZipArchive.open(second);
    assert.deepEqual(await zip.file("byte-roundtrip/assets/_imports/original/nested/payload.bin")!.bytes(), expected.get("bytes"));
    assert.deepEqual(doc, before);
  } finally {
    URL.createObjectURL = createUrl;
    for (const key of ["document", "fetch"]) {
      if (globals[key]) Object.defineProperty(globalThis, key, globals[key]);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
});

describe("asset-confirmation", () => {
  before(() => {
    useEditor.setState({
      breakpoint: "base", customWidth: null, styleState: "default", mode: "design",
      pageTheme: "light", selection: null, selectedIds: [], editingComponentId: null, scriptEditor: null,
    });
  });
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
        card.props.children.find((e: any) => e?.props?.["data-tip"] === "Delete").props.onClick();
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
  escapedBackground: (d) => { d.nodes.image.styles = { base: { hover: { backgroundImage: `url("\\2f ${assetSrc(candidate).slice(1)}")` } } }; },
  escapedCustomCss: (d) => { d.nodes.image.customCss = `background-image: url("\\2f ${assetSrc(candidate).slice(1)}&v=1");`; },
  escapedPageBackground: (d) => { d.pages.p.bodyStyles = { sm: { default: { backgroundImage: `url("\\2f ${assetSrc(candidate).slice(1)}")` } } }; },
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

test("unused cleanup checks all removed files in one browser scan bound to the original site", async t => {
  const previous = globalThis.window;
  const indexedDB = fakeIndexedDB();
  const location = { pathname: "/sites/original" };
  globalThis.window = { indexedDB, location } as Window & typeof globalThis;
  const f = fixture();
  try {
    const opens = t.mock.method(indexedDB, "open");
    // A copied URL in HTML can reference the file without a library record in this site.
    const unrelatedUrl = new URL(assetSrc(spare), "https://synthetic.test");
    unrelatedUrl.searchParams.set("path", spare.path + ".backup");
    const markup = `<img src="${assetSrc(candidate)}"><img src="${unrelatedUrl.pathname + unrelatedUrl.search}">`;
    await createBrowserDoc("other", JSON.stringify({ pages: { main: { rawHtml: markup } } }));
    await createBrowserDoc("original", JSON.stringify({ assets: { spare } }));
    const db = opens.mock.calls[0].result!.result;
    const transaction = db.transaction.bind(db);
    const scans = t.mock.method(db, "transaction", (...args: Parameters<typeof transaction>) => {
      location.pathname = "/sites/other";
      return transaction(...args);
    });
    const requests: (string | null)[][] = [];
    globalThis.fetch = async url => {
      const params = new URL(String(url), "https://synthetic.test").searchParams;
      requests.push([params.get("site"), params.get("path"), params.get("browserReferenced")]);
      return Response.json({ ok: true });
    };
    f.begin();
    await f.finish();
    assert.deepEqual(requests, [["original", candidate.path, "1"], ["original", spare.path, null]]);
    assert.equal(scans.mock.callCount(), 1);
  } finally { globalThis.window = previous; f.close(); }
});

test("single asset deletion prunes page htmlZip.assetIds, resetDoc bumps docEditRevision, and isEscapeKey ignores IME", async () => {
  const { validSiteDoc } = await import("../lib/doc-tree");
  const { isComposingKey, isEscapeKey } = await import("../lib/keys");
  const doc = assetConfirmationDoc();
  doc.pages.p.htmlZip = { path: "index.html", assetIds: [candidate.id, spare.id] };
  const f = fixture(doc);
  try {
    f.begin(true);
    await f.finish();
    assert.deepEqual(state().doc.pages.p.htmlZip?.assetIds, [spare.id]);
    assert.equal(validSiteDoc(state().doc), true);
    const beforeRev = state().docEditRevision;
    state().resetDoc();
    assert.equal(state().docEditRevision, beforeRev + 1);
  } finally { f.close(); }

  assert.equal(isComposingKey({ isComposing: true }), true);
  assert.equal(isComposingKey({ nativeEvent: { keyCode: 229 } }), true);
  assert.equal(isEscapeKey({ key: "Escape", isComposing: true }), false);
  assert.equal(isEscapeKey({ key: "Escape", nativeEvent: { keyCode: 229 } }), false);
  assert.equal(isEscapeKey({ key: "Escape", isComposing: false, keyCode: 27 }), true);
});
});

describe("asset-download", () => {
  before(() => {
    useEditor.setState({
      breakpoint: "base", customWidth: null, styleState: "default", mode: "design",
      pageTheme: "light", selection: null, selectedIds: [], editingComponentId: null, scriptEditor: null,
    });
  });
const tick = () => new Promise((resolve) => setImmediate(resolve));
const failure = "Could not download the asset.";

function browser() {
  const originals = Object.getOwnPropertyDescriptors(globalThis);
  const create = URL.createObjectURL, revoke = URL.revokeObjectURL;
  const blobs: Blob[] = [], saved: { href: string; download: string }[] = [], opened: unknown[][] = [], revoked: string[] = [];
  const timers: (() => void)[] = [];
  Object.assign(globalThis, {
    HTMLElement: class {},
    window: { location: { pathname: "/sites/original" }, addEventListener() {}, removeEventListener() {}, open: (...args: unknown[]) => { opened.push(args); } },
    document: { createElement: () => ({ href: "", download: "", click() { saved.push({ href: this.href, download: this.download }); } }) },
    setTimeout: (run: () => void, delay: number) => { assert.equal(delay, 1000); timers.push(run); return 1; },
  });
  URL.createObjectURL = (blob) => { blobs.push(blob as Blob); return `blob:download-${blobs.length}`; };
  URL.revokeObjectURL = (url) => { revoked.push(url); };
  return {
    blobs, saved, opened, revoked, timers,
    close() {
      for (const key of ["window", "document", "fetch", "setTimeout", "HTMLElement"]) {
        if (originals[key]) Object.defineProperty(globalThis, key, originals[key]);
        else Reflect.deleteProperty(globalThis, key);
      }
      URL.createObjectURL = create; URL.revokeObjectURL = revoke;
    },
  };
}

for (const status of [403, 404, 500, 502]) {
  test(`HTTP ${status} never saves error bytes or falls back to navigation`, async () => {
    const b = browser();
    try {
      let read = false;
      globalThis.fetch = async () => ({ ok: false, status, blob: async () => { read = true; return new Blob(["error"]); } }) as Response;
      await assert.rejects(downloadAsset(candidate), { message: failure });
      assert.equal(read, false);
      assert.deepEqual([b.saved, b.blobs, b.opened], [[], [], []]);
    } finally { b.close(); }
  });
}

for (const embedded of [false, true]) {
  test(`${embedded ? "data URL" : "remote"} download preserves bytes and filename, with deferred cleanup`, async () => {
    const b = browser();
    try {
      const asset = embedded ? { ...candidate, path: undefined, dataUrl: "data:image/png;base64,AAEC/w==" } : candidate;
      const bytes = new Uint8Array([0, 1, 2, 255]);
      const nativeFetch = globalThis.fetch;
      globalThis.fetch = async (src) => {
        assert.equal(src, assetSrc(asset));
        return embedded ? nativeFetch(src) : new Response(bytes, { headers: { "content-type": "image/png" } });
      };
      await downloadAsset(asset);
      assert.deepEqual(new Uint8Array(await b.blobs[0].arrayBuffer()), bytes);
      assert.equal(b.blobs[0].type, "image/png");
      assert.deepEqual(b.saved, [{ href: "blob:download-1", download: candidate.name }]);
      assert.deepEqual(b.opened, []);
      assert.deepEqual(b.revoked, []);
      b.timers.forEach((run) => run());
      assert.deepEqual(b.revoked, ["blob:download-1"]);
    } finally { b.close(); }
  });
}

test("network/CORS rejection retains source navigation fallback", async () => {
  const b = browser();
  try {
    globalThis.fetch = async () => { throw new TypeError("Failed to fetch"); };
    await downloadAsset(candidate);
    assert.deepEqual(b.opened, [[assetSrc(candidate), "_blank", "noopener"]]);
    assert.deepEqual(b.saved, []);
  } finally { b.close(); }
});

test("interrupted response bodies reject without navigation or corrupted files", async () => {
  const b = browser();
  try {
    globalThis.fetch = async () => ({ ok: true, blob: async () => { throw new Error("interrupted"); } }) as Response;
    await assert.rejects(downloadAsset(candidate), /interrupted/);
    assert.deepEqual([b.saved, b.blobs, b.opened], [[], [], []]);
  } finally { b.close(); }
});

test("click failure still schedules object URL cleanup", async () => {
  const b = browser();
  try {
    globalThis.fetch = async () => new Response("bytes");
    globalThis.document.createElement = (() => ({ click() { throw new Error("click failed"); } })) as any;
    await assert.rejects(downloadAsset(candidate), /click failed/);
    b.timers.forEach((run) => run());
    assert.deepEqual(b.revoked, ["blob:download-1"]);
    assert.deepEqual(b.opened, []);
  } finally { b.close(); }
});

function panel() {
  const b = browser();
  useEditor.getState().replaceDoc(assetConfirmationDoc());
  const ui = assetConfirmationCallbacks();
  const requests: ((response: Response) => void)[] = [];
  globalThis.fetch = () => new Promise<Response>((resolve) => requests.push(resolve));
  return {
    ...b, ui, requests,
    click(id = candidate.id) {
      const card = ui.render().find((e) => e.props?.["data-asset-id"] === id);
      card.props.children.find((e: any) => e?.props?.["data-tip"] === "Download").props.onClick();
    },
    errors: () => ui.render().filter((e) => e.props?.className === "hint" && e.props.children === failure),
    close() { ui.unmount(); b.close(); },
  };
}

test("actual download handler reports failure, then clears it on a successful retry", async () => {
  const p = panel();
  try {
    p.click(); p.requests[0](new Response("missing", { status: 404 })); await tick();
    assert.equal(p.errors().length, 1); assert.equal(p.saved.length, 0);
    p.click(); assert.equal(p.errors().length, 0);
    p.requests[1](new Response("bytes")); await tick();
    assert.equal(p.errors().length, 0); assert.equal(p.saved.length, 1);
  } finally { p.close(); }
});

for (const change of ["newer-download", "newer-upload", "unmount", "replace-doc", "undo-redo", "site", "replace-asset", "remove-asset"] as const) {
  test(`pending download failure is ignored after ${change}`, async () => {
    const p = panel();
    try {
      const s = useEditor.getState;
      s().updateNode("media", { name: "Undoable" });
      p.click();
      if (change === "newer-download") { p.click(spare.id); p.requests[1](new Response("bytes")); await tick(); }
      if (change === "newer-upload") {
        p.ui.render().find((e) => e.type === "input" && e.props.type === "file").props.onChange({ target: { files: [{ type: "text/plain" }], value: "" } });
      }
      if (change === "unmount") p.ui.unmount();
      if (change === "replace-doc") s().replaceDoc(structuredClone(s().doc));
      if (change === "undo-redo") { s().undo(); s().redo(); }
      if (change === "site") window.location.pathname = "/sites/other";
      if (change === "replace-asset" || change === "remove-asset") {
        const d = structuredClone(s().doc);
        if (change === "replace-asset") d.assets[candidate.id].path = "assets/new.png";
        else delete d.assets[candidate.id];
        s().applyRemoteDoc(d);
      }
      p.requests[0](new Response("missing", { status: 404 })); await tick();
      assert.equal(p.errors().length, 0);
    } finally { p.close(); }
  });
}
});

describe("asset-gc", () => {
const day = 86_400_000;
const now = Date.UTC(2026, 10, 10);
const key = (ageDays: number, suffix = "image.png") =>
  `assets/${(now - ageDays * day).toString(36)}abcdef-${suffix}`;

test("asset GC finds paths in nested doc HTML/CSS and encoded image URLs", () => {
  const a = key(60), b = key(45), c = key(90);
  const raw = JSON.stringify({
    assets: { first: { path: a } },
    nodes: { one: { styles: `url(/api/assets/file?path=${encodeURIComponent(b)})` } },
    customHtml: `<img src="/api/assets/file?path=${encodeURIComponent(encodeURIComponent(c))}">`,
  });
  const refs = extractAssetReferences(raw);
  // URL の中のたまたまの区切り（/api/assets/file の assets/file など）を控えめに残しても害は無いが、
  // 実際の参照を失うのは害がある。
  for (const path of [a, b, c]) assert.equal(refs.has(path), true);
  assert.throws(() => extractAssetReferences("{broken"));
});

test("asset GC retains encoded URL paths next to malformed percent escapes", () => {
  const path = key(60);
  const escaped = encodeURIComponent(path).replaceAll("assets", "%61%73%73%65%74%73");
  for (const extra of ["100%", "%zz", "%FF"]) {
    const url = `/api/assets/file?path=${escaped}&note=${extra}`;
    assert.equal(new URL(url, "https://example.com").searchParams.get("path"), path);
    const raw = JSON.stringify({ rawHtml: `<img src="${url}">` });
    assert.equal(extractAssetReferences(raw).has(path), true);
  }
});

const htmlAssetForms = (path: string) => {
  const filename = path.slice("assets/".length);
  return [
    `<img src="/api/assets/file?path=&#97;ssets/${filename}">`,
    `<img src="/api/assets/file?path=&#97ssets/${filename}">`,
    `<img src="/api/assets/file?path=&#x61;ssets/${filename}">`,
    `<img src="/api/assets/file?path=&#X61ssets/${filename}">`,
    `<img src="/api/assets/file?path=assets&sol;${filename.replaceAll("_fj.", "&lowbar;&fjlig;&period;")}">`,
    `<img src="/api/assets/file?path=&#37;61ssets%2F${filename}&amp;note=100%">`,
    `<img src="/api/assets/file?path=ass&NewLine;ets/${filename}">`,
    `<div style="background-image:url('/api/assets/file?path=&#92;61 ssets&#92;2f ${filename}')"></div>`,
  ];
};

test("asset GC retains HTML character references accepted by the HTML and URL parsers", () => {
  const path = key(60, "photo_fj.png");
  for (const html of htmlAssetForms(path)) {
    const fragment = parseFragment(html);
    const element = fragment.childNodes[0];
    assert.ok("attrs" in element);
    const source = element.attrs.find(attr => attr.name === "src")?.value;
    const style = element.attrs.find(attr => attr.name === "style")?.value;
    const url = source ?? cssAssetReferences(style!)[0]?.url;
    assert.equal(new URL(url!, "https://example.com").searchParams.get("path"), path, html);
    const doc = createInitialDoc();
    doc.pages[doc.pageOrder[0]].rawHtml = html;
    assert.equal(validSiteDoc(doc), true);
    assert.equal(extractAssetReferences(JSON.stringify(doc)).has(path), true, html);
  }
});

test("asset GC retains CSS escapes and still scans original literal strings", () => {
  const path = key(60);
  const filename = path.slice("assets/".length);
  const css = `background-image:url("/api/assets/file?path=\\61 ssets\\2f ${filename}")`;
  const url = cssAssetReferences(css)[0].url;
  assert.equal(new URL(url, "https://example.com").searchParams.get("path"), path);
  assert.equal(extractAssetReferences(JSON.stringify({ styles: { backgroundImage: css } })).has(path), true);
  const literal = `${path}\\61.png`;
  assert.equal(extractAssetReferences(JSON.stringify({ text: literal })).has(path), true);
});

test("asset GC handles wide JSON arrays and objects without argument-count overflows", () => {
  const path = key(60);
  const values = Array(150_000).fill(null);
  values[values.length - 1] = path;
  assert.equal(extractAssetReferences(JSON.stringify({ values })).has(path), true);
  const object = Object.fromEntries(values.map((value, index) => [String(index), value]));
  assert.equal(extractAssetReferences(JSON.stringify(object)).has(path), true);
});

test("asset GC requires both unreferenced and upload age to exceed grace", () => {
  const old = key(100), recent = key(4), used = key(80);
  const unknown = "assets/preexisting.png";
  const candidates = new Map([old, recent, used, unknown].map(path =>
    [path, { path, firstUnreferencedAt: now - 50 * day }] as const));
  const planned = planAssetGc({
    kvKeys: [old, recent, used, unknown].map(name => ({ name })),
    referenced: new Set([used]),
    candidates, now, graceMs: 30 * day, maxDeletes: 500,
  });
  assert.deepEqual(planned.eligible.map(c => c.path), [old]);
  assert.deepEqual(planned.release, [used]);
  assert.equal(assetUploadedAt(unknown), null);
  assert.equal(assetUploadedAt(old), now - 100 * day);
});

test("GC candidate reset, missing KV cleanup, grace period, and maximum delete cap", () => {
  const a = key(90, "a.png"), b = key(100, "b.png"), missing = key(110, "missing.png");
  const candidates = new Map([a, b, missing].map(path =>
    [path, { path, firstUnreferencedAt: now - 31 * day }] as const));
  const plan = planAssetGc({
    kvKeys: [{ name: a }, { name: b }, { name: key(1) }],
    referenced: new Set<string>(), candidates, now, graceMs: 30 * day, maxDeletes: 1,
  });
  assert.equal(plan.eligible.length, 1);
  assert.equal(plan.remainingEligible, 1);
  assert.ok(plan.release.includes(missing));
  assert.equal(plan.add.length, 1);
  const reset = planAssetGc({
    kvKeys: [{ name: a }], referenced: new Set([a]),
    candidates, now, graceMs: 30 * day, maxDeletes: 10,
  });
  assert.deepEqual(reset.eligible, []);
  assert.ok(reset.release.includes(a));
});

function fixture(roomRefs: (key: string) => Promise<string[]>, keys: string[]) {
  const sql = new DatabaseSync(":memory:");
  sql.exec(`
    CREATE TABLE sites(id TEXT PRIMARY KEY);
    CREATE TABLE site_document_rooms(site_id TEXT PRIMARY KEY,room_key TEXT NOT NULL);
    CREATE TABLE asset_gc_state(
      id INTEGER PRIMARY KEY,scan_cursor TEXT,scan_started_at INTEGER,
      lease_until INTEGER NOT NULL DEFAULT 0,lease_token TEXT
    );
    INSERT INTO asset_gc_state(id) VALUES(1);
    CREATE TABLE asset_gc_candidates(
      path TEXT PRIMARY KEY,first_unreferenced_at INTEGER NOT NULL,last_seen_at INTEGER NOT NULL,bytes INTEGER
    );
    CREATE TABLE asset_gc_runs(
      id INTEGER PRIMARY KEY AUTOINCREMENT,started_at INTEGER NOT NULL,finished_at INTEGER,
      status TEXT NOT NULL,kv_keys INTEGER NOT NULL DEFAULT 0,referenced INTEGER NOT NULL DEFAULT 0,
      candidates INTEGER NOT NULL DEFAULT 0,deleted INTEGER NOT NULL DEFAULT 0,
      deleted_bytes INTEGER NOT NULL DEFAULT 0,dry_run INTEGER NOT NULL DEFAULT 1,error TEXT
    );
    CREATE TABLE asset_objects(
      path TEXT PRIMARY KEY,bytes INTEGER,uploaded_at INTEGER NOT NULL,last_seen_at INTEGER NOT NULL
    );
    CREATE TABLE asset_ledger_state(id INTEGER PRIMARY KEY CHECK(id=1),created_at INTEGER NOT NULL,complete_at INTEGER);
    CREATE TABLE site_asset_uploads(site_id TEXT NOT NULL,path TEXT NOT NULL,PRIMARY KEY(site_id,path));
    INSERT INTO asset_ledger_state(id,created_at) VALUES(1,0);
    INSERT INTO sites(id) VALUES('site1');
    INSERT INTO site_document_rooms(site_id,room_key) VALUES('site1','room1');
  `);
  const execute = async (input: string | { sql: string; args: (string | number | null)[] }) => {
    const query = typeof input === "string" ? input : input.sql;
    const args = typeof input === "string" ? [] : input.args;
    const stmt = sql.prepare(query);
    if (stmt.columns().length) return { rows: stmt.all(...args) as Record<string, unknown>[], rowsAffected: 0 };
    return { rows: [] as Record<string, unknown>[], rowsAffected: Number(stmt.run(...args).changes) };
  };
  const db: Db = {
    backend: "d1", execute,
    async batch(stmts) {
      sql.exec("BEGIN");
      try {
        const results = [];
        for (const s of stmts) results.push(await execute(s));
        sql.exec("COMMIT");
        return results;
      } catch (error) {
        sql.exec("ROLLBACK");
        throw error;
      }
    },
  };
  let lists = 0, deletes = 0, failDeleteAt = Number.POSITIVE_INFINITY;
  const stored = new Set(keys);
  const kv = {
    async list() {
      lists++;
      return { keys: [...stored].map(name => ({ name, metadata: { bytes: 17 } })), list_complete: true };
    },
    async delete(path: string) {
      deletes++;
      if (deletes === failDeleteAt) throw new Error("Simulated KV failure");
      stored.delete(path);
    },
  } as unknown as KVLikeNamespace;
  const rooms: AssetGcDocumentNamespace = {
    idFromName: name => name,
    get(id) { return { gcAssetReferences: () => roomRefs(String(id)) }; },
  };
  return {
    db, kv, rooms, sql, lists: () => lists, deletes: () => deletes,
    stored, failDeleteAt: (n: number) => { failDeleteAt = n; },
  };
}

test("GC dry-run retains an asset referenced by a current document", async () => {
  const path = key(100);
  const f = fixture(async () => [path], [path]);
  try {
    f.sql.prepare("INSERT INTO asset_gc_candidates VALUES(?,?,?,?)")
      .run(path, now - 9 * day, now - day, 17);
    const report = await runAssetGc({ db: f.db, kv: f.kv, rooms: f.rooms, now });
    assert.deepEqual(report.potentialDeletePaths, []);
    assert.equal(report.candidates, 0);
    assert.equal(f.deletes(), 0);
    assert.equal(Number(f.sql.prepare("SELECT deleted FROM asset_gc_runs").get()?.deleted), 0);
  } finally { f.sql.close(); }
});

test("active GC keeps a referenced candidate when URL text contains an unrelated malformed escape", async () => {
  const path = key(100);
  const encoded = encodeURIComponent(path).replaceAll("assets", "%61ssets");
  const raw = JSON.stringify({ rawHtml: `<img src="/api/assets/file?path=${encoded}&note=100%">` });
  const f = fixture(async () => [...extractAssetReferences(raw)], [path]);
  try {
    f.sql.prepare("INSERT INTO asset_gc_candidates VALUES(?,?,?,?)")
      .run(path, now - 9 * day, now - day, 17);
    const report = await runAssetGc({ db: f.db, kv: f.kv, rooms: f.rooms, now, dryRun: false });
    assert.equal(report.deleted, 0);
    assert.equal(f.deletes(), 0);
    assert.ok(f.stored.has(path));
    assert.equal(report.candidates, 0);
  } finally { f.sql.close(); }
});

test("active GC protects current HTML references after character-reference decoding", async () => {
  const path = key(100, "photo_fj.png");
  for (const html of htmlAssetForms(path)) {
    const doc = createInitialDoc();
    doc.pages[doc.pageOrder[0]].rawHtml = html;
    const f = fixture(async () => [...extractAssetReferences(JSON.stringify(doc))], [path]);
    try {
      f.sql.prepare("INSERT INTO asset_gc_candidates VALUES(?,?,?,?)")
        .run(path, now - 9 * day, now - day, 17);
      const report = await runAssetGc({ db: f.db, kv: f.kv, rooms: f.rooms, now, dryRun: false });
      assert.equal(report.deleted, 0, html);
      assert.equal(f.deletes(), 0);
      assert.ok(f.stored.has(path));
      assert.equal(report.candidates, 0);
    } finally { f.sql.close(); }
  }
});

test("weekly discovery aborts before KV listing if a site cannot be read", async () => {
  const f = fixture(async () => { throw new Error("Current doc unreadable"); }, [key(100)]);
  try {
    await assert.rejects(runAssetGc({ db: f.db, kv: f.kv, rooms: f.rooms, now,
      discoverUntracked: true }));
    assert.equal(f.lists(), 0);
    assert.equal(f.deletes(), 0);
    assert.equal(Number(f.sql.prepare("SELECT count(*) AS n FROM asset_gc_candidates").get()?.n), 0);
    assert.equal(f.sql.prepare("SELECT status FROM asset_gc_runs").get()?.status, "aborted");
  } finally { f.sql.close(); }
});

test("mature candidates appear in dry-run without being deleted", async () => {
  const path = key(100);
  const f = fixture(async () => [], [path]);
  try {
    f.sql.prepare("INSERT INTO asset_gc_candidates VALUES(?,?,?,?)")
      .run(path, now - 40 * day, now - day, 17);
    const report = await runAssetGc({ db: f.db, kv: f.kv, rooms: f.rooms, now });
    assert.deepEqual(report.potentialDeletePaths, [path]);
    assert.equal(report.potentialDeleteBytesKnown, 17);
    assert.equal(report.sweepSupported, true);
    assert.equal(f.deletes(), 0);
  } finally { f.sql.close(); }
});

test("seven days after becoming unreferenced, active GC deletes a mature KV key", async () => {
  const path = key(30);
  const f = fixture(async () => [], [path]);
  try {
    f.sql.prepare("INSERT INTO asset_gc_candidates VALUES(?,?,?,?)")
      .run(path, now - 8 * day, now - day, 17);
    f.sql.prepare("INSERT INTO site_asset_uploads VALUES(?,?)").run("site1", path);
    const report = await runAssetGc({ db: f.db, kv: f.kv, rooms: f.rooms, now, dryRun: false });
    assert.equal(report.deleted, 1);
    assert.equal(report.deletedBytesKnown, 17);
    assert.deepEqual(report.deletedPaths, [path]);
    assert.equal(report.candidates, 0);
    assert.equal(f.stored.has(path), false);
    assert.equal(f.sql.prepare("SELECT count(*) AS n FROM site_asset_uploads WHERE path=?").get(path)?.n, 0);
    assert.equal(f.sql.prepare("SELECT deleted FROM asset_gc_runs").get()?.deleted, 1);
    assert.equal(f.sql.prepare("SELECT dry_run FROM asset_gc_runs").get()?.dry_run, 0);
  } finally { f.sql.close(); }
});

test("recent uploads and newly unreferenced assets are never deleted", async () => {
  const recent = key(2), old = key(100);
  const f = fixture(async () => [], [recent, old]);
  try {
    f.sql.prepare("INSERT INTO asset_gc_candidates VALUES(?,?,?,?)")
      .run(recent, now - 10 * day, now - day, 17);
    f.sql.prepare("INSERT INTO asset_gc_candidates VALUES(?,?,?,?)")
      .run(old, now - 6 * day, now - day, 17);
    const report = await runAssetGc({ db: f.db, kv: f.kv, rooms: f.rooms, now, dryRun: false });
    assert.equal(report.deleted, 0);
    assert.deepEqual([...f.stored].sort(), [recent, old].sort());
  } finally { f.sql.close(); }
});

test("a newly added current-document reference cancels deletion during final recheck", async () => {
  const path = key(100);
  let reads = 0;
  const f = fixture(async () => ++reads === 1 ? [] : [path], [path]);
  try {
    f.sql.prepare("INSERT INTO asset_gc_candidates VALUES(?,?,?,?)")
      .run(path, now - 9 * day, now - day, 17);
    const report = await runAssetGc({ db: f.db, kv: f.kv, rooms: f.rooms, now, dryRun: false });
    assert.equal(reads, 2);
    assert.equal(report.deleted, 0);
    assert.equal(f.deletes(), 0);
    assert.ok(f.stored.has(path));
    assert.equal(f.sql.prepare("SELECT count(*) AS n FROM asset_gc_candidates").get()?.n, 0);
  } finally { f.sql.close(); }
});

test("failure to inspect any current doc during final recheck aborts before deleting", async () => {
  const path = key(100);
  let reads = 0;
  const f = fixture(async () => {
    if (++reads === 2) throw new Error("DO unavailable");
    return [];
  }, [path]);
  try {
    f.sql.prepare("INSERT INTO asset_gc_candidates VALUES(?,?,?,?)")
      .run(path, now - 9 * day, now - day, 17);
    await assert.rejects(runAssetGc({ db: f.db, kv: f.kv, rooms: f.rooms, now, dryRun: false }));
    assert.equal(f.deletes(), 0);
    assert.equal(f.sql.prepare("SELECT status FROM asset_gc_runs").get()?.status, "aborted");
  } finally { f.sql.close(); }
});

test("incomplete weekly KV inventory does not block daily expiry cleanup", async () => {
  const path = key(100);
  const f = fixture(async () => [], [path]);
  try {
    f.sql.prepare("INSERT INTO asset_gc_candidates VALUES(?,?,?,?)")
      .run(path, now - 9 * day, now - day, 17);
    let pageNumber = 0;
    f.kv.list = async () => ({
      keys: pageNumber++ === 0 ? [{ name: path, metadata: { bytes: 17 } }] : [],
      list_complete: false, cursor: "cursor-" + pageNumber,
    });
    const report = await runAssetGc({ db: f.db, kv: f.kv, rooms: f.rooms, now,
      dryRun: false, discoverUntracked: true });
    assert.equal(report.scanComplete, false);
    assert.equal(report.deleted, 1);
    assert.equal(f.stored.has(path), false);
  } finally { f.sql.close(); }
});

test("configured delete cap leaves other eligible keys for later GC runs", async () => {
  const keys = [key(100, "one.png"), key(100, "two.png"), key(100, "three.png")];
  const f = fixture(async () => [], keys);
  try {
    for (const path of keys) f.sql.prepare("INSERT INTO asset_gc_candidates VALUES(?,?,?,?)")
      .run(path, now - 9 * day, now - day, 17);
    const report = await runAssetGc({ db: f.db, kv: f.kv, rooms: f.rooms, now, dryRun: false, maxDeletes: 1 });
    assert.equal(report.deleted, 1);
    assert.equal(f.stored.size, 2);
    assert.equal(report.candidates, 2);
  } finally { f.sql.close(); }
});

test("one run deletes more than ten eligible keys when the budget allows", async () => {
  const keys = Array.from({ length: 40 }, (_, i) => key(100, `bulk-${i}.png`));
  const f = fixture(async () => [], keys);
  try {
    for (const path of keys) f.sql.prepare("INSERT INTO asset_gc_candidates VALUES(?,?,?,?)")
      .run(path, now - 9 * day, now - day, 17);
    const report = await runAssetGc({ db: f.db, kv: f.kv, rooms: f.rooms, now, dryRun: false });
    assert.equal(report.deleted, 40);
    assert.equal(f.stored.size, 0);
    assert.equal(report.candidates, 0);
  } finally { f.sql.close(); }
});

test("deletion stops inside the Workers Free subrequest limit when many sites are scanned", async () => {
  const keys = Array.from({ length: 300 }, (_, i) => key(100, `many-${i}.png`));
  const f = fixture(async () => [], keys);
  try {
    const sites = 400;
    for (let i = 2; i <= sites; i++) {
      f.sql.prepare("INSERT INTO sites(id) VALUES(?)").run(`site${i}`);
      f.sql.prepare("INSERT INTO site_document_rooms(site_id,room_key) VALUES(?,?)").run(`site${i}`, `room${i}`);
    }
    for (const path of keys) f.sql.prepare("INSERT INTO asset_gc_candidates VALUES(?,?,?,?)")
      .run(path, now - 9 * day, now - day, 17);
    let calls = 0;
    const db: Db = {
      backend: "d1",
      execute: (stmt) => { calls++; return f.db.execute(stmt); },
      batch: (stmts) => { calls++; return f.db.batch(stmts); },
    };
    const kv = { list: f.kv.list, delete: (path: string) => { calls++; return f.kv.delete(path); } };
    const rooms: AssetGcDocumentNamespace = {
      idFromName: name => name,
      get(id) { return { gcAssetReferences: () => { calls++; return f.rooms.get(id).gcAssetReferences(); } }; },
    };
    const report = await runAssetGc({ db, kv, rooms, now, dryRun: false });
    // 400 のサイトを2回すべて走査すると、削除できるのは一部だけになる。
    assert.ok(report.deleted > 0 && report.deleted < 300, `deleted ${report.deleted}`);
    assert.ok(calls <= 900, `used ${calls} Cloudflare-service calls`);
    assert.equal(f.stored.size, 300 - report.deleted);
    assert.equal(report.candidates, 300 - report.deleted);
  } finally { f.sql.close(); }
});

test("a failed KV delete records previously completed deletes and retains later candidates", async () => {
  const paths = [key(100, "first.png"), key(100, "second.png")];
  const f = fixture(async () => [], paths);
  f.failDeleteAt(2);
  try {
    for (const path of paths) f.sql.prepare("INSERT INTO asset_gc_candidates VALUES(?,?,?,?)")
      .run(path, now - 9 * day, now - day, 17);
    await assert.rejects(runAssetGc({ db: f.db, kv: f.kv, rooms: f.rooms, now, dryRun: false }));
    const run = f.sql.prepare("SELECT status,deleted,deleted_bytes FROM asset_gc_runs").get();
    assert.equal(run?.status, "failed");
    assert.equal(run?.deleted, 1);
    assert.equal(run?.deleted_bytes, 17);
    assert.equal(f.stored.size, 1);
  } finally { f.sql.close(); }
});
test("the image-delete event registers a candidate immediately without KV enumeration", async () => {
  const path = key(35);
  const f = fixture(async () => [], [path]);
  try {
    const inserted = await recordAssetGcCandidates(f.db, [path], now);
    assert.equal(inserted, 1);
    assert.equal(f.lists(), 0);
    const candidate = f.sql.prepare("SELECT first_unreferenced_at FROM asset_gc_candidates WHERE path=?").get(path);
    assert.equal(candidate?.first_unreferenced_at, now);
    const report = await runAssetGc({ db: f.db, kv: f.kv, rooms: f.rooms, now: now + 6 * day, dryRun: false });
    assert.equal(report.deleted, 0);
    assert.equal(f.lists(), 0, "daily expiry must never enumerate KV");
    assert.ok(f.stored.has(path));
  } finally { f.sql.close(); }
});

test("repeated image deletion resets the seven-day candidate clock", async () => {
  const path = key(50);
  const f = fixture(async () => [], [path]);
  try {
    await recordAssetGcCandidates(f.db, [path], now - 6 * day);
    await recordAssetGcCandidates(f.db, [path], now);
    const candidate = f.sql.prepare("SELECT first_unreferenced_at FROM asset_gc_candidates WHERE path=?").get(path);
    assert.equal(candidate?.first_unreferenced_at, now);
    const report = await runAssetGc({ db: f.db, kv: f.kv, rooms: f.rooms,
      now: now + 2 * day, dryRun: false });
    assert.equal(report.deleted, 0);
    assert.ok(f.stored.has(path));
    assert.equal(f.lists(), 0);
  } finally { f.sql.close(); }
});

test("weekly KV discovery finds missed orphan uploads without deleting anything", async () => {
  const path = key(100);
  const f = fixture(async () => [], [path]);
  try {
    const report = await runAssetGc({ db: f.db, kv: f.kv, rooms: f.rooms,
      now, discoverUntracked: true });
    assert.equal(report.kvKeysScanned, 1);
    assert.equal(report.scanComplete, true);
    assert.equal(report.deleted, 0);
    assert.equal(report.candidates, 1);
    const saved = f.sql.prepare("SELECT first_unreferenced_at FROM asset_gc_candidates WHERE path=?").get(path);
    assert.equal(saved?.first_unreferenced_at, now);
    await runAssetGc({ db: f.db, kv: f.kv, rooms: f.rooms,
      now: now + 8 * day, dryRun: false });
    assert.equal(f.deletes(), 1);
    assert.equal(f.lists(), 1, "daily expiry must not run KV.list");
    assert.equal(f.stored.size, 0);
  } finally { f.sql.close(); }
});

test("weekly inventory fills the storage ledger and GC deletes keep it in sync", async () => {
  const used = key(100, "used.png"), orphan = key(100, "orphan.png");
  const f = fixture(async () => [used], [used, orphan]);
  try {
    const row = f.sql.prepare("INSERT INTO asset_objects VALUES(?,?,?,?)");
    row.run(key(200, "vanished.png"), 5, now - 200 * day, now - 100 * day);
    // 走査の間にアップロードされた: KV の一覧には、まだ含まれていないことがある。
    row.run(key(0, "fresh.png"), 9, now + 1, now + 1);
    await runAssetGc({ db: f.db, kv: f.kv, rooms: f.rooms, now, discoverUntracked: true });
    const ledger = () => f.sql.prepare("SELECT path,bytes FROM asset_objects ORDER BY path").all()
      .map(r => [String(r.path), r.bytes]);
    assert.deepEqual(ledger(), [[key(0, "fresh.png"), 9], [orphan, 17], [used, 17]].sort());
    assert.equal(f.sql.prepare("SELECT complete_at FROM asset_ledger_state").get()?.complete_at, now);
    await runAssetGc({ db: f.db, kv: f.kv, rooms: f.rooms, now: now + 8 * day, dryRun: false });
    assert.equal(f.stored.has(orphan), false);
    assert.deepEqual(ledger(), [[key(0, "fresh.png"), 9], [used, 17]].sort());
  } finally { f.sql.close(); }
});

test("an inventory that began before the ledger existed does not mark it complete", async () => {
  const f = fixture(async () => [], [key(100)]);
  try {
    f.sql.prepare("UPDATE asset_ledger_state SET created_at=?").run(now + 1);
    await runAssetGc({ db: f.db, kv: f.kv, rooms: f.rooms, now, discoverUntracked: true });
    assert.equal(f.sql.prepare("SELECT complete_at FROM asset_ledger_state").get()?.complete_at, null);
    assert.equal(Number(f.sql.prepare("SELECT count(*) AS n FROM asset_objects").get()?.n), 1);
  } finally { f.sql.close(); }
});

test("weekly reconciliation preserves explicit delete-event age", async () => {
  const path = key(100);
  const f = fixture(async () => [], [path]);
  try {
    await recordAssetGcCandidates(f.db, [path], now - 4 * day);
    await runAssetGc({ db: f.db, kv: f.kv, rooms: f.rooms, now,
      discoverUntracked: true });
    const saved = f.sql.prepare("SELECT first_unreferenced_at FROM asset_gc_candidates WHERE path=?").get(path);
    assert.equal(saved?.first_unreferenced_at, now - 4 * day);
    assert.equal(f.stored.has(path), true);
  } finally { f.sql.close(); }
});

test("daily GC skips all site reads when no candidate is old enough", async () => {
  const f = fixture(async () => { throw new Error("DO unavailable"); }, [key(50)]);
  try {
    await recordAssetGcCandidates(f.db, [key(50)], now);
    const report = await runAssetGc({ db: f.db, kv: f.kv, rooms: f.rooms,
      now: now + day, dryRun: false });
    assert.equal(report.status, "ok");
    assert.equal(report.deleted, 0);
    assert.equal(f.lists(), 0);
    assert.equal(f.deletes(), 0);
  } finally { f.sql.close(); }
});

test("expired orphan from an explicit delete is protected by a different current site", async () => {
  const path = key(100);
  const f = fixture(async () => [path], [path]);
  try {
    await recordAssetGcCandidates(f.db, [path], now - 9 * day);
    const report = await runAssetGc({ db: f.db, kv: f.kv, rooms: f.rooms,
      now, dryRun: false });
    assert.equal(report.deleted, 0);
    assert.equal(report.candidates, 0);
    assert.equal(f.deletes(), 0);
    assert.ok(f.stored.has(path));
    assert.equal(f.lists(), 0);
  } finally { f.sql.close(); }
});
test("weekly inventory resumes its persisted KV cursor without nightly listing", async () => {
  const first = key(100, "first.png"), second = key(90, "second.png");
  const f = fixture(async () => [], [first, second]);
  let calls = 0;
  f.kv.list = async (options) => {
    calls++;
    if (!options.cursor) {
      return { keys: [{ name: first, metadata: { bytes: 10 } }],
        list_complete: false, cursor: "next" };
    }
    assert.equal(options.cursor, "next");
    return { keys: [{ name: second, metadata: { bytes: 20 } }],
      list_complete: true };
  };
  try {
    const one = await runAssetGc({ db: f.db, kv: f.kv, rooms: f.rooms,
      now, discoverUntracked: true });
    assert.equal(one.scanComplete, false);
    assert.equal(f.sql.prepare("SELECT scan_cursor FROM asset_gc_state").get()?.scan_cursor, "next");
    await runAssetGc({ db: f.db, kv: f.kv, rooms: f.rooms, now: now + day });
    assert.equal(calls, 1, "the nightly run must not advance the weekly KV cursor");
    const two = await runAssetGc({ db: f.db, kv: f.kv, rooms: f.rooms,
      now: now + 7 * day, discoverUntracked: true });
    assert.equal(two.scanComplete, true);
    assert.equal(calls, 2);
    assert.equal(f.sql.prepare("SELECT scan_cursor FROM asset_gc_state").get()?.scan_cursor, null);
    assert.equal(f.sql.prepare("SELECT count(*) AS n FROM asset_gc_candidates").get()?.n, 2);
  } finally { f.sql.close(); }
});
});

describe("asset-gc-route", () => {
class NextResponse extends Response {
  static json(body: unknown, init?: ResponseInit) {
    return new NextResponse(JSON.stringify(body), init);
  }
}

function assetDeleteRoute({ backend = "d1", configured = true, siteExists = true, browserReferenced = false, sqliteDb }:
  { backend?: "d1" | "sqlite"; configured?: boolean; siteExists?: boolean; browserReferenced?: boolean; sqliteDb?: Db } = {}) {
  const source = readFileSync(new URL("../app/api/assets/route.ts", import.meta.url), "utf8");
  const { code } = transformSync(source, { loader: "ts", format: "cjs", target: "es2022" });
  let registered = 0, deleted = 0, otherSiteReads = 0;
  const db = {
    backend,
    async execute(stmt: string | { sql: string; args: unknown[] }) {
      if (typeof stmt === "object" && stmt.sql.includes("SELECT 1 FROM sites")) {
        return { rows: siteExists ? [{ 1: 1 }] : [], rowsAffected: 0 };
      }
      if (typeof stmt === "object" && stmt.sql.includes("FROM docs")) otherSiteReads++;
      return { rows: [], rowsAffected: 0 };
    },
  };
  const stubs: Record<string, unknown> = {
    "next/server": { NextResponse },
    "../../../lib/unavailable": {
      dbUnavailable: async () => NextResponse.json({ error: "No DB" }, { status: 503 }),
      storeUnavailable: async () => NextResponse.json({ error: "No KV" }, { status: 503 }),
    },
    "../../../lib/i18n-server": { serverTr: async () => (message: string) => message },
    "../../../lib/server": { requireAuth: async () => null, sessionUser: async () => null },
    "../../../lib/site-access": { requireSiteAccess: async () => null },
    "../../../lib/site-asset-access": {
      siteHasAsset: async () => true,
      siteOwnsAssets: async (_db: unknown, _site: string, paths: string[]) => !paths.includes("assets/unowned.png"),
    },
    "../../../lib/site-model": { isSiteId: () => true },
    "../../../auth": { authConfigured: () => false },
    "../../../lib/allowlist": { allowedEmails: () => [] },
    "../../../lib/kv": { assetStore: () => ({ async delete() { deleted++; } }), MAX_ASSET_BYTES: 25 * 1024 * 1024 },
    "../../../lib/errors": { userMessage: (_e: unknown, fallback: string) => fallback },
    "../../../lib/db": { dbConfigured: () => configured, getDb: async () => sqliteDb ?? db },
    "../../../lib/asset-upload": { readAssetForm: async () => null },
    "../../../lib/site-server": { siteIdOf: async (id: string) => id },
    "../../../lib/site-document-service": { documentAssetReferences: async () => [] },
    "../../../lib/api-json": apiJson,
    "../../../lib/asset-ledger": {
      readAssetLedger: async () => null,
      recordUploadedAsset: async () => {},
    },
    "../../../lib/asset-gc": {
      recordAssetGcCandidates: async (_db: unknown, paths: string[]) => {
        assert.deepEqual(paths, ["assets/muhmi2o0abcdef-photo.png"]);
        registered++;
        return 1;
      },
    },
  };
  const mod = {
    exports: {} as {
      DELETE: (req: Request) => Promise<Response>;
      PATCH: (req: Request) => Promise<Response>;
    },
  };
  new Function("require", "module", "exports", code)(
    (id: string) => {
      if (!Object.hasOwn(stubs, id)) throw new Error("Unmocked import: " + id);
      return stubs[id];
    },
    mod, mod.exports,
  );
  const endpoint = "https://example.com/api/assets?site=s1&path=assets%2Fmuhmi2o0abcdef-photo.png"
    + (browserReferenced ? "&browserReferenced=1" : "");
  return {
    call: () => mod.exports.DELETE(new Request(endpoint, { method: "DELETE" })),
    patch: (body: unknown) => mod.exports.PATCH(new Request("https://example.com/api/assets", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })),
    registered: () => registered,
    deleted: () => deleted,
    otherSiteReads: () => otherSiteReads,
  };
}

test("Cloudflare asset deletion enqueues one candidate without scanning all sites or deleting KV", async () => {
  const f = assetDeleteRoute();
  const response = await f.call();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, kept: true, scheduled: true });
  assert.equal(f.registered(), 1);
  assert.equal(f.otherSiteReads(), 0);
  assert.equal(f.deleted(), 0);
});

test("Cloudflare deletion still enqueues when browser-only sites have references", async () => {
  const f = assetDeleteRoute({ browserReferenced: true });
  const response = await f.call();
  assert.equal(response.status, 200);
  assert.equal(f.registered(), 1);
  assert.equal(f.deleted(), 0);
});

test("a stale or deleted site cannot enqueue a candidate", async () => {
  const f = assetDeleteRoute({ siteExists: false });
  const response = await f.call();
  assert.equal(response.status, 404);
  assert.equal(f.registered(), 0);
  assert.equal(f.deleted(), 0);
});

test("Node/Docker retain a browser-only cross-site reference and do not delete the file", async () => {
  const f = assetDeleteRoute({ backend: "sqlite", browserReferenced: true });
  const response = await f.call();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, kept: true });
  assert.equal(f.deleted(), 0);
  assert.equal(f.registered(), 0);
  assert.equal(f.otherSiteReads(), 0);
});

test("Node/Docker continue their cross-site reference check on direct deletion", async () => {
  const f = assetDeleteRoute({ backend: "sqlite" });
  const response = await f.call();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(f.otherSiteReads(), 1);
  assert.equal(f.deleted(), 1);
  assert.equal(f.registered(), 0);
});

for (const browserReferenced of [true, false]) {
  test(`KV-only deletion ${browserReferenced ? "retains a file referenced by another browser site" : "deletes an unreferenced file"}`, async () => {
    const f = assetDeleteRoute({ configured: false, browserReferenced });
    const response = await f.call();
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), browserReferenced ? { ok: true, kept: true } : { ok: true });
    assert.equal(f.deleted(), browserReferenced ? 0 : 1);
    assert.equal(f.registered(), 0);
    assert.equal(f.otherSiteReads(), 0);
  });
}

test("Node/Docker retain files referenced only by another site's HTML or CSS, with exact path matching", async () => {
  const previous = process.env.TSUMU_DATA_DIR;
  const dir = mkdtempSync(join(tmpdir(), "tsumu-shared-asset-"));
  process.env.TSUMU_DATA_DIR = dir;
  try {
    const db = await getDbFromBinding(nodeDatabase()!);
    const path = "assets/muhmi2o0abcdef-photo.png";
    const url = "/api/assets/file?path=" + encodeURIComponent(path);
    await db.execute("INSERT INTO sites(id, name, branch, preview_branch, created_at, updated_at) VALUES ('other', 'Other', 'main', 'preview', 0, 0)");
    const original = createInitialDoc();
    original.assets.photo = { id: "photo", name: "photo.png", path, width: 4, height: 4 };
    await db.execute({ sql: "INSERT INTO docs VALUES ('s1', 1, 0, ?)", args: [JSON.stringify(original)] });
    for (const reference of ["html", "css", "library", "similar"] as const) {
      const doc = createInitialDoc();
      const page = doc.pages[doc.pageOrder[0]];
      if (reference === "html") page.rawHtml = `<img src="${url}">`;
      if (reference === "css") page.bodyStyles = { base: { default: { backgroundImage: `url('${url}#logo')` } } };
      if (reference === "library") doc.assets.photo = original.assets.photo;
      if (reference === "similar") page.rawHtml = `<img src="${url}.backup">`;
      await db.execute({ sql: "INSERT OR REPLACE INTO docs VALUES ('other', 1, 0, ?)", args: [JSON.stringify(doc)] });
      const f = assetDeleteRoute({ sqliteDb: db });
      const response = await f.call();
      assert.equal(response.status, 200);
      assert.equal(f.deleted(), reference === "similar" ? 1 : 0);
    }
  } finally {
    if (previous === undefined) delete process.env.TSUMU_DATA_DIR;
    else process.env.TSUMU_DATA_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("PATCH /api/assets transfers ownership, clears Trash candidates on D1, and rejects unowned assets", async () => {
  const sql = new DatabaseSync(":memory:");
  sql.exec(`
    CREATE TABLE sites(id TEXT PRIMARY KEY);
    CREATE TABLE site_asset_uploads(site_id TEXT NOT NULL,path TEXT NOT NULL,PRIMARY KEY(site_id,path));
    CREATE TABLE asset_gc_candidates(path TEXT PRIMARY KEY,first_unreferenced_at INTEGER NOT NULL,last_seen_at INTEGER NOT NULL,bytes INTEGER);
    CREATE TABLE asset_objects(path TEXT PRIMARY KEY,bytes INTEGER,uploaded_at INTEGER NOT NULL,last_seen_at INTEGER NOT NULL);
    INSERT INTO sites VALUES('source0001'),('dest000001');
    INSERT INTO site_asset_uploads VALUES('source0001','assets/muhmi2o0abcdef-photo.png');
    INSERT INTO asset_gc_candidates VALUES('assets/muhmi2o0abcdef-photo.png',1,1,64);
    INSERT INTO asset_objects VALUES('assets/muhmi2o0abcdef-photo.png',64,1,1);
  `);
  const execute = async (input: string | { sql: string; args: (string | number | null)[] }) => {
    const stmt = sql.prepare(typeof input === "string" ? input : input.sql);
    const args = typeof input === "string" ? [] : input.args;
    if (stmt.columns().length) return { rows: stmt.all(...args) as Record<string, unknown>[], rowsAffected: 0 };
    return { rows: [], rowsAffected: Number(stmt.run(...args).changes) };
  };
  const db: Db = { backend: "d1", execute, batch: async (stmts) => Promise.all(stmts.map(execute)) };
  try {
    const f = assetDeleteRoute({ sqliteDb: db });
    const rejected = await f.patch({ fromSite: "source0001", toSite: "dest000001", paths: ["assets/unowned.png"] });
    assert.equal(rejected.status, 404);
    const ok = await f.patch({
      fromSite: "source0001",
      toSite: "dest000001",
      paths: ["assets/muhmi2o0abcdef-photo.png"],
    });
    assert.equal(ok.status, 200);
    assert.deepEqual(
      sql.prepare("SELECT site_id FROM site_asset_uploads WHERE path=? ORDER BY site_id").all("assets/muhmi2o0abcdef-photo.png").map((r) => r.site_id),
      ["dest000001", "source0001"],
    );
    assert.equal(sql.prepare("SELECT count(*) AS n FROM asset_gc_candidates").get()?.n, 0);
  } finally {
    sql.close();
  }
});

test("persisted and exported asset URLs stay site-independent while runtime browser URLs include ?site=", () => {
  const dataUrl = "data:image/png;base64,iVBORw0KGgo=";
  const asset: Asset = { id: "hero", name: "hero.png", dataUrl, width: 8, height: 8 };
  const oldWin = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = { location: { pathname: "/sites/site123456" } };
  try {
    const doc = createInitialDoc();
    doc.assets.hero = asset;
    const img = makeImage();
    img.image = { src: "", alt: "Hero", width: 8, height: 8, assetId: "hero" };
    img.styles = { base: { default: { backgroundImage: `url("${dataUrl}")` } } };
    doc.nodes[img.id] = img;
    doc.pages[doc.pageOrder[0]].children.push(img.id);
    replaceEmbeddedAsset(doc, "hero", "assets/muhmi2o0abcdef-hero.png");

    const docUrl = assetDocUrl(doc.assets.hero);
    assert.equal(docUrl, "/api/assets/file?path=assets%2Fmuhmi2o0abcdef-hero.png");
    assert.equal(assetSrc(doc.assets.hero), docUrl + "&site=site123456");
    assert.equal(withSiteAssetUrl(docUrl), docUrl + "&site=site123456");
    assert.equal(nodeAssetSrc(doc.assets.hero), docUrl);
    assert.equal(img.image.src, docUrl);
    assert.equal(mediaSrc(doc, img.image), docUrl + "&site=site123456");
    assert.equal(img.styles.base?.default?.backgroundImage, `url("${docUrl}")`);

    const exported = generateExportProject(doc, "html");
    const html = exported.files["index.html"] ?? "";
    const css = exported.files["styles/site.css"] ?? "";
    assert.ok(!html.includes("/api/assets/file"), html);
    assert.ok(!css.includes("/api/assets/file"), css);
    assert.ok(html.includes("assets/hero.png"), html);
    assert.ok(css.includes("assets/hero.png"), css);
  } finally {
    (globalThis as { window?: unknown }).window = oldWin;
  }
});
});

describe("asset-ledger", () => {
function ledgerDb(backend: "d1" | "sqlite" = "d1") {
  const sql = new DatabaseSync(":memory:");
  sql.exec(`
    CREATE TABLE asset_gc_candidates(path TEXT PRIMARY KEY,first_unreferenced_at INTEGER NOT NULL,last_seen_at INTEGER NOT NULL,bytes INTEGER);
    CREATE TABLE asset_objects(path TEXT PRIMARY KEY,bytes INTEGER,uploaded_at INTEGER NOT NULL,last_seen_at INTEGER NOT NULL);
    CREATE TABLE asset_ledger_state(id INTEGER PRIMARY KEY CHECK(id=1),created_at INTEGER NOT NULL,complete_at INTEGER);
    CREATE TABLE site_asset_uploads(site_id TEXT NOT NULL,path TEXT NOT NULL,PRIMARY KEY(site_id,path));
    INSERT INTO asset_ledger_state(id,created_at) VALUES(1,0);
  `);
  const execute = async (input: string | { sql: string; args: (string | number | null)[] }) => {
    const stmt = sql.prepare(typeof input === "string" ? input : input.sql);
    const args = typeof input === "string" ? [] : input.args;
    if (stmt.columns().length) return { rows: stmt.all(...args) as Record<string, unknown>[], rowsAffected: 0 };
    return { rows: [], rowsAffected: Number(stmt.run(...args).changes) };
  };
  const db: Db = { backend, execute, batch: async (stmts) => Promise.all(stmts.map(execute)) };
  return { sql, db };
}

test("the ledger counts every stored file, including removed ones waiting for GC, while scoping unknownPaths per site", async () => {
  const { sql, db } = ledgerDb();
  try {
    await recordUploadedAsset(db, "assets/a.png", 100, 1);
    await recordUploadedAsset(db, "assets/b.png", 50, 2);
    sql.prepare("INSERT INTO asset_objects VALUES(?,?,?,?)").run("assets/old.png", null, 0, 0);
    sql.prepare("INSERT INTO asset_objects VALUES(?,?,?,?)").run("assets/other-site.png", null, 0, 0);
    sql.prepare("INSERT INTO site_asset_uploads VALUES(?,?)").run("site-a", "assets/old.png");
    sql.prepare("INSERT INTO site_asset_uploads VALUES(?,?)").run("site-b", "assets/other-site.png");
    sql.prepare("INSERT INTO asset_gc_candidates VALUES(?,?,?,?)").run("assets/b.png", 3, 3, 50);
    const ledger = await readAssetLedger(db);
    assert.deepEqual(ledger, {
      complete: false, count: 4, bytes: 150, unknownCount: 2,
      unknownPaths: ["assets/old.png", "assets/other-site.png"],
      pendingCount: 1, pendingBytes: 50,
    });
    const scoped = await readAssetLedger(db, { siteId: "site-a" });
    assert.deepEqual(scoped, {
      complete: false, count: 4, bytes: 150, unknownCount: 2,
      unknownPaths: ["assets/old.png"],
      pendingCount: 1, pendingBytes: 50,
    });
    sql.exec("UPDATE asset_ledger_state SET complete_at=10");
    assert.equal((await readAssetLedger(db))?.complete, true);
  } finally { sql.close(); }
});

test("ledger uses the Trash candidate size when the object inventory lacks bytes", async () => {
  const { sql, db } = ledgerDb();
  try {
    sql.prepare("INSERT INTO asset_objects VALUES(?,?,?,?)").run("assets/unknown.png", null, 0, 0);
    sql.prepare("INSERT INTO asset_gc_candidates VALUES(?,?,?,?)").run("assets/unknown.png", 1, 1, 2048);
    const result = await readAssetLedger(db);
    assert.deepEqual(result, {
      complete: false, count: 1, bytes: 2048, unknownCount: 0, unknownPaths: [],
      pendingCount: 1, pendingBytes: 2048,
    });
  } finally { sql.close(); }
});

test("Node/Docker have no ledger", async () => {
  const { sql, db } = ledgerDb("sqlite");
  try {
    await recordUploadedAsset(db, "assets/a.png", 100);
    assert.equal(Number(sql.prepare("SELECT count(*) AS n FROM asset_objects").get()?.n), 0);
    assert.equal(await readAssetLedger(db), null);
  } finally { sql.close(); }
});

const ledger = (over: object = {}) => ({
  complete: true, count: 3, bytes: 150, unknownCount: 2, unknownPaths: ["assets/old.png", "assets/gone.png"],
  pendingCount: 1, pendingBytes: 50, ...over,
});

test("a complete ledger is the meter, with unknown sizes filled from the open document", () => {
  const usage = computeStorageUsage({ ledger: ledger() }, [
    { path: "assets/a.png", bytes: 100 },
    { path: "assets/old.png", bytes: 30 },
  ]);
  assert.deepEqual(usage, { files: 3, bytes: 180, unknown: 1, exact: true, pendingCount: 1, pendingBytes: 50 });
});

test("an incomplete ledger falls back to counting files used by sites once each", () => {
  const usage = computeStorageUsage({
    ledger: ledger({ complete: false }),
    others: [{ path: "assets/shared.png", bytes: 10 }, { path: "assets/x.png", bytes: null }],
    pending: [{ path: "assets/shared.png", bytes: 10 }, { path: "assets/trash.png", bytes: 25 }],
  }, [{ path: "assets/shared.png", bytes: 10 }, { path: "assets/own.png", bytes: 5 }, {}]);
  assert.deepEqual(usage, { files: 4, bytes: 40, unknown: 1, exact: false, pendingCount: 2, pendingBytes: 35 });
});


test("pending assets contribute to fallback usage without duplicating referenced files", () => {
  const usage = computeStorageUsage({
    others: [{ path: "assets/shared.png", bytes: null }],
    pending: [{ path: "assets/shared.png", bytes: 4 }, { path: "assets/removed.png", bytes: null }],
  }, [{ path: "assets/own.png", bytes: 6 }]);
  assert.deepEqual(usage, {
    files: 3, bytes: 10, unknown: 1, exact: false, pendingCount: 2, pendingBytes: 4,
  });
});
});

describe("asset-library-history", () => {
  before(() => {
    useEditor.setState({
      breakpoint: "base", customWidth: null, styleState: "default", mode: "design",
      pageTheme: "light", selection: null, selectedIds: [], editingComponentId: null, scriptEditor: null,
    });
  });
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
});

describe("asset-pool-failure", () => {
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function timely<T>(pending: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([pending, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("failed asset work did not stop promptly")), 500);
    })]);
  } finally { clearTimeout(timer); }
}

test("a failed pool rejects even when a running callback never settles, without starting queued work", async () => {
  const first = deferred<void>(), second = deferred<void>();
  const failure = new Error("first asset failed");
  const started: number[] = [];
  let settled = false;
  const result = mapLimit([0, 1, 2, 3], 2, async item => {
    started.push(item);
    await (item === 0 ? first.promise : second.promise);
  }).then(() => { settled = true; return null; }, error => { settled = true; return error; });
  try {
    assert.deepEqual(started, [0, 1]);
    first.reject(failure);
    assert.equal(await timely(result), failure);
    assert.equal(settled, true, "an unresponsive sibling must not suppress a confirmed failure");
    second.resolve();
    await tick();
    assert.deepEqual(started, [0, 1], "queued callbacks must not start after failure");
  } finally {
    second.resolve();
    await result;
    await tick();
  }
});

for (const failure of [new Error("original failure"), undefined, null, 0]) {
  test(`a later worker failure preserves the first rejection (${String(failure)})`, async () => {
    const first = deferred<void>(), second = deferred<void>();
    const started: number[] = [];
    const result = mapLimit([0, 1, 2], 2, async item => {
      started.push(item);
      await (item === 0 ? first.promise : second.promise);
    }).then(() => ({ ok: true, error: null }), error => ({ ok: false, error }));
    first.reject(failure);
    await tick();
    second.reject(new Error("later failure"));
    assert.deepEqual(await result, { ok: false, error: failure });
    assert.deepEqual(started, [0, 1]);
  });
}

test("a synchronous callback failure does not launch more work", async () => {
  const failure = new Error("synchronous failure");
  const started: number[] = [];
  await assert.rejects(mapLimit([0, 1, 2], 2, item => {
    started.push(item);
    throw failure;
  }), error => error === failure);
  assert.deepEqual(started, [0]);
});

test("successful pools process every item once within their concurrency limit", async () => {
  for (const limit of [1, 3, 20]) {
    let active = 0, peak = 0;
    const completed: number[] = [];
    await mapLimit([0, 1, 2, 3, 4, 5, 6], limit, async item => {
      peak = Math.max(peak, ++active);
      await tick();
      completed.push(item);
      active--;
    });
    assert.deepEqual(completed.sort(), [0, 1, 2, 3, 4, 5, 6]);
    assert.equal(active, 0);
    assert.equal(peak, Math.min(limit, 7));
  }
  await mapLimit([], 6, async () => { assert.fail("empty pool called its callback"); });
});

for (const stalled of ["fetch", "body"] as const) test(`ZIP failure aborts a stalled ${stalled} and queued downloads, then a fresh export retains all assets`, { timeout: 10000 }, async () => {
  const doc = createInitialDoc();
  doc.siteName = "Pool regression";
  doc.assets = {};
  for (let i = 0; i < ASSET_FETCH_CONCURRENCY * 2; i++) {
    doc.assets[`asset-${i}`] = { id: `asset-${i}`, name: `asset-${i}.png`,
      path: `assets/asset-${i}.png`, mimeType: "image/png", width: 1, height: 1 };
  }
  const before = structuredClone(doc);
  const initialBatch = deferred<void>(), fail = deferred<Response>(), release = deferred<void>();
  const requests: string[] = [];
  const originalFetch = globalThis.fetch;
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL;
  const blobs: Blob[] = [];
  let clicks = 0, retry = false, aborted = 0;
  Object.defineProperty(globalThis, "document", { configurable: true, value: {
    createElement() { return { href: "", download: "", click() { clicks++; } }; },
  } });
  URL.createObjectURL = blob => { blobs.push(blob as Blob); return "blob:pool-test"; };
  URL.revokeObjectURL = () => {};
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    assert.match(url, /^\/api\/assets\/file\?path=/);
    requests.push(url);
    if (!retry) {
      if (requests.length === ASSET_FETCH_CONCURRENCY) initialBatch.resolve();
      if (requests.length === 1) return fail.promise;
      const signal = init?.signal;
      if (stalled === "fetch") {
        await new Promise<void>((resolve, reject) => {
          const onAbort = () => { aborted++; reject(signal!.reason); };
          signal?.addEventListener("abort", onAbort, { once: true });
          if (signal?.aborted) onAbort();
          release.promise.then(() => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
          });
        });
      } else {
        return new Response(new ReadableStream<Uint8Array>({
          start(controller) {
            const onAbort = () => { aborted++; controller.error(signal!.reason); };
            signal?.addEventListener("abort", onAbort, { once: true });
            if (signal?.aborted) onAbort();
            release.promise.then(() => {
              signal?.removeEventListener("abort", onAbort);
              if (signal?.aborted) return;
              controller.enqueue(new Uint8Array([0, 1, 255]));
              controller.close();
            });
          },
        }));
      }
    }
    return new Response(new Uint8Array([0, 1, 255]));
  };
  const result = exportProjectZip(doc).then(() => null, error => error);
  try {
    await initialBatch.promise;
    fail.resolve(new Response("unavailable", { status: 403 }));
    const error = await timely(result);
    await tick();
    assert.match(error.message, /403/);
    assert.equal(aborted, ASSET_FETCH_CONCURRENCY - 1, "active fetches and body reads are cancelled");
    assert.equal(requests.length, ASSET_FETCH_CONCURRENCY,
      "a rejected export must not keep fetching every queued asset");
    assert.equal(clicks, 0);
    assert.equal(blobs.length, 0);

    retry = true;
    requests.length = 0;
    assert.deepEqual(await exportProjectZip(doc), []);
    assert.equal(requests.length, ASSET_FETCH_CONCURRENCY * 2);
    assert.equal(clicks, 1);
    const zip = await ZipArchive.open(await blobs[0].arrayBuffer());
    for (let i = 0; i < ASSET_FETCH_CONCURRENCY * 2; i++) {
      assert.deepEqual(await zip.file(`pool-regression/public/assets/asset-${i}.png`)!.bytes(),
        new Uint8Array([0, 1, 255]));
    }
    assert.deepEqual(doc, before);
  } finally {
    fail.resolve(new Response("unavailable", { status: 403 }));
    release.resolve();
    await result;
    await tick();
    globalThis.fetch = originalFetch;
    if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
    else Reflect.deleteProperty(globalThis, "document");
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  }
});

test("asset retries stop immediately when the caller aborts during backoff", async () => {
  const previousFetch = globalThis.fetch;
  const controller = new AbortController();
  const failure = new Error("export cancelled");
  const fetched = deferred<void>();
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    fetched.resolve();
    return new Response("busy", { status: 503 });
  };
  const result = fetchWithRetry("/asset", 3, { signal: controller.signal });
  try {
    await fetched.promise;
    await tick();
    controller.abort(failure);
    await assert.rejects(timely(result), error => error === failure);
    assert.equal(calls, 1);
    await assert.rejects(fetchWithRetry("/asset", 3, { signal: controller.signal }), error => error === failure);
    assert.equal(calls, 1, "already aborted work must not issue a request");
  } finally {
    await result.catch(() => {});
    globalThis.fetch = previousFetch;
  }
});
});

describe("asset-token", () => {
describe("asset-token-mutation", () => {
  const SEED = 0x4a202611;
  function seeded(seed: number) {
    let state = seed >>> 0;
    return () => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return state >>> 0;
    };
  }

  /** サンドボックスのプレビューの URL で、他の KV のキーが許可されてはならない。 */
  test("signed asset URLs do not permit mutated paths, signatures or expiry", async () => {
    const previous = process.env.AUTH_SECRET;
    process.env.AUTH_SECRET = "asset-token-test-isolated-secret";
    const next = seeded(SEED ^ 0x1818);
    const now = 1_800_000_000_000;
    const names = [
      "logo.png", "folder/photo.svg", "folder/space name.png",
      "folder/%2E%2E/other.png", "folder//other.png", "font.woff2",
      "日本語.svg", "A.jpg", "a.jpg", "nested/../../other.jpg",
    ];
    try {
      for (let i = 0; i < 120; i++) {
        const name = names[next() % names.length];
        const path = "assets/" + name + "?variant=" + i;
        const token = new URLSearchParams((await signAssetPath(path, now))!);
        const exp = token.get("exp"), sig = token.get("sig");
        assert.ok(exp && sig, "signed fixture must contain expiry and HMAC");
        assert.equal(await verifyAssetToken(path, exp, sig, now), true,
          "signed path rejected, seed=" + SEED + " case=" + i);
        assert.equal(await verifyAssetToken(path, exp, sig, now + ASSET_TOKEN_TTL), true,
          "boundary expiry rejected, case=" + i);
        assert.equal(await verifyAssetToken(path, exp, sig, now + ASSET_TOKEN_TTL + 1), false);
        for (const alternate of [
          path + "/child", path + "%2F", path.replace("assets/", "assets//"),
          path.toUpperCase(), path + "#fragment", path + "&sig=other",
        ]) {
          if (alternate === path) continue;
          assert.equal(await verifyAssetToken(alternate, exp, sig, now), false,
            "cross-key authorization: seed=" + SEED + " case=" + i + " key=" + alternate);
        }
        assert.equal(await verifyAssetToken(path, exp, sig + "x", now), false);
        assert.equal(await verifyAssetToken(path, String(Number(exp) + 1), sig, now), false);
      }
      const sample = "assets/secret.png";
      const token = new URLSearchParams((await signAssetPath(sample, now))!);
      process.env.AUTH_SECRET = "asset-token-other-secret";
      assert.equal(await verifyAssetToken(sample, token.get("exp"), token.get("sig"), now), false,
        "a token must not survive a signing-key change");
    } finally {
      if (previous === undefined) delete process.env.AUTH_SECRET;
      else process.env.AUTH_SECRET = previous;
    }
  });
});

describe("asset-token-batch", () => {
  const secret = process.env.AUTH_SECRET;
  const setSecret = (value: string | undefined) => {
    if (value === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = value;
  };

  test("batched asset tokens are path-bound, expire and share one expiry", async () => {
    setSecret("test-asset-batch-secret");
    try {
      const now = 1_700_000_000_000;
      const paths = ["assets/a.png", "assets/b.svg", "assets/a.png"];
      const tokens = await signAssetPaths(paths, now);
      assert.equal(tokens.size, 2);
      const expiries = new Set<string>();
      for (const [path, token] of tokens) {
        assert.ok(token);
        const query = new URLSearchParams(token);
        expiries.add(query.get("exp")!);
        assert.equal(await verifyAssetToken(path, query.get("exp"), query.get("sig"), now), true);
        assert.equal(await verifyAssetToken("assets/unrelated.png", query.get("exp"), query.get("sig"), now), false);
        assert.equal(await verifyAssetToken(path, query.get("exp"), query.get("sig"), now + ASSET_TOKEN_TTL + 1), false);
        assert.equal(await signAssetPath(path, now), token);
      }
      assert.deepEqual([...expiries], [String(now + ASSET_TOKEN_TTL)]);

      setSecret(undefined);
      const unsigned = await signAssetPaths(paths, now);
      assert.equal(unsigned.size, 2);
      assert.ok([...unsigned.values()].every(value => value === null));
    } finally {
      setSecret(secret);
    }
  });

  test("signing many assets imports the secret key only once per batch", async () => {
    setSecret("test-asset-batch-secret");
    const subtle = crypto.subtle;
    const original = subtle.importKey;
    let imports = 0;
    Object.defineProperty(subtle, "importKey", {
      configurable: true,
      writable: true,
      value: (...args: unknown[]) => {
        imports++;
        return Reflect.apply(original, subtle, args);
      },
    });
    try {
      const tokens = await signAssetPaths(
        Array.from({ length: 500 }, (_, i) => `assets/preview-${i}.png`),
        1_700_000_000_000,
      );
      assert.equal(tokens.size, 500);
      assert.equal(imports, 1, "one HMAC import per request, not per asset");
    } finally {
      delete (subtle as unknown as { importKey?: unknown }).importKey;
      setSecret(secret);
    }
  });


  test("invalid asset signatures are rejected before base64 decoding and key import", async () => {
    setSecret("test-asset-batch-secret");
    const now = 1_700_000_000_000;
    const valid = new URLSearchParams((await signAssetPath("assets/example.png", now))!);
    const subtle = crypto.subtle;
    const original = subtle.importKey;
    let imports = 0;
    Object.defineProperty(subtle, "importKey", {
      configurable: true,
      writable: true,
      value: (...args: unknown[]) => {
        imports++;
        return Reflect.apply(original, subtle, args);
      },
    });
    try {
      const canonical = valid.get("sig")!;
      const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
      const index = alphabet.indexOf(canonical.at(-1)!);
      assert.equal(index % 4, 0);
      const alias = canonical.slice(0, -1) + alphabet[index + 1];
      assert.equal(await verifyAssetToken("assets/example.png", valid.get("exp"), alias, now), false,
        "different final padding bits must not alias the same HMAC bytes");
      for (const signature of [
        "A".repeat(100_000),
        "A".repeat(42),
        "A".repeat(44),
        "A".repeat(42) + "=",
        "x:invalid",
      ]) {
        assert.equal(await verifyAssetToken("assets/example.png", valid.get("exp"), signature, now), false);
      }
      for (const expiry of ["0", "9999999999999999", "invalid"]) {
        assert.equal(await verifyAssetToken("assets/example.png", expiry, valid.get("sig"), now), false);
      }
      assert.equal(imports, 0, "malformed query strings must not invoke the HMAC runtime");
    } finally {
      delete (subtle as unknown as { importKey?: unknown }).importKey;
      setSecret(secret);
    }
  });
});

describe("asset-font-cors", () => {
  // 実際の認証の確認・署名の検証・配信のルートを、合成したフォントに置き換えた保存先で動かす。
  function load(path: string, mocks: Record<string, unknown>): any {
    const url = new URL(path, import.meta.url);
    const require = createRequire(url);
    const { code } = transformSync(readFileSync(url, "utf8"), { loader: "ts", format: "cjs", target: "es2022" });
    const module = { exports: {} };
    new Function("require", "module", "exports", code)(
      (name: string) => Object.hasOwn(mocks, name) ? mocks[name] : require(name), module, module.exports,
    );
    return module.exports;
  }
  const oldSecret = process.env.AUTH_SECRET;
  beforeEach(() => { process.env.AUTH_SECRET = "synthetic-asset-test-secret"; });
  afterEach(() => {
    if (oldSecret === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = oldSecret;
  });

  function fixture({ configured = true, anonymous = false, session = false } = {}) {
    class NextResponse extends Response {
      static json(value: unknown, init?: ResponseInit) { return new NextResponse(JSON.stringify(value), init); }
    }
    let authCalls = 0;
    const reads: string[] = [];
    const auth = { authConfigured: () => configured, auth: async () => { authCalls++; return session ? { user: { email: "editor@example.test" } } : null; } };
    const serverTr = async () => (text: string) => text;
    const { requireAuth } = load("../lib/server.ts", {
      "next/server": { NextResponse }, "../auth": auth,
      "./i18n-server": { serverTr }, "./anonymous": { anonymousAllowed: () => anonymous },
    });
    const { GET } = load("../app/api/assets/file/route.ts", {
      "next/server": { NextResponse }, "../../../../auth": auth,
      "../../../../lib/server": { requireAuth }, "../../../../lib/i18n-server": { serverTr },
      "../../../../lib/asset-token": { verifyAssetToken },
      "../../../../lib/kv": { assetStore: () => ({
        getWithMetadata: async (path: string) => {
          reads.push(path);
          return { value: new Uint8Array([119, 79, 70, 50]), metadata: { contentType: "font/woff2" } };
        },
      }) },
    });
    return {
      get: (query = "path=assets%2Ffont.woff2") => GET(new Request(`https://editor.example.test/api/assets/file?${query}`, { headers: { Origin: "null" } })) as Promise<Response>,
      reads, authCalls: () => authCalls,
    };
  }
  function readableFromPreview(response: Response, cacheControl: string | RegExp) {
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), "*");
    assert.equal(response.headers.get("Cross-Origin-Resource-Policy"), "cross-origin");
    assert.equal(response.headers.get("Access-Control-Allow-Credentials"), null);
    assert.equal(response.headers.get("Content-Type"), "font/woff2");
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
    assert.match(response.headers.get("Content-Security-Policy") ?? "", /default-src 'none';.*sandbox/);
    const header = response.headers.get("Cache-Control") ?? "";
    if (typeof cacheControl === "string") assert.equal(header, cacheControl);
    else assert.match(header, cacheControl);
  }
  const IMMUTABLE_YEAR = "private, max-age=31536000, immutable";

  test("public anonymous assets can supply fonts to the opaque HTML preview", async () => {
    const f = fixture({ configured: false, anonymous: true });
    const response = await f.get();
    readableFromPreview(response, IMMUTABLE_YEAR);
    assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [119, 79, 70, 50]);
    assert.deepEqual(f.reads, ["assets/font.woff2"]);
  });

  test("signed preview URLs retain cross-origin access without a login cookie", async () => {
    const f = fixture();
    const query = await signAssetPath("assets/font.woff2");
    // キャッシュの期間は、署名が有効な間（1時間）を超えない。
    const response = await f.get(`path=assets%2Ffont.woff2&${query}`);
    readableFromPreview(response, /^private, max-age=(\d+), immutable$/);
    const maxAge = Number(/max-age=(\d+)/.exec(response.headers.get("Cache-Control")!)![1]);
    assert.ok(maxAge > 3500 && maxAge <= ASSET_TOKEN_TTL / 1000, `max-age ${maxAge}`);
    assert.equal(f.authCalls(), 0);
    assert.deepEqual(f.reads, ["assets/font.woff2"]);
  });

  test("cookie-authorized private assets do not gain public CORS access", async () => {
    const f = fixture({ session: true });
    const response = await f.get();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
    assert.equal(response.headers.get("Cross-Origin-Resource-Policy"), null);
    assert.equal(response.headers.get("Cache-Control"), IMMUTABLE_YEAR);
    assert.equal(f.authCalls(), 1);
  });

  test("unsigned, expired and wrong-path URLs still require authentication", async () => {
    const expired = await signAssetPath("assets/font.woff2", Date.now() - ASSET_TOKEN_TTL - 1000);
    const wrongPath = await signAssetPath("assets/another.woff2");
    for (const suffix of ["", `&${expired}`, `&${wrongPath}`, "&exp=9999999999999&sig=invalid"]) {
      const f = fixture();
      const response = await f.get(`path=assets%2Ffont.woff2${suffix}`);
      assert.equal(response.status, 401);
      assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
      assert.deepEqual(f.reads, []);
      assert.equal(f.authCalls(), 1);
    }
  });

  test("unconfigured authentication without anonymous permission stays blocked", async () => {
    const f = fixture({ configured: false });
    const response = await f.get();
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
    assert.deepEqual(f.reads, []);
  });
});
});

describe("asset-trash-delete", () => {
const path = "assets/muhmi2o0abcdef-photo.png";

function fixture(options: {
  busy?: boolean;
  candidate?: boolean;
  refs?: Array<string[]>;
  brokenRoom?: boolean;
  failKv?: boolean;
  changeCandidate?: boolean;
} = {}) {
  let lease = !!options.busy;
  let stored = options.candidate !== false;
  let stamped = 1_700_000_000_000;
  let deleted = false;
  let reads = 0;
  let kvDeletes = 0;
  const db: Db = {
    backend: "d1",
    execute: async (statement) => {
      const sql = typeof statement === "string" ? statement : statement.sql;
      if (sql.includes("UPDATE asset_gc_state SET lease_until=?")) {
        if (lease) return { rows: [], rowsAffected: 0 };
        lease = true;
        return { rows: [{ id: 1 }], rowsAffected: 1 };
      }
      if (sql.includes("UPDATE asset_gc_state SET lease_until=0")) {
        lease = false;
        return { rows: [], rowsAffected: 1 };
      }
      if (sql.includes("FROM asset_gc_candidates") && !sql.includes("JOIN asset_gc_state")) {
        return { rows: stored ? [{ first_unreferenced_at: stamped }] : [], rowsAffected: 0 };
      }
      if (sql.includes("JOIN asset_gc_state")) {
        return { rows: stored && lease ? [{ first_unreferenced_at: options.changeCandidate ? stamped + 1 : stamped }] : [], rowsAffected: 0 };
      }
      if (sql.includes("FROM sites s LEFT JOIN site_document_rooms")) {
        return { rows: [{ site: "site", room_key: "room" }], rowsAffected: 0 };
      }
      throw new Error("Unexpected SQL: " + sql);
    },
    batch: async (statements) => {
      assert.equal(statements.length, 3);
      assert.ok(statements.some((s) => typeof s === "object" && s.sql === "DELETE FROM site_asset_uploads WHERE path=?"));
      stored = false;
      deleted = true;
      return statements.map(() => ({ rows: [], rowsAffected: 1 }));
    },
  };
  const rooms = {
    idFromName: (name: string) => name,
    get: (_id: unknown) => ({
      async gcAssetReferences() {
        if (options.brokenRoom) throw new Error("Document read failed");
        const response = options.refs?.[Math.min(reads, options.refs.length - 1)] ?? [];
        reads++;
        return response;
      },
    }),
  };
  const kv = {
    async delete(asset: string) {
      assert.equal(asset, path);
      kvDeletes++;
      if (options.failKv) throw new Error("KV failed");
    },
  };
  return {
    run: () => permanentlyDeleteTrashedAsset({ db, rooms, kv, path }),
    snapshot: () => ({ lease, stored, deleted, reads, kvDeletes }),
  };
}

test("explicit permanent delete rechecks all documents before deleting the KV file and D1 rows", async () => {
  const f = fixture({ refs: [[], []] });
  assert.equal(await f.run(), "deleted");
  assert.deepEqual(f.snapshot(), { lease: false, stored: false, deleted: true, reads: 2, kvDeletes: 1 });
  assert.equal(await f.run(), "missing");
});

test("a still referenced file is protected, even if it appears only in the final scan", async () => {
  for (const refs of [[[path]], [[], [path]]]) {
    const f = fixture({ refs });
    assert.equal(await f.run(), "in-use");
    const result = f.snapshot();
    assert.equal(result.stored, true);
    assert.equal(result.kvDeletes, 0);
    assert.equal(result.lease, false);
  }
});

test("concurrent sweep, a missing candidate or a changed deletion epoch cannot delete the file", async () => {
  for (const [options, expected] of [
    [{ busy: true }, "busy"],
    [{ candidate: false }, "missing"],
    [{ changeCandidate: true }, "missing"],
  ] as const) {
    const f = fixture(options);
    assert.equal(await f.run(), expected);
    assert.equal(f.snapshot().kvDeletes, 0);
    assert.equal(f.snapshot().deleted, false);
  }
});

test("unreadable documents or KV deletion failures abort safely and release the lease", async () => {
  for (const options of [{ brokenRoom: true }, { failKv: true }]) {
    const f = fixture(options);
    await assert.rejects(f.run());
    assert.equal(f.snapshot().lease, false);
    assert.equal(f.snapshot().stored, true);
    assert.equal(f.snapshot().deleted, false);
  }
});
});

describe("asset-trash-route", () => {
class NextResponse extends Response {
  static json(body: unknown, init?: ResponseInit) {
    return new NextResponse(JSON.stringify(body), init);
  }
}

const path = "assets/muhmi2o0abcdef-photo.png";
type Config = {
  backend?: "d1" | "sqlite"; siteExists?: boolean; candidate?: boolean; locked?: boolean;
  candidateCount?: number; deleteOutcome?: "deleted" | "missing" | "busy" | "in-use";
  storeAvailable?: boolean; roomsAvailable?: boolean;
};
function trashRoute({
  backend = "d1", siteExists = true, candidate = true, locked = false, candidateCount = 1,
  deleteOutcome = "deleted", storeAvailable = true, roomsAvailable = true,
}: Config = {}) {
  const source = readFileSync(new URL("../app/api/assets/trash/route.ts", import.meta.url), "utf8");
  const { code } = transformSync(source, { loader: "ts", format: "cjs", target: "es2022" });
  let deletion = 0, permanentDeleteCalls = 0;
  const db = {
    backend,
    async execute(stmt: string | { sql: string; args: unknown[] }) {
      const sql = typeof stmt === "string" ? stmt : stmt.sql;
      if (sql.includes("FROM sites")) return { rows: siteExists ? [{ exists: 1 }] : [] };
      if (sql.includes("FROM site_asset_uploads")) return { rows: [{ exists: 1 }] };
      if (sql.includes("SELECT c.path")) {
        const args = typeof stmt === "string" ? [] : stmt.args;
        const limit = Number(args[0] ?? 101), offset = Number(args[1] ?? 0);
        const rows = candidate ? Array.from({ length: candidateCount }, (_, i) => ({
          path: i ? path.replace(".png", "-" + i + ".png") : path,
          deletedAt: 1700000000000 + i, bytes: 125 + i,
        })) : [];
        return { rows: rows.slice(offset, offset + limit) };
      }
      if (sql.includes("DELETE FROM asset_gc_candidates")) {
        if (!candidate || locked) return { rows: [] };
        candidate = false;
        deletion++;
        return { rows: [{ path }] };
      }
      if (sql.includes("FROM asset_gc_candidates")) return { rows: candidate ? [{ exists: 1 }] : [] };
      throw new Error("Unexpected query: " + sql);
    },
  };
  const stubs: Record<string, unknown> = {
    "next/server": { NextResponse },
    "@opennextjs/cloudflare": { getCloudflareContext: () => ({ env: { DOC_STORE: roomsAvailable ? {} : null } }) },
    "../../../../lib/kv": { assetStore: () => storeAvailable ? { delete: async () => {} } : null },
    "../../../../lib/asset-trash-delete": {
      permanentlyDeleteTrashedAsset: async ({ path: requested }: { path: string }) => {
        assert.equal(requested, path);
        permanentDeleteCalls++;
        return deleteOutcome;
      },
    },
    "../../../../lib/db": { getDb: async () => db, dbConfigured: () => true },
    "../../../../lib/server": { requireAuth: async () => null, sessionUser: async () => null },
    "../../../../lib/site-access": { requireSiteAccess: async () => null },
    "../../../../lib/allowlist": { allowedEmails: () => [] },
    "../../../../auth": { authConfigured: () => false },
    "../../../../lib/site-server": { siteIdOf: async (site: unknown) => site === "site" ? "site"
      : NextResponse.json({ error: "Invalid site" }, { status: 400 }) },
    "../../../../lib/asset-gc-plan": { assetUploadedAt },
    "../../../../lib/i18n-server": { serverTr: async () => (s: string) => s },
    "../../../../lib/errors": { userMessage: (_err: unknown, fallback: string) => fallback },
    "../../../../lib/api-json": apiJson,
  };
  const mod = { exports: {} as {
    GET: (req: Request) => Promise<Response>;
    POST: (req: Request) => Promise<Response>;
    DELETE: (req: Request) => Promise<Response>;
  } };
  new Function("require", "module", "exports", code)((id: string) => {
    if (!Object.hasOwn(stubs, id)) throw new Error("Missing stub: " + id);
    return stubs[id];
  }, mod, mod.exports);
  return {
    get: (offset = 0) => mod.exports.GET(new Request(`https://example.test/api/assets/trash?site=site&offset=${offset}`)),
    post: (assetPath: string = path, site: string = "site") => mod.exports.POST(new Request("https://example.test/api/assets/trash", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: assetPath, site }),
    })),
    remove: (assetPath: string = path, site: string = "site") => mod.exports.DELETE(new Request("https://example.test/api/assets/trash", {
      method: "DELETE", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: assetPath, site }),
    })),
    send: (method: "POST" | "DELETE", body: string, type = "application/json") =>
      mod.exports[method](new Request("https://example.test/api/assets/trash", {
        method, headers: { "Content-Type": type }, body,
      })),
    deletions: () => deletion,
    permanentDeleteCalls: () => permanentDeleteCalls,
  };
}

test("pending asset files appear in trash, including byte usage and deletion time", async () => {
  const route = trashRoute();
  const response = await route.get();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    enabled: true, hasMore: false, items: [{ path, deletedAt: 1700000000000, bytes: 125 }],
  });
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
});

test("trash pagination returns a bounded page and a continuation signal", async () => {
  const route = trashRoute({ candidateCount: 101 });
  const first = await route.get();
  assert.equal(first.status, 200);
  const initial = await first.json() as { items: unknown[]; hasMore: boolean };
  assert.equal(initial.items.length, 100);
  assert.equal(initial.hasMore, true);
  const last = await route.get(100);
  const final = await last.json() as { items: unknown[]; hasMore: boolean };
  assert.equal(final.items.length, 1);
  assert.equal(final.hasMore, false);
  assert.equal((await route.get(-1)).status, 400);
});

test("restoring from trash deletes the candidate without deleting the stored object", async () => {
  const route = trashRoute();
  const response = await route.post();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(route.deletions(), 1);
  const repeat = await route.post();
  assert.equal(repeat.status, 404);
});

test("trash restore fails closed during garbage collection and for malformed paths", async () => {
  const locked = trashRoute({ locked: true });
  assert.equal((await locked.post()).status, 409);
  assert.equal(locked.deletions(), 0);
  assert.equal((await locked.post("assets/not-a-valid-path.png")).status, 400);
  assert.equal((await locked.post(path, "wrong-site")).status, 400);
});

test("deleted sites and unsupported storage never restore assets", async () => {
  assert.equal((await trashRoute({ siteExists: false }).post()).status, 404);
  assert.equal((await trashRoute({ backend: "sqlite" }).post()).status, 503);
  assert.equal((await trashRoute({ candidate: false }).post()).status, 404);
});

test("permanent deletion from trash calls the safe GC-backed deleter after authorization", async () => {
  const route = trashRoute();
  const response = await route.remove();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(route.permanentDeleteCalls(), 1);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
});

test("permanent deletion rejects active references, busy GC and missing candidates", async () => {
  for (const [outcome, status] of [["in-use", 409], ["busy", 409], ["missing", 404]] as const) {
    const route = trashRoute({ deleteOutcome: outcome });
    const response = await route.remove();
    assert.equal(response.status, status, outcome);
    assert.equal(route.permanentDeleteCalls(), 1);
  }
});

test("permanent deletion refuses invalid paths, missing sites, unsupported backend and bindings", async () => {
  const invalid = trashRoute();
  assert.equal((await invalid.remove("assets/fake-path")).status, 400);
  assert.equal((await invalid.remove(path, "other")).status, 400);
  assert.equal(invalid.permanentDeleteCalls(), 0);
  for (const config of [
    { siteExists: false }, { backend: "sqlite" as const },
    { storeAvailable: false }, { roomsAvailable: false },
  ]) {
    const route = trashRoute(config);
    assert.ok([404, 503].includes((await route.remove()).status));
    assert.equal(route.permanentDeleteCalls(), 0);
  }
});

test("trash writes bound the request body and require JSON before touching storage", async () => {
  for (const method of ["POST", "DELETE"] as const) {
    const route = trashRoute();
    const oversized = JSON.stringify({ site: "site", path, padding: "x".repeat(4096) });
    assert.equal((await route.send(method, oversized)).status, 413);
    assert.equal((await route.send(method, JSON.stringify({ site: "site", path }), "text/plain")).status, 415);
    for (const malformed of ["{", "null", "[]", "\"text\""]) {
      assert.equal((await route.send(method, malformed)).status, 400);
    }
    assert.equal(route.deletions(), 0);
    assert.equal(route.permanentDeleteCalls(), 0);
  }
});

test("a file that already left the trash is reported with a stable code", async () => {
  const restored = await trashRoute({ candidate: false }).post();
  assert.equal(restored.status, 404);
  assert.equal((await restored.json() as { code?: string }).code, "asset_trash_missing");
  const removed = await trashRoute({ deleteOutcome: "missing" }).remove();
  assert.equal(removed.status, 404);
  assert.equal((await removed.json() as { code?: string }).code, "asset_trash_missing");
  // 存在しないサイトの 404 を、削除済みのファイルと取り違えない。
  const missingSite = await trashRoute({ siteExists: false }).remove();
  assert.equal(missingSite.status, 404);
  assert.equal((await missingSite.json() as { code?: string }).code, undefined);
});

test("the disabled trash listing is not cacheable either", async () => {
  const response = await trashRoute({ backend: "sqlite" }).get();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { items: [], enabled: false });
  assert.equal(response.headers.get("cache-control"), "private, no-store");
});
});

describe("asset-upload", () => {
test("multipart parsing counts all bytes, including fields and undeclared or understated bodies", async () => {
  const form = new FormData();
  form.append("file", new File(["ok"], "a.txt", { type: "text/plain" }));
  form.append("other", "x".repeat(1000));
  const request = () => new Request("https://editor.example/upload", { method: "POST", body: form });
  const good = await readAssetForm(request(), 4096);
  assert.equal(await (good!.get("file") as File).text(), "ok");
  for (const length of [null, "1", "4000"]) {
    const req = request();
    if (length !== null) req.headers.set("content-length", length);
    await assert.rejects(readAssetForm(req, 500), RangeError);
  }
});

async function timely<T>(pending: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([pending, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("upload waited for body cancellation")), 500);
    })]);
  } finally {
    clearTimeout(timer);
  }
}

test("a declared oversized cloned upload rejects without consuming the other branch", async () => {
  const form = new FormData();
  form.set("file", new File(["preserved"], "a.txt", { type: "text/plain" }));
  const original = new Request("https://editor.example/upload", { method: "POST", body: form });
  original.headers.set("content-length", "4000");
  const clone = original.clone();
  try {
    await assert.rejects(timely(readAssetForm(clone, 500)), RangeError);
    assert.equal(original.bodyUsed, false);
    assert.equal(await ((await original.formData()).get("file") as File).text(), "preserved");
  } finally {
    void original.body?.cancel().catch(() => {});
  }
});

test("declared oversized uploads do not wait for an unresolved cleanup promise", async () => {
  let cancelled = false;
  const req = new Request("https://editor.example/upload", {
    method: "POST",
    headers: { "content-length": "4000", "content-type": "multipart/form-data; boundary=test" },
    body: new ReadableStream<Uint8Array>({
      cancel() { cancelled = true; return new Promise<void>(() => {}); },
    }),
    duplex: "half",
  } as RequestInit);
  await assert.rejects(timely(readAssetForm(req, 500)), RangeError);
  assert.equal(cancelled, true);
});

test("streamed oversized cloned uploads reject while the other branch remains readable", async () => {
  const form = new FormData();
  form.set("file", new File(["x".repeat(1000)], "a.txt", { type: "text/plain" }));
  const original = new Request("https://editor.example/upload", { method: "POST", body: form });
  const clone = original.clone();
  try {
    await assert.rejects(timely(readAssetForm(clone, 500)), RangeError);
    assert.equal(original.bodyUsed, false);
    assert.equal(await ((await original.formData()).get("file") as File).text(), "x".repeat(1000));
  } finally {
    void original.body?.cancel().catch(() => {});
  }
});

test("file uploads discard unsupported media types before reading the body", async () => {
  for (const type of [null, "text/plain; charset=utf-8", "application/x-www-form-urlencoded"]) {
    let reads = 0, cancelled = false;
    const req = new Request("https://editor.example/upload", {
      method: "POST", headers: type ? { "content-type": type } : {},
      body: new ReadableStream<Uint8Array>({
        pull(controller) { reads++; controller.close(); },
        cancel() { cancelled = true; return new Promise<void>(() => {}); },
      }, { highWaterMark: 0 }),
      duplex: "half",
    } as RequestInit);
    assert.equal(await timely(readAssetForm(req, 4096)), null);
    assert.equal(reads, 0);
    assert.equal(cancelled, true);
  }
});
});

describe("asset-usage", () => {
  before(() => {
    useEditor.setState({
      breakpoint: "base", customWidth: null, styleState: "default", mode: "design",
      pageTheme: "light", selection: null, selectedIds: [], editingComponentId: null, scriptEditor: null,
    });
  });
describe("asset-usage", () => {
  function equivalent(doc: SiteDoc) {
    assert.deepEqual([...assetUsage(doc)].sort(), [...referenceAssetUsage(doc)].sort());
  }

  test("indexed usage retains repeated styles, source aliases, and direct plus style counts", () => {
    const d = largeAssetLibrary(8, 2);
    const [first, second] = Object.values(d.assets);
    d.assets.alias = { ...first, id: "alias" };
    const src = assetSrc(first);
    d.nodes.node_0.image = { assetId: first.id, src, alt: "", width: 1, height: 1 };
    d.nodes.node_0.styles = { base: { default: { background: `url('${src}#icon'), url('${src}')` }, hover: { backgroundImage: `image-set("${src}" 1x)` } } };
    d.nodes.node_1.styles = { mobile: { default: { backgroundImage: `url('${src}')` } } };
    equivalent(d);
    assert.equal(assetUsage(d).get(first.id), 3);
    assert.equal(assetUsage(d).get("alias"), 2);
    assert.equal(assetUsage(d).has(second.id), false);
  });

  test("exact and fragment source IDs are both retained, including embedded SVG data", () => {
    const d = largeAssetLibrary(1, 1);
    const base = "data:image/svg+xml,%3Csvg%3E%3C/svg%3E";
    d.assets = Object.fromEntries([base, `${base}#a`, `${base}#a#b`, ""].map((src, i) => {
      const id = `embedded_${i}`;
      return [id, { id, name: `${id}.svg`, dataUrl: src, width: 1, height: 1 }];
    }));
    d.nodes.node_0.styles = { base: { default: { backgroundImage: `url('${base}#a#b')` } } };
    equivalent(d);
    assert.equal(assetUsage(d).get("embedded_0"), 1);
    assert.equal(assetUsage(d).get("embedded_2"), 1);
    assert.equal(assetUsage(d).has("embedded_3"), false);
  });

  test("CSS escapes, image-set, malformed tokens, and prefix-sharing URLs match prior safety semantics", () => {
    const d = largeAssetLibrary(3, 1);
    const src = assetSrc(Object.values(d.assets)[0]);
    for (const css of [
      `url('${src}#a')`, `URL( /*comment*/ '${src}' )`, `image-set("${src}" 1x, url('${src}') 2x)`,
      `u\\72 l("\\2f ${src.slice(1)}")`, `url('${src}.backup')`, `url('${src}&v=1')`,
      `"url(${src})"`, `/* url(${src}) */ red`, `not-url(${src})`, `url('${src})`,
      `url(${src} extra)`, `@namespace "${src}"`, `@import '${src}'`, "none", "",
    ]) {
      d.nodes.node_0.styles = { base: { default: { backgroundImage: css } } };
      equivalent(d);
    }
  });

  test("conservative HTML, page, settings, and ZIP dependency references are unchanged", () => {
    const d = largeAssetLibrary(10, 1);
    const a = Object.values(d.assets);
    d.favicon = { assetId: a[1].id };
    d.appleTouchIcon = { assetId: a[2].id };
    d.ogImage = { assetId: a[3].id };
    d.pwa = { enabled: true, icon: { assetId: a[4].id } } as SiteDoc["pwa"];
    d.pages.p.ogImage = { assetId: a[5].id };
    d.pages.p.bodyStyles = { base: { default: { backgroundImage: `url('${assetSrc(a[6])}')` } } };
    d.pages.p.rawHtml = `<img src="${assetSrc(a[7])}"><link href="tsumu-zip-css:sheet">`;
    d.assets.sheet = { id: "sheet", name: "sheet.css", mimeType: "text/css", width: 0, height: 0, zip: { version: 1, group: "zip", path: "sheet.css", stylesheet: {
      source: "body { background: url(dep.png) }", references: [{ url: "dep.png", assetId: a[8].id, suffix: "" }],
    } } };
    equivalent(d);
    assert.equal(assetUsage(d).size, 10);
    assert.equal(assetUsage(d).has(a[9].id), false);
  });

  test("indexed usage is equivalent across mixed deterministic libraries", () => {
    let seed = 41;
    const random = (n: number) => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed % n; };
    for (let i = 0; i < 60; i++) {
      const d = largeAssetLibrary(24, 6);
      const assets = Object.values(d.assets);
      for (let n = 0; n < 6; n++) {
        const asset = assets[random(assets.length)];
        const src = assetSrc(asset);
        const values = [`url('${src}')`, `url('${src}#icon')`, `image-set('${src}' 1x)`, `url('${src}.backup')`, `/* url('${src}') */`, "red"];
        d.nodes[`node_${n}`].styles = { base: { default: { backgroundImage: values[random(values.length)] }, hover: { background: values[random(values.length)] } } };
        if (random(2)) d.nodes[`node_${n}`].media = { assetId: asset.id, kind: "video", src: "" };
      }
      equivalent(d);
    }
  });

  test("large library usage stays exact for 5,000 images and 200 styled nodes", () => {
    const d = largeAssetLibrary(5_000, 200);
    const usage = assetUsage(d);
    assert.equal(usage.size, 200);
    assert.ok([...usage.values()].every((count) => count === 1));
    const before = JSON.stringify(d);
    assetUsage(d);
    assert.equal(JSON.stringify(d), before);
  });
});

describe("asset-cache", () => {
  test("immutable asset paths are cached privately for a year", () => {
    assert.equal(assetCacheControl(null), `private, max-age=${ASSET_CACHE_MAX_AGE}, immutable`);
    assert.equal(ASSET_CACHE_MAX_AGE, 31_536_000);
  });

  test("signed URLs are cached only until the signature expires", () => {
    const now = 1_000_000;
    assert.equal(assetCacheControl(now + 3_600_000, now), "private, max-age=3600, immutable");
    assert.equal(assetCacheControl(now + 999, now), "private, no-store");
    assert.equal(assetCacheControl(now - 1, now), "private, no-store");
  });
});

describe("asset-trash-client", () => {
  test("select-all loads beyond the first 100 Trash entries", async () => {
    const paths = Array.from({ length: 205 }, (_, i) => ({ path: `assets/${i}.png` }));
    const offsets: number[] = [];
    const items = await loadAllTrash(async (offset) => {
      offsets.push(offset);
      return { items: paths.slice(offset, offset + 100), hasMore: offset + 100 < paths.length };
    });
    assert.deepEqual(offsets, [0, 100, 200]);
    assert.deepEqual(items, paths);
  });

  test("repeated assets are selected once, and malformed pagination fails", async () => {
    const result = await loadAllTrash(async offset => offset
      ? { items: [{ path: "assets/a" }, { path: "assets/b" }], hasMore: false }
      : { items: [{ path: "assets/a" }], hasMore: true });
    assert.deepEqual(result, [{ path: "assets/a" }, { path: "assets/b" }]);
    await assert.rejects(loadAllTrash(async () => ({ items: [], hasMore: true })));
  });
});

describe("asset-display", () => {
  test("CSS, scripts, JSON and fonts are not displayed or inserted as images", () => {
    for (const [name, mimeType, expected] of [
      ["main.css", "text/css", "css"],
      ["app.js", "text/javascript", "javascript"],
      ["client.mjs", "application/javascript", "javascript"],
      ["app.woff2", "font/woff2", "font"],
      ["data.json", "application/json", "json"],
      ["readme.txt", "text/plain", "document"],
      ["bundle.zip", "application/zip", "archive"],
      ["file.unknown", "application/octet-stream", "file"],
    ] as const) {
      assert.equal(assetDisplayKind({ name, mimeType }), expected, name);
      assert.equal(isVisualAsset({ name, mimeType }), false, name);
    }
  });

  test("visual formats still have media previews, including assets without MIME metadata", () => {
    for (const [name, mimeType, expected] of [
      ["image.svg", "image/svg+xml", "image"],
      ["photo.png", undefined, "image"],
      ["song.mp3", "", "audio"],
      ["clip.webm", "video/webm", "video"],
    ] as const) {
      assert.equal(assetDisplayKind({ name, mimeType }), expected);
      assert.equal(isVisualAsset({ name, mimeType }), true);
    }
    assert.equal(assetExtensionLabel({ name: "bundle.woff2" }), "WOFF2");
    assert.equal(assetExtensionLabel({ name: "script.js" }), "JS");
    assert.equal(assetExtensionLabel({ name: "longfilename", mimeType: "text/css" }), "CSS");
  });
});

describe("asset-picker-types", () => {
  test("image pickers do not offer CSS, scripts, documents or fonts as images", () => {
    const initial = useEditor.getInitialState();
    const original = initial.doc;
    const asset = (id: string, name: string, mimeType?: string): Asset => ({ id, name, mimeType, path: `assets/${name}`, width: 1, height: 1 });
    const assets = [
      asset("png", "photo.png", "image/png"), asset("svg", "logo.svg", "image/svg+xml"),
      asset("untyped", "untyped.png"), asset("css", "styles.css", "text/css"),
      asset("js", "app.js", "text/javascript"), asset("pdf", "manual.pdf", "application/pdf"),
      asset("font", "font.woff2", "font/woff2"), asset("video", "movie.mp4", "video/mp4"),
      asset("audio", "sound.mp3", "audio/mpeg"),
    ];
    initial.doc = { ...original, assets: Object.fromEntries(assets.map(a => [a.id, a])) };
    try {
      const markup = renderToStaticMarkup(createElement(AssetGrid, { kind: "image", onPick() {} }));
      for (const name of ["photo.png", "logo.svg", "untyped.png"]) assert.ok(markup.includes(`data-tip="${name}"`), name);
      for (const name of ["styles.css", "app.js", "manual.pdf", "font.woff2", "movie.mp4", "sound.mp3"]) assert.ok(!markup.includes(`data-tip="${name}"`), name);
      for (const [kind, name] of [["video", "movie.mp4"], ["audio", "sound.mp3"]] as const) {
        const media = renderToStaticMarkup(createElement(AssetGrid, { kind, onPick() {} }));
        assert.ok(media.includes(`data-tip="${name}"`));
        assert.ok(!media.includes('data-tip="photo.png"'));
      }
    } finally { initial.doc = original; }
  });
});

describe("image-picker-scope", () => {
  function fixture() {
    const path = resolve("components/ImagePicker.tsx"), require = createRequire(path);
    let query = "", assets: any = {};
    const mod = { exports: {} as any };
    new Function("require", "module", "exports", transformSync(readFileSync(path, "utf8"), { loader: "tsx", format: "cjs", jsx: "automatic" }).code)(
      (id: string) => id === "react" ? { useId: () => "test-image-field", useState: () => [query, (v: string) => { query = v; }], useRef: () => ({ current: null }) } :
        id === "../lib/assets" ? { assetKind: () => "image", assetSrc: (a: any) => a.url } :
        id === "../lib/store" ? { useEditor: (select: any) => select({ doc: { assets } }) } :
        id === "../lib/use-pending-import" ? { usePendingImport: () => ({ busy: false, cancel() {} }) } : require(id), mod, mod.exports);
    const flatten = (v: any): any[] => Array.isArray(v) ? v.flatMap(flatten) : v && typeof v === "object" ? [v, ...flatten(v.props?.children)] : [];
    return {
      input: (editTarget: string) => flatten(mod.exports.default({ editTarget, value: { url: "/same.png" }, onChange() {} })).find(x => x.type === "input"),
      grid: () => flatten(mod.exports.AssetGrid({ kind: "image", onPick() {} })),
      setAssets: (count: number) => { assets = Object.fromEntries(Array.from({ length: count }, (_, i) => [String(i), { id: String(i), name: `photo${i}.png`, mimeType: "image/png", url: "/image.png" }])); },
    };
  }
  test("image URL drafts have separate React identities for different edit targets", () => {
    const f = fixture();
    assert.notEqual(f.input("page-a").key, f.input("page-b").key);
    assert.equal(f.input("page-a").props.defaultValue, "/same.png");
  });
  test("asset search remains clearable when deletion reduces the library below five items", () => {
    const f = fixture(); f.setAssets(5);
    f.grid().find(x => x.type === "input").props.onChange({ target: { value: "missing" } });
    f.setAssets(3);
    const input = f.grid().find(x => x.type === "input");
    assert.ok(input); assert.equal(input.props.value, "missing");
    f.grid().find(x => x.type === "button" && x.props["aria-label"] === "Clear search").props.onClick();
    assert.equal(f.grid().filter(x => x.type === "button" && x.props.className === "img-pick-cell").length, 3);
  });
});

describe("imported-asset-usage", () => {
  const asset = (id: string, path: string, group = "zip_linked"): Asset => ({
    id, name: path.split("/").at(-1)!, mimeType: path.endsWith(".js") ? "text/javascript" : "image/png",
    width: 0, height: 0, path: "assets/" + id, zip: { version: 1, group, path },
  });

  test("used ZIP script modules protect sibling modules and resources from unused deletion", () => {
    const main = asset("main", "site/scripts/main.js");
    const chunk = asset("chunk", "site/scripts/chunk.js");
    const image = asset("image", "site/images/icon.png");
    const unrelated = asset("unrelated", "different/logo.png", "zip_unrelated");
    const doc: SiteDoc = {
      siteName: "Test", nodes: {},
      pages: { p: { id: "p", name: "Page", slug: "", title: "Test", description: "",
        children: [], customEndHtml: '<script src="/api/assets/file?path=assets%2Fmain"></script>' } },
      pageOrder: ["p"],
      assets: { main, chunk, image, unrelated },
    };
    const usage = assetUsage(doc);
    assert.ok(usage.has(main.id));
    assert.ok(usage.has(chunk.id));
    assert.ok(usage.has(image.id));
    assert.equal(usage.has(unrelated.id), false);
  });
});
});

describe("asset-window", () => {
test("large libraries keep only the viewport and three overscan rows mounted", () => {
  for (const count of [101, 500, 5_000, 50_000]) for (const width of [200, 260, 380]) {
    const result = assetWindow(count, width, 600, 0);
    assert.equal(result.indices[0], 0);
    assert.ok(result.indices.length <= 26);
    assert.equal(new Set(result.indices).size, result.indices.length);
    assert.ok(result.indices.every((index) => index >= 0 && index < count));
  }
});

test("scrolling, shrinking a result, and resizing never leave a blank viewport", () => {
  for (const count of [0, 1, 101, 5_000]) for (const top of [-10, 0, 200, 9999999]) {
    const result = assetWindow(count, 260, 600, top);
    if (count) assert.ok(result.indices.length);
    else assert.deepEqual(result.indices, []);
    assert.ok(result.top >= 0);
    assert.ok(result.top <= Math.max(0, result.totalHeight - 600));
    assert.ok(result.indices.every((index) => index < count));
  }
});

test("focused, renamed, and dragged cards stay mounted without mounting intervening rows", () => {
  const result = assetWindow(5_000, 260, 600, 0, [700, 2001, 4999, -1, 5000, 700]);
  assert.ok(result.indices.includes(700));
  assert.ok(result.indices.includes(2001));
  assert.ok(result.indices.includes(4999));
  assert.ok(result.indices.length <= 30);
  assert.deepEqual(result.indices, [...new Set(result.indices)].sort((a, b) => a - b));
});

test("last odd card is reachable and total height matches the two-column card geometry", () => {
  const result = assetWindow(5_001, 274, 600, 99999999);
  assert.equal(result.rowHeight, 140);
  assert.equal(result.totalHeight, 2501 * 140 + 2);
  assert.equal(result.indices.at(-1), 5000);
});


test("asset list resize retains the same visible row rather than the same pixel offset", () => {
  const beforeWidth = 260;
  const afterWidth = 420;
  const firstTop = 12.5 * assetRowHeight(beforeWidth);
  const resized = resizedAssetScrollTop(firstTop, beforeWidth, afterWidth);
  assert.ok(Math.abs(resized / assetRowHeight(afterWidth) - 12.5) < 1e-9);
  assert.equal(resizedAssetScrollTop(0, beforeWidth, afterWidth), 0);
});
});

describe("retained-upload-history", () => {
  before(() => {
    useEditor.setState({
      breakpoint: "base", customWidth: null, styleState: "default", mode: "design",
      pageTheme: "light", selection: null, selectedIds: [], editingComponentId: null, scriptEditor: null,
    });
  });
const state = () => useEditor.getState();
const asset: Asset = { id: "uploaded", name: "image.png", path: "assets/image.png", width: 1, height: 1 };
function fixture(): SiteDoc {
  return {
    siteName: "Retained upload", assets: {}, pageOrder: ["p"],
    pages: { p: { id: "p", name: "P", slug: "", title: "", description: "", children: ["a"] } },
    nodes: { a: { ...makeText("Original"), id: "a", styles: { base: { default: { color: "red" } } } } },
  };
}
function open() {
  state().endGesture(); state().replaceDoc(fixture()); state().select("a");
  state().setBreakpoint("base"); state().setStyleState("default");
}
function retained(doc: SiteDoc) { return { ...doc, assets: { ...doc.assets, [asset.id]: asset } }; }

test("history revision changes only for effective navigation and document replacement boundaries", () => {
  open();
  let revision = state().historyRevision;
  state().undo(); state().redo(); state().restoreDoc(structuredClone(state().doc));
  assert.equal(state().historyRevision, revision);
  state().updateNode("a", { name: "Local" });
  state().checkpoint(); state().updateDoc(() => {}, { history: false });
  const remote = structuredClone(state().doc); remote.siteName = "Remote";
  state().applyRemoteDoc(remote);
  assert.equal(state().historyRevision, revision, "ordinary and remote edits do not interrupt imports");
  state().undo(); assert.equal(state().historyRevision, ++revision);
  state().undo(); assert.equal(state().historyRevision, revision, "empty Undo does not interrupt");
  state().redo(); assert.equal(state().historyRevision, ++revision);
  state().redo(); assert.equal(state().historyRevision, revision, "empty Redo does not interrupt");
  state().restoreDoc(fixture()); assert.equal(state().historyRevision, ++revision);
  state().replaceDoc(state().doc); assert.equal(state().historyRevision, ++revision, "even identical replacement resets the document session");
  state().resetDoc(); assert.equal(state().historyRevision, ++revision);
});

test("asset retention preserves multiple undo/redo snapshots and current editing UI without a new history entry", () => {
  open();
  const original = structuredClone(state().doc);
  state().updateNode("a", { name: "Renamed" });
  const renamed = structuredClone(state().doc);
  state().setStyleProps("a", { color: "blue" });
  const blue = structuredClone(state().doc);
  state().undo(); state().undo();
  const before = state();
  const textSel = { nodeId: "a", start: 0, end: 2, text: "Or" };
  state().setEditingText("a"); state().setTextSel(textSel);
  const input = structuredClone(asset);
  state().retainUploadedAssets([input]);
  assert.equal(state().historyRevision, before.historyRevision);
  assert.equal(state().past.length, 0); assert.equal(state().future.length, 2);
  assert.equal(state().selection, "a"); assert.deepEqual(state().selectedIds, ["a"]);
  assert.equal(state().editingText, "a"); assert.equal(state().textSel, textSel);
  assert.deepEqual(before.doc, original, "older objects must not be mutated");
  assert.deepEqual(before.future, [renamed, blue]);
  input.name = "caller changed";
  assert.deepEqual(state().doc, retained(original));
  state().redo(); assert.deepEqual(state().doc, retained(renamed));
  state().redo(); assert.deepEqual(state().doc, retained(blue));
  state().undo(); assert.deepEqual(state().doc, retained(renamed));
  state().undo(); assert.deepEqual(state().doc, retained(original));
});

test("retention leaves an unused checkpoint and its redo branch intact until a real transient edit", () => {
  open();
  state().updateNode("a", { name: "Redo name" }); state().undo();
  state().checkpoint();
  state().retainUploadedAssets([asset]);
  assert.equal(state().past.length, 0); assert.equal(state().future.length, 1);
  state().updateDoc(() => {}, { history: false });
  assert.equal(state().past.length, 0); assert.equal(state().future.length, 1);
  state().setStyleProps("a", { color: "green" }, { transient: true });
  assert.equal(state().past.length, 1); assert.equal(state().future.length, 0);
  state().undo(); assert.deepEqual(state().doc, retained(fixture()));
  state().redo(); assert.equal(state().doc.nodes.a.styles.base?.default?.color, "green");
  assert.deepEqual(state().doc.assets.uploaded, asset);
});

test("retention does not consume or split an active gesture, before or after its first edit", () => {
  for (const firstEdit of [false, true]) {
    open(); state().beginGesture();
    if (firstEdit) state().setStyleProps("a", { color: "blue" });
    state().retainUploadedAssets([asset]);
    state().setStyleProps("a", { color: "green" });
    state().setStyleProps("a", { color: "purple" }); state().endGesture();
    assert.equal(state().past.length, 1);
    state().undo(); assert.deepEqual(state().doc, retained(fixture()));
    state().redo(); assert.equal(state().doc.nodes.a.styles.base?.default?.color, "purple");
    assert.deepEqual(state().doc.assets.uploaded, asset);
  }
});

test("retained assets survive redo and undo after remote history rebasing", () => {
  for (const retainFirst of [false, true]) {
    open(); state().updateNode("a", { name: "Local" }); state().undo();
    const revision = state().historyRevision;
    if (retainFirst) state().retainUploadedAssets([asset]);
    const remote = structuredClone(state().doc); remote.nodes.a.styles.base!.default!.color = "green";
    state().applyRemoteDoc(remote);
    if (!retainFirst) state().retainUploadedAssets([asset]);
    assert.equal(state().historyRevision, revision);
    assert.equal(state().future.length, 1);
    state().redo();
    assert.equal(state().doc.nodes.a.name, "Local");
    assert.equal(state().doc.nodes.a.styles.base?.default?.color, "green");
    assert.deepEqual(state().doc.assets.uploaded, asset);
    state().undo();
    assert.equal(state().doc.nodes.a.styles.base?.default?.color, "green");
    assert.deepEqual(state().doc.assets.uploaded, asset);
  }
});

test("retention is idempotent, never overwrites existing assets, and retains each completed file once", () => {
  open();
  state().retainUploadedAssets([asset, { ...asset, name: "duplicate" }]);
  const before = state();
  state().retainUploadedAssets([]);
  state().retainUploadedAssets([{ ...asset, name: "replacement" }]);
  assert.equal(state(), before);
  assert.deepEqual(state().doc.assets.uploaded, asset);
  assert.equal(state().past.length, 0);
});
});
