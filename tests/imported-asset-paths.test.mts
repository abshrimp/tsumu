import assert from "node:assert/strict";
import { test } from "node:test";
import { importedAssetPath, importedAssetUrl } from "../lib/generator/imported-assets";
import { generateProject } from "../lib/generator";
import { createInitialDoc } from "../lib/presets";
import type { Asset } from "../lib/types";

function fixture(path: string, id: string, name: string): Asset {
  return {
    id, name, path: "assets/" + id, width: 0, height: 0,
    mimeType: name.endsWith(".js") ? "text/javascript" : "image/svg+xml",
    zip: { version: 1, group: "zip_example", path },
  };
}

test("relative ZIP module references retain their original public directory", () => {
  const script = fixture("website/js/main.js", "main", "main.js");
  const chunk = fixture("website/js/util.js", "util", "util.js");
  const image = fixture("website/images/icon.svg", "icon", "icon.svg");
  const doc = createInitialDoc();
  doc.assets = Object.fromEntries([script, chunk, image].map((item) => [item.id, item]));
  doc.pages[doc.pageOrder[0]].customEndHtml =
    '<script type="module" src="/api/assets/file?path=assets%2Fmain"></script>';
  const result = generateProject(doc);
  assert.equal(importedAssetPath(script), "public/assets/_imports/zip_example/website/js/main.js");
  assert.equal(importedAssetUrl(script), "/assets/_imports/zip_example/website/js/main.js");
  assert.equal(result.remoteAssets[importedAssetPath(script)!], "assets/main");
  assert.equal(result.remoteAssets[importedAssetPath(chunk)!], "assets/util");
  assert.equal(result.remoteAssets[importedAssetPath(image)!], "assets/icon");
  const page = result.files["app/page.tsx"];
  assert.ok(page);
  assert.match(page, /\/assets\/_imports\/zip_example\/website\/js\/main\.js/);
  assert.doesNotMatch(page, /api\/assets\/file\?path/);
});

test("unsafe or corrupted ZIP paths never become export output paths", () => {
  for (const input of ["../outside.js", "/outside.js", "js/../../outside.js",
    "js\\outside.js", "js//outside.js", "js/asset?danger.js", "js/%2e%2e.js"]) {
    assert.equal(importedAssetPath(fixture(input, "unsafe", "unsafe.js")), null, input);
  }
});
