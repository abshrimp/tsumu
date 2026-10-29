import assert from "node:assert/strict";
import { test, describe } from "node:test";
import { assetUsage } from "../lib/asset-usage";
import { assetSrc } from "../lib/assets";
import { referenceAssetUsage } from "./helpers/asset-usage-reference";
import { largeAssetLibrary } from "./helpers/large-asset-library";
import { type SiteDoc, type Asset } from "../lib/types";
import { ASSET_CACHE_MAX_AGE, assetCacheControl } from "../lib/asset-cache";
import { loadAllTrash } from "../lib/asset-trash-client";
import { assetDisplayKind, assetExtensionLabel, isVisualAsset } from "../lib/asset-display";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AssetGrid } from "../components/ImagePicker";
import { useEditor } from "../lib/store";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { transformSync } from "esbuild";

describe("asset-usage", () => {
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
});

describe("asset-cache", () => {
  test("immutable asset paths are cached privately for a year", () => {
    assert.equal(assetCacheControl(null), `private, max-age=${ASSET_CACHE_MAX_AGE}, immutable`);
    assert.equal(ASSET_CACHE_MAX_AGE, 31_536_000);
  });

  test("signed URLs are cached only until the signature expires", () => {
    const now = 1_000_000;
    assert.equal(assetCacheControl(now + 3_600_000, now), "private, max-age=3600, immutable");
    assert.equal(assetCacheControl(now + 999, now), "private, no-store");
    assert.equal(assetCacheControl(now - 1, now), "private, no-store");
  });
});

describe("asset-trash-client", () => {
  test("select-all loads beyond the first 100 Trash entries", async () => {
    const paths = Array.from({ length: 205 }, (_, i) => ({ path: `assets/${i}.png` }));
    const offsets: number[] = [];
    const items = await loadAllTrash(async (offset) => {
      offsets.push(offset);
      return { items: paths.slice(offset, offset + 100), hasMore: offset + 100 < paths.length };
    });
    assert.deepEqual(offsets, [0, 100, 200]);
    assert.deepEqual(items, paths);
  });

  test("repeated assets are selected once, and malformed pagination fails", async () => {
    const result = await loadAllTrash(async offset => offset
      ? { items: [{ path: "assets/a" }, { path: "assets/b" }], hasMore: false }
      : { items: [{ path: "assets/a" }], hasMore: true });
    assert.deepEqual(result, [{ path: "assets/a" }, { path: "assets/b" }]);
    await assert.rejects(loadAllTrash(async () => ({ items: [], hasMore: true })));
  });
});

describe("asset-display", () => {
  test("CSS, scripts, JSON and fonts are not displayed or inserted as images", () => {
    for (const [name, mimeType, expected] of [
      ["main.css", "text/css", "css"],
      ["app.js", "text/javascript", "javascript"],
      ["client.mjs", "application/javascript", "javascript"],
      ["app.woff2", "font/woff2", "font"],
      ["data.json", "application/json", "json"],
      ["readme.txt", "text/plain", "document"],
      ["bundle.zip", "application/zip", "archive"],
      ["file.unknown", "application/octet-stream", "file"],
    ] as const) {
      assert.equal(assetDisplayKind({ name, mimeType }), expected, name);
      assert.equal(isVisualAsset({ name, mimeType }), false, name);
    }
  });

  test("visual formats still have media previews, including assets without MIME metadata", () => {
    for (const [name, mimeType, expected] of [
      ["image.svg", "image/svg+xml", "image"],
      ["photo.png", undefined, "image"],
      ["song.mp3", "", "audio"],
      ["clip.webm", "video/webm", "video"],
    ] as const) {
      assert.equal(assetDisplayKind({ name, mimeType }), expected);
      assert.equal(isVisualAsset({ name, mimeType }), true);
    }
    assert.equal(assetExtensionLabel({ name: "bundle.woff2" }), "WOFF2");
    assert.equal(assetExtensionLabel({ name: "script.js" }), "JS");
    assert.equal(assetExtensionLabel({ name: "longfilename", mimeType: "text/css" }), "CSS");
  });
});

describe("asset-picker-types", () => {
  test("image pickers do not offer CSS, scripts, documents or fonts as images", () => {
    const initial = useEditor.getInitialState();
    const original = initial.doc;
    const asset = (id: string, name: string, mimeType?: string): Asset => ({ id, name, mimeType, path: `assets/${name}`, width: 1, height: 1 });
    const assets = [
      asset("png", "photo.png", "image/png"), asset("svg", "logo.svg", "image/svg+xml"),
      asset("untyped", "untyped.png"), asset("css", "styles.css", "text/css"),
      asset("js", "app.js", "text/javascript"), asset("pdf", "manual.pdf", "application/pdf"),
      asset("font", "font.woff2", "font/woff2"), asset("video", "movie.mp4", "video/mp4"),
      asset("audio", "sound.mp3", "audio/mpeg"),
    ];
    initial.doc = { ...original, assets: Object.fromEntries(assets.map(a => [a.id, a])) };
    try {
      const markup = renderToStaticMarkup(createElement(AssetGrid, { kind: "image", onPick() {} }));
      for (const name of ["photo.png", "logo.svg", "untyped.png"]) assert.ok(markup.includes(`data-tip="${name}"`), name);
      for (const name of ["styles.css", "app.js", "manual.pdf", "font.woff2", "movie.mp4", "sound.mp3"]) assert.ok(!markup.includes(`data-tip="${name}"`), name);
      for (const [kind, name] of [["video", "movie.mp4"], ["audio", "sound.mp3"]] as const) {
        const media = renderToStaticMarkup(createElement(AssetGrid, { kind, onPick() {} }));
        assert.ok(media.includes(`data-tip="${name}"`));
        assert.ok(!media.includes('data-tip="photo.png"'));
      }
    } finally { initial.doc = original; }
  });
});

describe("image-picker-scope", () => {
  function fixture() {
    const path = resolve("components/ImagePicker.tsx"), require = createRequire(path);
    let query = "", assets: any = {};
    const mod = { exports: {} as any };
    new Function("require", "module", "exports", transformSync(readFileSync(path, "utf8"), { loader: "tsx", format: "cjs", jsx: "automatic" }).code)(
      (id: string) => id === "react" ? { useId: () => "test-image-field", useState: () => [query, (v: string) => { query = v; }], useRef: () => ({ current: null }) } :
        id === "../lib/assets" ? { assetKind: () => "image", assetSrc: (a: any) => a.url } :
        id === "../lib/store" ? { useEditor: (select: any) => select({ doc: { assets } }) } :
        id === "../lib/use-pending-import" ? { usePendingImport: () => ({ busy: false, cancel() {} }) } : require(id), mod, mod.exports);
    const flatten = (v: any): any[] => Array.isArray(v) ? v.flatMap(flatten) : v && typeof v === "object" ? [v, ...flatten(v.props?.children)] : [];
    return {
      input: (editTarget: string) => flatten(mod.exports.default({ editTarget, value: { url: "/same.png" }, onChange() {} })).find(x => x.type === "input"),
      grid: () => flatten(mod.exports.AssetGrid({ kind: "image", onPick() {} })),
      setAssets: (count: number) => { assets = Object.fromEntries(Array.from({ length: count }, (_, i) => [String(i), { id: String(i), name: `photo${i}.png`, mimeType: "image/png", url: "/image.png" }])); },
    };
  }
  test("image URL drafts have separate React identities for different edit targets", () => {
    const f = fixture();
    assert.notEqual(f.input("page-a").key, f.input("page-b").key);
    assert.equal(f.input("page-a").props.defaultValue, "/same.png");
  });
  test("asset search remains clearable when deletion reduces the library below five items", () => {
    const f = fixture(); f.setAssets(5);
    f.grid().find(x => x.type === "input").props.onChange({ target: { value: "missing" } });
    f.setAssets(3);
    const input = f.grid().find(x => x.type === "input");
    assert.ok(input); assert.equal(input.props.value, "missing");
    f.grid().find(x => x.type === "button" && x.props["aria-label"] === "Clear search").props.onClick();
    assert.equal(f.grid().filter(x => x.type === "button" && x.props.className === "img-pick-cell").length, 3);
  });
});

describe("imported-asset-usage", () => {
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
});
