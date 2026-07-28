import assert from "node:assert/strict";
import { test } from "node:test";
import JSZip from "jszip";
import { createInitialDoc } from "../lib/presets";
import { EDITABLE_ASSETS_PATH, EDITABLE_DOC_PATH, parseSiteImport } from "../lib/site-import";

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
  await assert.rejects(parseSiteImport(bytes, "zip"), /重複したファイルパス/);
});

test("editable ZIPs reject canonically equivalent Unicode paths", async () => {
  const bytes = await archiveWith("assets/café.svg", "assets/cafe\u0301.svg");
  await assert.rejects(parseSiteImport(bytes, "zip"), /重複したファイルパス/);
});

test("editable ZIPs reject control characters in member names", async () => {
  for (const path of ["assets/bad\nfile.svg", "assets/bad\u007ffile.svg"]) {
    const bytes = await archiveWith(path);
    await assert.rejects(parseSiteImport(bytes, "zip"), /安全でないファイルパス/);
  }
});
