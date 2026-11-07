import assert from "node:assert/strict";
import { test } from "node:test";
import { createInitialDoc } from "../lib/presets";
import { buildAssetNames } from "../lib/generator/names";
import { createCssValueResolver, uploadedFontsCss } from "../lib/generator/css";
import { scopedAssetIds } from "../lib/generator/scoped-assets";
import { validSiteAdditionalFields } from "../lib/document-value-shapes";
import { generateExportProject } from "../lib/export-formats";

function fixture() {
  const doc = createInitialDoc();
  const node = Object.values(doc.nodes).find(node => !!node.text);
  assert.ok(node, "Expected a text node");
  node.styles.base ??= {};
  node.styles.base.default ??= {};
  node.styles.base.default.fontFamily = "My Local Font";
  doc.assets["asset_custom"] = {
    id: "asset_custom", name: "my-font.woff2", path: "assets/font-file.woff2",
    width: 0, height: 0, mimeType: "font/woff2",
  };
  doc.uploadedFonts = [{ family: "My Local Font", assetId: "asset_custom" }];
  return doc;
}

test("uploaded fonts validate as part of the site document", () => {
  const doc = fixture();
  assert.equal(validSiteAdditionalFields({ uploadedFonts: doc.uploadedFonts }), true);
  assert.equal(validSiteAdditionalFields({ uploadedFonts: [{ family: "Bad\" CSS", assetId: "asset_custom" }] }), false);
  assert.equal(validSiteAdditionalFields({ uploadedFonts: [{ family: "A", assetId: "../../../oops" }] }), false);
});

test("uploaded fonts are bundled and fall back to sans-serif without literal \\n escapes", () => {
  const doc = fixture();
  const textNodes = Object.values(doc.nodes).filter(node => !!node.text);
  assert.ok(textNodes.length >= 2, "Expected at least two text nodes");
  textNodes[1]!.styles.base = { default: { fontFamily: "Second Local Font" } };
  doc.assets["asset_second"] = {
    id: "asset_second", name: "second.woff2", path: "assets/second.woff2",
    width: 0, height: 0, mimeType: "font/woff2",
  };
  doc.uploadedFonts = [
    { family: "My Local Font", assetId: "asset_custom" },
    { family: "Second Local Font", assetId: "asset_second" },
  ];
  const names = buildAssetNames(doc);
  const css = uploadedFontsCss(doc, names);
  assert.equal((css.match(/@font-face/g) ?? []).length, 2);
  assert.doesNotMatch(css, /\\n/);
  assert.match(css, /}\n@font-face \{/);
  assert.match(css, /font-family: "My Local Font"/);
  assert.match(css, /font-family: "Second Local Font"/);
  assert.match(css, /format\("woff2"\)/);
  assert.match(css, /font-display: swap/);
  assert.match(css, /url\("\/assets\/[^"]+\.woff2"\)/);
  assert.equal(createCssValueResolver(doc, names)("fontFamily", "My Local Font"), '"My Local Font", sans-serif');
  assert.ok(scopedAssetIds(doc, doc.assets).has("asset_custom"));
});

test("Tailwind exports keep Google Fonts @import rules before Tailwind CSS imports", () => {
  const doc = createInitialDoc();
  const node = Object.values(doc.nodes).find(item => !!item.text);
  assert.ok(node);
  node.styles.base = { default: { fontFamily: "Inter" } };
  const project = generateExportProject(doc, {
    framework: "react", language: "typescript", style: "tailwind", scope: "project",
  });
  const css = project.files["src/globals.css"];
  assert.ok(css);
  const fontImportIndex = css.indexOf('@import url("https://fonts.googleapis.com/');
  const tailwindImportIndex = css.indexOf('@import "tailwindcss/theme.css";');
  assert.ok(fontImportIndex >= 0, "Expected Google Fonts @import");
  assert.ok(tailwindImportIndex > fontImportIndex, "Google Fonts @import must precede tailwindcss/theme.css");
});

test("unused or missing font assets are not emitted as CSS font faces", () => {
  const doc = fixture();
  doc.uploadedFonts = [{ family: "Other Font", assetId: "asset_custom" }];
  assert.equal(uploadedFontsCss(doc, buildAssetNames(doc)), "");
  doc.uploadedFonts = [{ family: "My Local Font", assetId: "missing" }];
  assert.equal(uploadedFontsCss(doc, buildAssetNames(doc)), "");
});
