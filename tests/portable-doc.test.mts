import assert from "node:assert/strict";
import { test } from "node:test";
import { createInitialDoc } from "../lib/presets";
import { decodePortableDoc, PORTABLE_DOC_FORMAT, serializePortableDoc } from "../lib/portable-doc";
import { IMPORT_LIMITS, parseSiteImport } from "../lib/site-import";

const encoder = new TextEncoder();

test("compact doc.json is smaller and round-trips without modifying the original SiteDoc", async () => {
  const doc = createInitialDoc();
  doc.customBodyEndHtml = "<!-- theme -->".repeat(10000);
  const source = JSON.stringify(doc);
  const packed = await serializePortableDoc(doc, IMPORT_LIMITS.docBytes);
  assert.ok(packed.length < source.length / 2);
  assert.equal(JSON.parse(packed).format, PORTABLE_DOC_FORMAT);
  const result = await parseSiteImport(encoder.encode(packed), "doc");
  assert.deepEqual(result.doc, doc);
  assert.equal(JSON.stringify(doc), source);
});

test("plain, small doc.json remains accepted and wins when smaller", async () => {
  const doc = createInitialDoc();
  const plain = JSON.stringify(doc);
  const saved = await serializePortableDoc(doc, IMPORT_LIMITS.docBytes);
  const restored = await parseSiteImport(encoder.encode(saved), "doc");
  assert.deepEqual(restored.doc, doc);
  assert.ok(saved.length <= plain.length);
});

test("compact documents can be embedded in a ZIP without changing the SiteDoc", async () => {
  const JSZip = (await import("jszip")).default;
  const doc = createInitialDoc();
  doc.customHeadHtml = "<meta name=\"test\" content=\"ok\">".repeat(1000);
  const zip = new JSZip();
  zip.file("_tsumu/doc.json", await serializePortableDoc(doc, IMPORT_LIMITS.docBytes));
  const imported = await parseSiteImport(await zip.generateAsync({ type: "uint8array" }), "zip");
  assert.deepEqual(imported.doc, doc);
});

test("reject unsupported compressed document versions and encodings", async () => {
  const doc = createInitialDoc();
  const encoded = JSON.parse(await serializePortableDoc(
    { ...doc, customHeadHtml: "x".repeat(20000) }, IMPORT_LIMITS.docBytes,
  ));
  assert.equal(encoded.format, PORTABLE_DOC_FORMAT);
  await assert.rejects(decodePortableDoc({ ...encoded, version: 2 }, IMPORT_LIMITS.docBytes),
    /Unsupported/);
  await assert.rejects(decodePortableDoc({ ...encoded, encoding: "brotli" }, IMPORT_LIMITS.docBytes),
    /Unsupported/);
  await assert.rejects(decodePortableDoc({ ...encoded, payload: "invalid%base64" }, IMPORT_LIMITS.docBytes),
    /Invalid compressed/);
});

test("enforce the decompressed byte cap to block compressed expansion attacks", async () => {
  const doc = createInitialDoc();
  doc.customHeadHtml = "x".repeat(200000);
  const encoded = JSON.parse(await serializePortableDoc(doc, IMPORT_LIMITS.docBytes));
  assert.equal(encoded.format, PORTABLE_DOC_FORMAT);
  await assert.rejects(decodePortableDoc(encoded, 4096), /size limit/);
});
