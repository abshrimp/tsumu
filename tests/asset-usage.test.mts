import assert from "node:assert/strict";
import { test } from "node:test";
import { assetUsage } from "../lib/asset-usage";
import { assetSrc } from "../lib/assets";
import { referenceAssetUsage } from "./helpers/asset-usage-reference";
import { largeAssetLibrary } from "./helpers/large-asset-library";
import type { SiteDoc } from "../lib/types";

function equivalent(doc: SiteDoc) {
  assert.deepEqual([...assetUsage(doc)].sort(), [...referenceAssetUsage(doc)].sort());
}

test("indexed usage retains repeated styles, source aliases, and direct plus style counts", () => {
  const d = largeAssetLibrary(8, 2);
  const [first, second] = Object.values(d.assets);
  d.assets.alias = { ...first, id: "alias" };
  const src = assetSrc(first);
  d.nodes.node_0.image = { assetId: first.id, src, alt: "", width: 1, height: 1 };
  d.nodes.node_0.styles = { base: { default: { background: `url('${src}#icon'), url('${src}')` }, hover: { backgroundImage: `image-set("${src}" 1x)` } } };
  d.nodes.node_1.styles = { mobile: { default: { backgroundImage: `url('${src}')` } } };
  equivalent(d);
  assert.equal(assetUsage(d).get(first.id), 3);
  assert.equal(assetUsage(d).get("alias"), 2);
  assert.equal(assetUsage(d).has(second.id), false);
});

test("exact and fragment source IDs are both retained, including embedded SVG data", () => {
  const d = largeAssetLibrary(1, 1);
  const base = "data:image/svg+xml,%3Csvg%3E%3C/svg%3E";
  d.assets = Object.fromEntries([base, `${base}#a`, `${base}#a#b`, ""].map((src, i) => {
    const id = `embedded_${i}`;
    return [id, { id, name: `${id}.svg`, dataUrl: src, width: 1, height: 1 }];
  }));
  d.nodes.node_0.styles = { base: { default: { backgroundImage: `url('${base}#a#b')` } } };
  equivalent(d);
  assert.equal(assetUsage(d).get("embedded_0"), 1);
  assert.equal(assetUsage(d).get("embedded_2"), 1);
  assert.equal(assetUsage(d).has("embedded_3"), false);
});

test("CSS escapes, image-set, malformed tokens, and prefix-sharing URLs match prior safety semantics", () => {
  const d = largeAssetLibrary(3, 1);
  const src = assetSrc(Object.values(d.assets)[0]);
  for (const css of [
    `url('${src}#a')`, `URL( /*comment*/ '${src}' )`, `image-set("${src}" 1x, url('${src}') 2x)`,
    `u\\72 l("\\2f ${src.slice(1)}")`, `url('${src}.backup')`, `url('${src}&v=1')`,
    `"url(${src})"`, `/* url(${src}) */ red`, `not-url(${src})`, `url('${src})`,
    `url(${src} extra)`, `@namespace "${src}"`, `@import '${src}'`, "none", "",
  ]) {
    d.nodes.node_0.styles = { base: { default: { backgroundImage: css } } };
    equivalent(d);
  }
});

test("conservative HTML, page, settings, and ZIP dependency references are unchanged", () => {
  const d = largeAssetLibrary(10, 1);
  const a = Object.values(d.assets);
  d.favicon = { assetId: a[1].id };
  d.appleTouchIcon = { assetId: a[2].id };
  d.ogImage = { assetId: a[3].id };
  d.pwa = { enabled: true, icon: { assetId: a[4].id } } as SiteDoc["pwa"];
  d.pages.p.ogImage = { assetId: a[5].id };
  d.pages.p.bodyStyles = { base: { default: { backgroundImage: `url('${assetSrc(a[6])}')` } } };
  d.pages.p.rawHtml = `<img src="${assetSrc(a[7])}"><link href="tsumu-zip-css:sheet">`;
  d.assets.sheet = { id: "sheet", name: "sheet.css", mimeType: "text/css", width: 0, height: 0, zip: { version: 1, group: "zip", path: "sheet.css", stylesheet: {
    source: "body { background: url(dep.png) }", references: [{ url: "dep.png", assetId: a[8].id, suffix: "" }],
  } } };
  equivalent(d);
  assert.equal(assetUsage(d).size, 10);
  assert.equal(assetUsage(d).has(a[9].id), false);
});

test("indexed usage is equivalent across mixed deterministic libraries", () => {
  let seed = 41;
  const random = (n: number) => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed % n; };
  for (let i = 0; i < 60; i++) {
    const d = largeAssetLibrary(24, 6);
    const assets = Object.values(d.assets);
    for (let n = 0; n < 6; n++) {
      const asset = assets[random(assets.length)];
      const src = assetSrc(asset);
      const values = [`url('${src}')`, `url('${src}#icon')`, `image-set('${src}' 1x)`, `url('${src}.backup')`, `/* url('${src}') */`, "red"];
      d.nodes[`node_${n}`].styles = { base: { default: { backgroundImage: values[random(values.length)] }, hover: { background: values[random(values.length)] } } };
      if (random(2)) d.nodes[`node_${n}`].media = { assetId: asset.id, kind: "video", src: "" };
    }
    equivalent(d);
  }
});

test("large library usage stays exact for 5,000 images and 200 styled nodes", () => {
  const d = largeAssetLibrary(5_000, 200);
  const usage = assetUsage(d);
  assert.equal(usage.size, 200);
  assert.ok([...usage.values()].every((count) => count === 1));
  const before = JSON.stringify(d);
  assetUsage(d);
  assert.equal(JSON.stringify(d), before);
});
