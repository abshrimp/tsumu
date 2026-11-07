import assert from "node:assert/strict";
import { test } from "node:test";
import JSZip from "jszip";
import { createInitialDoc } from "../lib/presets";
import { buildAssetNames } from "../lib/generator/names";
import {
  EDITABLE_DOC_PATH, EDITABLE_ASSETS_PATH, IMPORT_LIMITS,
  parseSiteImport, validateImportedDoc,
} from "../lib/site-import";
import { requestedSiteImport } from "../lib/import-site-url";

const enc = new TextEncoder();
const source = "https://downloads.example.test/site.zip";

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

test("doc.json URL restores an editable SiteDoc and original IDs", async () => {
  const doc = fixture();
  const result = await parseSiteImport(enc.encode(JSON.stringify(doc)), "doc",
    "https://downloads.example.test/doc.json");
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
  const result = await parseSiteImport(bytes, "zip", source);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.doc.assets["original-image"].path, "assets/old-reference");
  assert.equal(new TextDecoder().decode(result.assets.get("original-image")), svg);
});

test("archives without assets remain importable and produce warnings", async () => {
  const zip = new JSZip();
  zip.file(EDITABLE_DOC_PATH, JSON.stringify(fixture()));
  const result = await parseSiteImport(
    await zip.generateAsync({ type: "uint8array" }), "zip", source);
  assert.equal(result.assets.size, 0);
  assert.match(result.warnings.join("\n"), /logo.svg/);
});

test("embedded data URLs remain valid when ZIP asset bytes are missing", async () => {
  const doc = fixture();
  doc.assets["original-image"].dataUrl = "data:image/svg+xml;base64,PHN2Zy8+";
  const zip = new JSZip();
  zip.file(EDITABLE_DOC_PATH, JSON.stringify(doc));
  const result = await parseSiteImport(
    await zip.generateAsync({ type: "uint8array" }), "zip", source);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.doc.assets["original-image"].dataUrl, doc.assets["original-image"].dataUrl);
});

test("non-editor HTML ZIP is not confused with SiteDoc archive", async () => {
  const zip = new JSZip();
  zip.file("index.html", "<html><body>Not an editor project</body></html>");
  await assert.rejects(parseSiteImport(await zip.generateAsync({ type: "uint8array" }),
    "zip", source), /_tsumu\/doc\.json/);
});

test("document validation rejects corrupt references and unsafe object keys", () => {
  const doc = fixture();
  const bad = { ...doc, pageOrder: ["missing-page"] };
  assert.throws(() => validateImportedDoc(bad), /ページの参照/);
  const corrupt = JSON.parse(JSON.stringify(doc));
  corrupt.assets["__proto__"] = { id: "__proto__", name: "bad" };
  assert.throws(() => validateImportedDoc(corrupt), /プロパティ/);
});

test("ZIP source limits reject oversized and enormous archives", async () => {
  await assert.rejects(parseSiteImport(new Uint8Array(IMPORT_LIMITS.zipBytes + 1),
    "zip", source), /大きすぎ/);
  const zip = new JSZip();
  zip.file(EDITABLE_DOC_PATH, JSON.stringify(fixture()));
  for (let i = 0; i < IMPORT_LIMITS.entries + 1; i++) {
    zip.file("extra/" + i + ".txt", "x");
  }
  await assert.rejects(parseSiteImport(await zip.generateAsync({ type: "uint8array" }),
    "zip", source), /多すぎ/);
});

test("import URL accepts one HTTP(S) query and rejects ambiguous or private schemes", () => {
  assert.deepEqual(requestedSiteImport(new URLSearchParams({
    zip: "https://downloads.example.test/export.zip",
  })), { mode: "zip", url: "https://downloads.example.test/export.zip" });
  assert.equal(requestedSiteImport(new URLSearchParams()), null);
  assert.throws(() => requestedSiteImport(new URLSearchParams({
    doc: "https://test.example/doc.json", zip: "https://test.example/file.zip",
  })), /同時/);
  assert.throws(() => requestedSiteImport(new URLSearchParams({
    doc: "file:///etc/passwd",
  })), /HTTP/);
});
