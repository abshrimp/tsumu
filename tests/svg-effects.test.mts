import assert from "node:assert/strict";
import { test } from "node:test";
import { svgUsesBlurOrShadow } from "../lib/svg-effects";
import { detectSvgFilters } from "../lib/assets";
import { cacheSvgEffect } from "../lib/svg-analysis-cache";
import { crispSvgSize } from "../lib/generator/render-helpers";
import type { Asset, DocNode, SiteDoc } from "../lib/types";

const filter = (primitive: string, markup = '<rect filter="url(#shadow)" />') =>
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40">' +
  '<defs><filter id="shadow">' + primitive + '</filter></defs>' + markup + '</svg>';

const cases: [string, string, boolean][] = [
  ["used gaussian blur", filter('<feGaussianBlur stdDeviation="3"/>'), true],
  ["gaussian blur with one nonzero axis", filter('<feGaussianBlur stdDeviation="0 3"/>'), true],
  ["zero gaussian blur", filter('<feGaussianBlur stdDeviation="0"/>'), false],
  ["used drop shadow", filter('<feDropShadow dx="2" dy="3" stdDeviation="2"/>'), true],
  ["color transform only", filter('<feColorMatrix type="saturate" values="0.5"/>'), false],
  ["unused blur filter", filter('<feGaussianBlur stdDeviation="3"/>', "<rect width='40'/>"), false],
  ["missing reference", filter('<feGaussianBlur stdDeviation="3"/>', '<rect filter="url(#missing)"/>'), false],
  ["commented filter", '<svg><!-- <filter id="shadow"><feGaussianBlur stdDeviation="3"/></filter> --><rect/></svg>', false],
  ["css inline url", filter('<feGaussianBlur stdDeviation="3"/>', '<rect style="filter: url( #shadow )"/>'), true],
  ["css inline quoted url", filter('<feGaussianBlur stdDeviation="3"/>', "<rect style=\"filter: url('#shadow')\"/>"), true],
  ["css drop-shadow function", '<svg><rect style="filter: drop-shadow(2px 3px 2px #000)"/></svg>', true],
  ["css blur function", '<svg><rect style="filter: blur(2px)"/></svg>', true],
  ["zero css blur", '<svg><rect style="filter: blur(0px)"/></svg>', false],
  ["css colors only", '<svg><rect style="filter: saturate(2) brightness(0.5)"/></svg>', false],
  ["defined but unused css selector", filter('<feGaussianBlur stdDeviation="3"/>', '<style>.missing { filter: url(#shadow); }</style><rect class="present"/>'), false],
  ["matching css class selector", filter('<feGaussianBlur stdDeviation="3"/>', '<style>.present { filter: url(#shadow); }</style><rect class="present"/>'), true],
  ["matching css descendant selector", filter('<feGaussianBlur stdDeviation="3"/>', '<style>g .present { filter: url(#shadow); }</style><g><rect class="present"/></g>'), true],
  ["css comment ignored", '<svg><style>/* .present { filter: drop-shadow(1px 1px 3px red); } */</style><rect class="present"/></svg>', false],
  ["presentation filter overridden with none", filter('<feGaussianBlur stdDeviation="3"/>', '<rect filter="url(#shadow)" style="filter:none"/>'), false],
  ["unused definition containing filtered shapes", filter('<feGaussianBlur stdDeviation="3"/>', '<defs><g filter="url(#shadow)" id="unused"><rect/></g></defs><rect/>'), false],
  ["referenced definition with shadow", filter('<feGaussianBlur stdDeviation="3"/>', '<defs><g filter="url(#shadow)" id="shape"><rect/></g></defs><use href="#shape"/>'), true],
  ["inherited SVG filter", '<svg><defs><filter id="base"><feGaussianBlur stdDeviation="2"/></filter><filter id="second" href="#base"/></defs><rect filter="url(#second)"/></svg>', true],
  ["unreferenced CSS shadow", '<svg><defs><filter id="s"><feGaussianBlur stdDeviation="2"/></filter></defs><rect/></svg>', false],
];
for (const [label, svg, expected] of cases) {
  test("SVG effect detection: " + label, () => {
    assert.equal(svgUsesBlurOrShadow(svg), expected);
  });
}

test("saved flags do not override SVG content on publication", async () => {
  const source = filter('<feColorMatrix type="saturate" values="0.5"/>');
  const old: Asset = {
    id: "old", name: "color.svg", mimeType: "image/svg+xml",
    width: 120, height: 40, svgFilter: true,
    dataUrl: "data:image/svg+xml;charset=utf-8," + encodeURIComponent(source),
  };
  const result = await detectSvgFilters({ old });
  assert.deepEqual(result.old, { svgFilter: false });
  assert.deepEqual(await detectSvgFilters({ old: { ...old, ...result.old } }), result);
});

test("the effect scan also detects CSS blur missed by the old filter-tag check", async () => {
  const asset: Asset = {
    id: "css", name: "css.svg", mimeType: "image/svg+xml", width: 30, height: 20, svgFilter: false,
    dataUrl: "data:image/svg+xml," + encodeURIComponent('<svg><rect style="filter:blur(2px)"/></svg>'),
  };
  assert.deepEqual((await detectSvgFilters({ css: asset })).css, { svgFilter: true });
});

test("the per-image override can force crisp rendering on or off", () => {
  const asset: Asset = { id: "s", name: "s.svg", mimeType: "image/svg+xml", width: 120, height: 40, svgFilter: false };
  const doc = { assets: { s: asset } } as SiteDoc;
  const node = { type: "image", image: { assetId: "s", width: 120, height: 40, src: "", alt: "" } } as DocNode;
  assert.equal(crispSvgSize(doc, node), null);
  node.image!.crispShadow = true;
  assert.deepEqual(crispSvgSize(doc, node), { width: 120, height: 40 });
  node.image!.crispShadow = false;
  asset.svgFilter = true;
  assert.equal(crispSvgSize(doc, node), null);
  node.image!.crispShadow = true;
  asset.mimeType = "image/png";
  asset.name = "s.png";
  assert.equal(crispSvgSize(doc, node), null);
});


test("remote SVGs are fetched once for repeated exports, duplicate aliases, and unchanged assets", async () => {
  const svg = filter('<feGaussianBlur stdDeviation="2"/>');
  const asset: Asset = {
    id: "cached-one", name: "cached.svg", mimeType: "image/svg+xml", width: 120, height: 40,
    // The saved flag is intentionally outdated; the first scan must replace it.
    svgFilter: false, path: "assets/svg-effect-cache-20261112-a.svg",
  };
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (!url.includes("assets%2Fsvg-effect-cache-20261112-")) throw Error("Unexpected fetch: " + url);
    requests += 1;
    return new Response(svg, { status: 200, headers: { "Content-Type": "image/svg+xml" } });
  };
  try {
    const alias = { ...asset, id: "cached-two" };
    const [first, second] = await Promise.all([
      detectSvgFilters({ a: asset, b: alias }),
      detectSvgFilters({ a: asset }),
    ]);
    assert.equal(first.a.svgFilter, true);
    assert.equal(first.b.svgFilter, true);
    assert.equal(second.a.svgFilter, true);
    assert.equal(requests, 1, "Concurrent aliases must share one remote download");

    const another = await detectSvgFilters({ a: asset });
    assert.equal(another.a.svgFilter, true);
    assert.equal(requests, 1, "Repeated exports must use the cached analysis");

    const changedPath = { ...asset, path: "assets/svg-effect-cache-20261112-b.svg" };
    await detectSvgFilters({ a: changedPath });
    assert.equal(requests, 2, "A replaced asset with a new path must be scanned");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("analysis seeded by the SVG upload is reused without downloading its new path", async () => {
  const path = "assets/svg-effect-cache-20261112-precomputed.svg";
  cacheSvgEffect(path, { svgFilter: true, width: 90, height: 30 });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw Error("An uploaded SVG must not be fetched again"); };
  try {
    const asset: Asset = { id: "precomputed", path, name: "precomputed.svg", mimeType: "image/svg+xml", width: 0, height: 0 };
    const result = await detectSvgFilters({ precomputed: asset });
    assert.deepEqual(result.precomputed, { svgFilter: true, width: 90, height: 30 });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("failed SVG downloads are not cached and are retried on the next export", async () => {
  const asset: Asset = { id: "retry", path: "assets/svg-effect-cache-20261112-retry.svg", name: "retry.svg",
    mimeType: "image/svg+xml", width: 90, height: 30 };
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(calls === 1 ? "missing" : '<svg><rect style="filter:blur(2px)"/></svg>', { status: calls === 1 ? 404 : 200 });
  };
  try {
    assert.deepEqual(await detectSvgFilters({ retry: asset }), {});
    assert.deepEqual((await detectSvgFilters({ retry: asset })).retry, { svgFilter: true });
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
