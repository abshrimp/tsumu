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
      await zip.generateAsync({ type: "uint8array" }), "zip"), /アセット対応表/);
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
  assert.throws(() => validateImportedDoc(bad), /ページの参照/);
  const corrupt = JSON.parse(JSON.stringify(doc));
  Object.defineProperty(corrupt.assets, "__proto__", {
    value: { id: "__proto__", name: "bad" }, enumerable: true, configurable: true,
  });
  assert.throws(() => validateImportedDoc(corrupt), /プロパティ/);
});

test("ZIP source limits reject oversized and enormous archives", async () => {
  await assert.rejects(parseSiteImport(new Uint8Array(IMPORT_LIMITS.zipBytes + 1),
    "zip"), /大きすぎ/);
  const zip = new JSZip();
  zip.file(EDITABLE_DOC_PATH, JSON.stringify(fixture()));
  for (let i = 0; i < IMPORT_LIMITS.entries + 1; i++) {
    zip.file("extra/" + i + ".txt", "x");
  }
  await assert.rejects(parseSiteImport(await zip.generateAsync({ type: "uint8array" }),
    "zip"), /多すぎ/);
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
    "zip"), /複数の編集データ/);
});

test("document imports reject network references disguised as embedded assets before fetching", async () => {
  const doc = fixture();
  for (const url of ["/api/doc?site=private", "https://example.test/logo", "//example.test/logo"]) {
    doc.assets["original-image"].dataUrl = url;
    await assert.rejects(parseSiteImport(enc.encode(JSON.stringify(doc)), "doc"), /アセット/);
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
  await assert.rejects(parseSiteImport(await zip.generateAsync({ type: "uint8array" }), "zip"), /アセット対応表/);
});

test("document imports reject dangling references, malformed nodes, and cycles in the flat node map", async () => {
  const doc = fixture();
  const root = doc.pages[doc.pageOrder[0]].children[0];
  for (const node of [null, { ...doc.nodes[root], children: ["absent"] },
    { ...doc.nodes[root], children: [root] }]) {
    const value = { ...doc, nodes: { ...doc.nodes, [root]: node } };
    await assert.rejects(parseSiteImport(enc.encode(JSON.stringify(value)), "doc"), /要素/);
  }
});
