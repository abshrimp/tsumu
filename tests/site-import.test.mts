import assert from "node:assert/strict";
import { test } from "node:test";
import JSZip from "jszip";
import { createInitialDoc } from "../lib/presets";
import { buildAssetNames } from "../lib/generator/names";
import {
  EDITABLE_DOC_PATH, EDITABLE_ASSETS_PATH, IMPORT_LIMITS,
  parseSiteImport, validateImportedDoc,
} from "../lib/site-import";
import { importFileKind } from "../lib/import-site-file";

const enc = new TextEncoder();

function fixture() {
  const doc = createInitialDoc();
  doc.siteName = "Imported and editable";
  doc.assets = {
    "original-image": {
      id: "original-image", name: "logo.svg", width: 12, height: 12,
      mimeType: "image/svg+xml", path: "assets/old-reference",
    },
  };
  return doc;
}

test("local doc.json restores an editable SiteDoc and original IDs", async () => {
  const doc = fixture();
  const result = await parseSiteImport(enc.encode(JSON.stringify(doc)), "doc");
  assert.deepEqual(result.doc, doc);
  assert.equal(result.doc.assets["original-image"].id, "original-image");
  assert.equal(result.assets.size, 0);
  assert.deepEqual(result.warnings, []);
});

test("nested export ZIP includes editable source and exact original asset mapping", async () => {
  const doc = fixture();
  const zip = new JSZip();
  const root = zip.folder("example-site")!;
  const assetName = buildAssetNames(doc).get("original-image")!;
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12"/>';
  root.file(EDITABLE_DOC_PATH, JSON.stringify(doc));
  root.file(EDITABLE_ASSETS_PATH, JSON.stringify({
    version: 1, assets: { "original-image": "public/assets/" + assetName },
  }));
  root.file("public/assets/" + assetName, svg);
  root.file("app/page.tsx", "export default function Page() {}");
  const bytes = await zip.generateAsync({ type: "uint8array" });
  const result = await parseSiteImport(bytes, "zip");
  assert.deepEqual(result.warnings, []);
  assert.equal(result.doc.assets["original-image"].path, "assets/old-reference");
  assert.equal(new TextDecoder().decode(result.assets.get("original-image")), svg);
});

test("editable ZIPs without the current asset manifest are rejected", async () => {
  const zip = new JSZip();
  zip.file(EDITABLE_DOC_PATH, JSON.stringify(fixture()));
  await assert.rejects(parseSiteImport(
    await zip.generateAsync({ type: "uint8array" }), "zip"), /_tsumu\/assets\.json/);
});

test("missing asset bytes in a current ZIP produce warnings without guessing paths", async () => {
  const zip = new JSZip();
  zip.file(EDITABLE_DOC_PATH, JSON.stringify(fixture()));
  zip.file(EDITABLE_ASSETS_PATH, JSON.stringify({
    version: 1, assets: { "original-image": "public/assets/logo.svg" },
  }));
  const result = await parseSiteImport(
    await zip.generateAsync({ type: "uint8array" }), "zip");
  assert.equal(result.assets.size, 0);
  assert.match(result.warnings.join("\n"), /logo.svg/);
});

test("unmapped archive paths cannot substitute for an explicitly mapped asset", async () => {
  const doc = fixture();
  const zip = new JSZip();
  zip.file(EDITABLE_DOC_PATH, JSON.stringify(doc));
  zip.file(EDITABLE_ASSETS_PATH, JSON.stringify({
    version: 1, assets: { "original-image": "public/assets/current-logo.svg" },
  }));
  zip.file("unmapped/logo.svg", "<svg/>");
  zip.file("attachments/logo.svg", "<svg/>");
  const result = await parseSiteImport(await zip.generateAsync({ type: "uint8array" }), "zip");
  assert.equal(result.assets.size, 0);
  assert.match(result.warnings.join("\n"), /logo.svg/);
});

test("malformed or incomplete ZIP asset manifests are rejected", async () => {
  for (const manifest of [
    { version: 2, assets: { "original-image": "public/assets/logo.svg" } },
    { version: 1, assets: {} },
    { version: 1, assets: { "original-image": "../escape.svg" } },
  ]) {
    const zip = new JSZip();
    zip.file(EDITABLE_DOC_PATH, JSON.stringify(fixture()));
    zip.file(EDITABLE_ASSETS_PATH, JSON.stringify(manifest));
    await assert.rejects(parseSiteImport(
      await zip.generateAsync({ type: "uint8array" }), "zip"), /asset manifest/);
  }
});

test("embedded data URLs remain valid when ZIP asset bytes are missing", async () => {
  const doc = fixture();
  doc.assets["original-image"].dataUrl = "data:image/svg+xml;base64,PHN2Zy8+";
  const zip = new JSZip();
  zip.file(EDITABLE_DOC_PATH, JSON.stringify(doc));
  zip.file(EDITABLE_ASSETS_PATH, JSON.stringify({
    version: 1, assets: { "original-image": "public/assets/logo.svg" },
  }));
  const result = await parseSiteImport(
    await zip.generateAsync({ type: "uint8array" }), "zip");
  assert.deepEqual(result.warnings, []);
  assert.equal(result.doc.assets["original-image"].dataUrl, doc.assets["original-image"].dataUrl);
});

test("non-editor HTML ZIP is not confused with SiteDoc archive", async () => {
  const zip = new JSZip();
  zip.file("index.html", "<html><body>Not an editor project</body></html>");
  await assert.rejects(parseSiteImport(await zip.generateAsync({ type: "uint8array" }),
    "zip"), /_tsumu\/doc\.json/);
});

test("document validation rejects corrupt references and unsafe object keys", () => {
  const doc = fixture();
  const bad = { ...doc, pageOrder: ["missing-page"] };
  assert.throws(() => validateImportedDoc(bad), /page references/i);
  const corrupt = JSON.parse(JSON.stringify(doc));
  Object.defineProperty(corrupt.assets, "__proto__", {
    value: { id: "__proto__", name: "bad" }, enumerable: true, configurable: true,
  });
  assert.throws(() => validateImportedDoc(corrupt), /property names/i);
});

test("ZIP source limits reject oversized and enormous archives", async () => {
  await assert.rejects(parseSiteImport(new Uint8Array(IMPORT_LIMITS.zipBytes + 1),
    "zip"), /too large/);
  const zip = new JSZip();
  zip.file(EDITABLE_DOC_PATH, JSON.stringify(fixture()));
  for (let i = 0; i < IMPORT_LIMITS.entries + 1; i++) {
    zip.file("extra/" + i + ".txt", "x");
  }
  await assert.rejects(parseSiteImport(await zip.generateAsync({ type: "uint8array" }),
    "zip"), /too many files/);
});

test("local file picker accepts ZIP, JSON and HTML and rejects other formats", () => {
  assert.equal(importFileKind({ name: "website.zip" }), "zip");
  assert.equal(importFileKind({ name: "doc.json" }), "doc");
  assert.equal(importFileKind({ name: "custom-name.json" }), "doc");
  assert.equal(importFileKind({ name: "index.html" }), "html");
  assert.equal(importFileKind({ name: "about.htm" }), "html");
  assert.throws(() => importFileKind({ name: "notes.txt" }), /ZIP/);
});

test("archives with multiple editable documents are rejected before restoring assets", async () => {
  const zip = new JSZip();
  zip.file("first/_tsumu/doc.json", JSON.stringify(fixture()));
  zip.file("second/_tsumu/doc.json", JSON.stringify(fixture()));
  await assert.rejects(parseSiteImport(await zip.generateAsync({ type: "uint8array" }),
    "zip"), /multiple editor documents/);
});

test("document imports reject network references disguised as embedded assets before fetching", async () => {
  const doc = fixture();
  for (const url of ["/api/doc?site=private", "https://example.test/logo", "//example.test/logo"]) {
    doc.assets["original-image"].dataUrl = url;
    await assert.rejects(parseSiteImport(enc.encode(JSON.stringify(doc)), "doc"), /asset/i);
  }
});

test("editable ZIP manifests cannot expand the same archive member once per asset ID", async () => {
  const doc = fixture();
  doc.assets.second = { ...doc.assets["original-image"], id: "second" };
  const zip = new JSZip();
  zip.file(EDITABLE_DOC_PATH, JSON.stringify(doc));
  zip.file(EDITABLE_ASSETS_PATH, JSON.stringify({
    version: 1, assets: { "original-image": "assets/logo.svg", second: "assets/logo.svg" },
  }));
  zip.file("assets/logo.svg", "unique file");
  await assert.rejects(parseSiteImport(await zip.generateAsync({ type: "uint8array" }), "zip"), /asset manifest/);
});

test("document imports reject dangling references, malformed nodes, and cycles in the flat node map", async () => {
  const doc = fixture();
  const root = doc.pages[doc.pageOrder[0]].children[0];
  for (const node of [null, { ...doc.nodes[root], children: ["absent"] },
    { ...doc.nodes[root], children: [root] }]) {
    const value = { ...doc, nodes: { ...doc.nodes, [root]: node } };
    await assert.rejects(parseSiteImport(enc.encode(JSON.stringify(value)), "doc"), /element/i);
  }
});

test("imports reject page roots shared with another page or parent node", () => {
  const doc = fixture();
  const page = doc.pages[doc.pageOrder[0]];
  const child = page.children[0];
  assert.ok(child);
  const sharedPage = structuredClone(doc);
  sharedPage.pages.other = { ...structuredClone(page), id: "other", slug: "other" };
  sharedPage.pageOrder.push("other");
  assert.throws(() => validateImportedDoc(sharedPage), /element hierarchy/i);
  const nested = structuredClone(doc);
  nested.nodes.extra = { ...structuredClone(doc.nodes[child]), id: "extra", children: [child] };
  assert.throws(() => validateImportedDoc(nested), /element hierarchy/i);
});

test("editable ZIP imports accept a zero-byte asset alongside the document", async () => {
  const doc = fixture();
  const zip = new JSZip().file(EDITABLE_DOC_PATH, JSON.stringify(doc))
    .file(EDITABLE_ASSETS_PATH, JSON.stringify({ version: 1, assets: { "original-image": "assets/empty.svg" } }))
    .file("assets/empty.svg", "");
  const result = await parseSiteImport(await zip.generateAsync({ type: "uint8array" }), "zip");
  assert.equal(result.assets.get("original-image")?.length, 0);
});

test("restored URLs follow the newly stored asset without copying a signature into the new document", async () => {
  const { restoreImportAssets } = await import("../lib/site-import");
  const doc = fixture();
  const asset = doc.assets["original-image"];
  asset.name = "data.txt";
  asset.mimeType = "text/plain";
  const old = "/api/assets/file?path=assets%2Fold-reference";
  const page = doc.pages[doc.pageOrder[0]];
  page.customEndHtml = '<!-- ' + old + ' --><script>const literal="' + old + '"</script>' +
    '<img data-src="' + old + '" src="' + old + '&amp;sig=private#icon"><style>i{background:url(' + old + ')}</style>';
  page.bodyStyles = { base: { default: { backgroundImage: 'url("' + old + '#icon")' } } };
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ path: "assets/new" });
  try {
    const { doc: restored, createdPaths } = await restoreImportAssets({
      doc, assets: new Map([[asset.id, enc.encode("contents")]]), warnings: [],
    });
    assert.deepEqual(createdPaths, ["assets/new"]);
    const p = restored.pages[page.id];
    assert.ok(p.customEndHtml?.includes('data-src="' + old + '" src="/api/assets/file?path=assets%2Fnew#icon"'));
    assert.ok(p.customEndHtml?.includes("url(/api/assets/file?path=assets%2Fnew)"));
    assert.ok(p.customEndHtml?.includes('<!-- ' + old + ' --><script>const literal="' + old + '"'));
    assert.ok(!p.customEndHtml?.includes("private"));
    assert.equal(p.bodyStyles?.base?.default?.backgroundImage, 'url("/api/assets/file?path=assets%2Fnew#icon")');
    assert.equal(doc.assets[asset.id].path, "assets/old-reference");
    const missing = await restoreImportAssets({ doc, assets: new Map(), warnings: [] });
    assert.equal(missing.doc.assets[asset.id].path, undefined);
    assert.ok(!missing.doc.pages[page.id].customEndHtml?.includes(' src="' + old));
  } finally { globalThis.fetch = original; }
});

test("an upload without a registered destination is never accepted as a restored file", async () => {
  const { uploadStaticAsset } = await import("../lib/assets");
  const original = globalThis.fetch;
  try {
    for (const path of [undefined, {}, "assets/", "https://other.test/file"]) {
      globalThis.fetch = async (_input, init) => {
        assert.equal(init?.credentials, "same-origin");
        assert.equal(init?.redirect, "error");
        return Response.json({ path });
      };
      await assert.rejects(uploadStaticAsset(new File(["test"], "a.txt", { type: "text/plain" })), /uploaded|upload/i);
    }
  } finally { globalThis.fetch = original; }
});
