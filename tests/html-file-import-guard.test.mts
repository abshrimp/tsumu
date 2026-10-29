import assert from "node:assert/strict";
import { test, describe } from "node:test";
import { createInitialDoc } from "../lib/presets";
import { requireEditableHtmlContent } from "../lib/html-file-import";
import { type HtmlConversion } from "../lib/html-to-site";
import JSZip from "jszip";
import { EDITABLE_ASSETS_PATH, EDITABLE_DOC_PATH, parseSiteImport } from "../lib/site-import";
import { IMPORT_LIMITS, validateImportedDoc } from "../lib/site-import-format";

describe("html-file-import-guard", () => {
  test("a zero-element HTML conversion cannot replace a page", () => {
    const doc = createInitialDoc();
    const home = doc.pageOrder[0];
    doc.pages[home].children = [];
    const result: HtmlConversion = { doc, warnings: [] };
    assert.throws(() => requireEditableHtmlContent(result), /no editable elements/);
    doc.pages[home].children = ["existing"];
    assert.equal(requireEditableHtmlContent(result), result);
  });

  test("a multi-page conversion rejects an empty page even if an earlier page contains elements", () => {
    const doc = createInitialDoc();
    const home = doc.pageOrder[0];
    doc.pages[home].children = ["existing"];
    doc.pages.other = { id: "other", name: "Empty", slug: "other", title: "", description: "", children: [] };
    doc.pageOrder.push("other");
    assert.throws(() => requireEditableHtmlContent({ doc, warnings: [] }), /no editable elements/);
  });
});

describe("import-zip-canonical-paths", () => {
  function archiveWith(...paths: string[]) {
    const doc = createInitialDoc();
    doc.assets = {};
    const zip = new JSZip()
      .file(EDITABLE_DOC_PATH, JSON.stringify(doc))
      .file(EDITABLE_ASSETS_PATH, JSON.stringify({ version: 1, assets: {} }));
    for (const path of paths) zip.file(path, "content");
    return zip.generateAsync({ type: "uint8array" });
  }

  test("editable ZIPs reject case-insensitive path collisions before loading assets", async () => {
    const bytes = await archiveWith("assets/Logo.svg", "assets/logo.svg");
    await assert.rejects(parseSiteImport(bytes, "zip"), /duplicate file paths/);
  });

  test("editable ZIPs reject canonically equivalent Unicode paths", async () => {
    const bytes = await archiveWith("assets/café.svg", "assets/cafe\u0301.svg");
    await assert.rejects(parseSiteImport(bytes, "zip"), /duplicate file paths/);
  });

  test("editable ZIPs reject control characters in member names", async () => {
    for (const path of ["assets/bad\nfile.svg", "assets/bad\u007ffile.svg"]) {
      const bytes = await archiveWith(path);
      await assert.rejects(parseSiteImport(bytes, "zip"), /unsafe path/);
    }
  });
});

describe("site-import-large", () => {
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
});
