import assert from "node:assert/strict";
import { test } from "node:test";
import { assetSrc, removePageAssetBackgrounds } from "../lib/assets";
import type { Asset, NodeStyles, SiteDoc } from "../lib/types";

const asset: Asset = { id: "a", name: "background.png", path: "assets/background.png", width: 10, height: 10 };
const src = assetSrc(asset);
const image = `url("${src}")`;

function docWith(...styles: (NodeStyles | undefined)[]): SiteDoc {
  return {
    siteName: "Test",
    pages: Object.fromEntries(styles.map((bodyStyles, i) => [String(i), {
      id: String(i), name: "Page", slug: String(i), title: "", description: "", children: [], bodyStyles,
    }])),
    pageOrder: styles.map((_, i) => String(i)),
    nodes: {},
    assets: { [asset.id]: { ...asset } },
  };
}

test("asset removal clears exact page backgrounds across pages and breakpoints", () => {
  const doc = docWith(
    { base: { default: { backgroundImage: image, color: "red" } }, mobile: { default: { backgroundImage: image } } },
    { base: { default: { backgroundImage: image } } },
    undefined,
  );
  removePageAssetBackgrounds(doc, asset);
  assert.deepEqual(doc.pages["0"].bodyStyles, { base: { default: { color: "red" } }, mobile: { default: {} } });
  assert.deepEqual(doc.pages["1"].bodyStyles, { base: { default: {} } });
  assert.equal(doc.pages["2"].bodyStyles, undefined);
  assert.deepEqual(doc.assets, { a: asset });
});

test("asset removal preserves other URLs, authored backgrounds and other properties", () => {
  const values = [
    `url("${src}.backup")`, `url("${src}&version=2")`, `url("${src}#fragment")`,
    `url('${src}')`, `url(${src})`, `linear-gradient(red, blue), ${image}`,
    'url("/other.png")', "none",
  ];
  const doc = docWith(...values.map((backgroundImage) => ({
    base: { default: { backgroundImage, content: image } },
  })));
  const before = JSON.stringify(doc);
  removePageAssetBackgrounds(doc, asset);
  assert.equal(JSON.stringify(doc), before);
});

test("asset removal leaves empty sources and sparse page styles alone", () => {
  const doc = docWith({ base: { default: { backgroundImage: 'url("")' }, hover: undefined } });
  const before = JSON.stringify(doc);
  removePageAssetBackgrounds(doc, { ...asset, path: undefined });
  assert.equal(JSON.stringify(doc), before);
  removePageAssetBackgrounds(doc, asset);
  assert.equal(JSON.stringify(doc), before);
});

test("asset removal does not rewrite authored HTML or CSS", () => {
  const doc = docWith({ base: { default: { backgroundImage: image } } });
  doc.pages["0"].rawHtml = `<style>body { background-image: ${image} }</style>`;
  const html = doc.pages["0"].rawHtml;
  removePageAssetBackgrounds(doc, asset);
  assert.equal(doc.pages["0"].rawHtml, html);
});
