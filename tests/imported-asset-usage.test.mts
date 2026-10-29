import assert from "node:assert/strict";
import { test } from "node:test";
import { assetUsage } from "../lib/asset-usage";
import type { Asset, SiteDoc } from "../lib/types";

const asset = (id: string, path: string, group = "zip_linked"): Asset => ({
  id, name: path.split("/").at(-1)!, mimeType: path.endsWith(".js") ? "text/javascript" : "image/png",
  width: 0, height: 0, path: "assets/" + id, zip: { version: 1, group, path },
});

test("used ZIP script modules protect sibling modules and resources from unused deletion", () => {
  const main = asset("main", "site/scripts/main.js");
  const chunk = asset("chunk", "site/scripts/chunk.js");
  const image = asset("image", "site/images/icon.png");
  const unrelated = asset("unrelated", "different/logo.png", "zip_unrelated");
  const doc: SiteDoc = {
    siteName: "Test", nodes: {},
    pages: { p: { id: "p", name: "Page", slug: "", title: "Test", description: "",
      children: [], customEndHtml: '<script src="/api/assets/file?path=assets%2Fmain"></script>' } },
    pageOrder: ["p"],
    assets: { main, chunk, image, unrelated },
  };
  const usage = assetUsage(doc);
  assert.ok(usage.has(main.id));
  assert.ok(usage.has(chunk.id));
  assert.ok(usage.has(image.id));
  assert.equal(usage.has(unrelated.id), false);
});
