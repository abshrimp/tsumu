import assert from "node:assert/strict";
import { test } from "node:test";
import JSZip from "jszip";
import { createInitialDoc } from "../lib/presets";
import {
  EDITABLE_ASSETS_PATH, EDITABLE_DOC_PATH,
  IMPORT_LIMITS, parseSiteImport, validateImportedDoc,
} from "../lib/site-import";

test("large editable projects with more than 500 assets round-trip through document and ZIP imports", async () => {
  const doc = createInitialDoc();
  const mapping: Record<string, string> = {};
  const zip = new JSZip();
  const bytes = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
  for (let i = 0; i < 501; i++) {
    const id = "asset-" + i;
    const name = "image-" + i + ".png";
    const location = "public/assets/" + name;
    doc.assets[id] = {
      id, name, mimeType: "image/png", path: "assets/existing-" + i, width: 1, height: 1,
    };
    mapping[id] = location;
    zip.file(location, bytes);
  }
  assert.ok(IMPORT_LIMITS.assets >= 501);
  assert.ok(IMPORT_LIMITS.entries >= 503);
  assert.equal(validateImportedDoc(doc), doc);
  const raw = JSON.stringify(doc);
  const direct = await parseSiteImport(new TextEncoder().encode(raw), "doc");
  assert.equal(Object.keys(direct.doc.assets).length, 501);

  zip.file(EDITABLE_DOC_PATH, raw);
  zip.file(EDITABLE_ASSETS_PATH, JSON.stringify({ version: 1, assets: mapping }));
  const archived = await parseSiteImport(await zip.generateAsync({ type: "uint8array" }), "zip");
  assert.equal(Object.keys(archived.doc.assets).length, 501);
  assert.equal(archived.assets.size, 501);
  assert.deepEqual(archived.assets.get("asset-500"), bytes);
});

test("large import support retains a finite asset-count guard", () => {
  const doc = createInitialDoc();
  for (let i = 0; i <= IMPORT_LIMITS.assets; i++) {
    const id = "asset-" + i;
    doc.assets[id] = { id, name: "asset.png", width: 1, height: 1 };
  }
  assert.throws(() => validateImportedDoc(doc), /page, element or asset data/i);
});
