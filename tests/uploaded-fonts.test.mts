import assert from "node:assert/strict";
import { test } from "node:test";
import { createInitialDoc } from "../lib/presets";
import { buildAssetNames } from "../lib/generator/names";
import { createCssValueResolver, uploadedFontsCss } from "../lib/generator/css";
import { scopedAssetIds } from "../lib/generator/scoped-assets";
import { validSiteAdditionalFields } from "../lib/document-value-shapes";

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

test("uploaded fonts are bundled and fall back to sans-serif", () => {
  const doc = fixture();
  const names = buildAssetNames(doc);
  const css = uploadedFontsCss(doc, names);
  assert.match(css, /@font-face/);
  assert.match(css, /font-family: "My Local Font"/);
  assert.match(css, /format\("woff2"\)/);
  assert.match(css, /font-display: swap/);
  assert.match(css, /url\("\/assets\/[^"]+\.woff2"\)/);
  assert.equal(createCssValueResolver(doc, names)("fontFamily", "My Local Font"), '"My Local Font", sans-serif');
  assert.ok(scopedAssetIds(doc, doc.assets).has("asset_custom"));
});

test("unused or missing font assets are not emitted as CSS font faces", () => {
  const doc = fixture();
  doc.uploadedFonts = [{ family: "Other Font", assetId: "asset_custom" }];
  assert.equal(uploadedFontsCss(doc, buildAssetNames(doc)), "");
  doc.uploadedFonts = [{ family: "My Local Font", assetId: "missing" }];
  assert.equal(uploadedFontsCss(doc, buildAssetNames(doc)), "");
});
