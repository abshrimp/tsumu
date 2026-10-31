import assert from "node:assert/strict";
import { test } from "node:test";
import { siteThumbnailImages } from "../lib/site-thumbnail";
import type { SiteDoc } from "../lib/types";

function doc(overrides: Partial<SiteDoc> = {}): SiteDoc {
  return {
    pages: { index: { id: "index", name: "Home", slug: "", title: "", description: "", children: [] } },
    pageOrder: ["index"],
    assets: {},
    ...overrides,
  } as SiteDoc;
}

test("site thumbnails prefer the home page OGP, site OGP, and favicon", () => {
  const site = doc({
    pages: { index: { id: "index", name: "Home", slug: "", title: "", description: "", children: [],
      ogImage: { url: "https://example.test/home.png" } } },
    ogImage: { url: "https://example.test/default.png" },
    favicon: { url: "https://example.test/favicon.ico" },
  });
  assert.deepEqual(siteThumbnailImages(site, "site1"), [
    { kind: "ogp", src: "https://example.test/home.png" },
    { kind: "ogp", src: "https://example.test/default.png" },
    { kind: "favicon", src: "https://example.test/favicon.ico" },
  ]);
});

test("site thumbnails fall back through missing references to the favicon and initials", () => {
  assert.deepEqual(siteThumbnailImages(doc({ favicon: { url: "https://example.test/favicon.ico" } }), "site1"), [
    { kind: "favicon", src: "https://example.test/favicon.ico" },
  ]);
  assert.deepEqual(siteThumbnailImages(doc(), "site1"), []);
  assert.deepEqual(siteThumbnailImages(doc({ ogImage: { assetId: "missing" }, favicon: { url: "" } }), "site1"), []);
});

test("site thumbnails resolve uploaded and browser-only assets for the correct site", () => {
  const site = doc({
    ogImage: { assetId: "cover" },
    favicon: { assetId: "icon" },
    assets: {
      cover: { id: "cover", name: "Cover", path: "assets/my cover.png", width: 1200, height: 630 },
      icon: { id: "icon", name: "Icon", dataUrl: "data:image/png;base64,AA==", width: 32, height: 32 },
    },
  });
  assert.deepEqual(siteThumbnailImages(site, "my-site"), [
    { kind: "ogp", src: "/api/assets/file?path=assets%2Fmy%20cover.png&site=my-site" },
    { kind: "favicon", src: "data:image/png;base64,AA==" },
  ]);
});

test("duplicate images are shown once and non-home page OGP does not take precedence", () => {
  const site = doc({
    pages: {
      about: { id: "about", name: "About", slug: "about", title: "", description: "", children: [],
        ogImage: { url: "https://example.test/about.png" } },
    },
    ogImage: { url: "https://example.test/shared.png" },
    favicon: { url: "https://example.test/shared.png" },
  });
  assert.deepEqual(siteThumbnailImages(site, "site1"), [
    { kind: "ogp", src: "https://example.test/shared.png" },
  ]);
});
