import assert from "node:assert/strict";
import { test } from "node:test";
import JSZip from "jszip";
import { cssAssetReferences, replaceCssAssetUrls } from "../lib/css-assets";
import { attachZipDependencies, exportZipStylesheet, zipAssetClosure, zipCssPreviewUrls, zipCssUrl, zipStylesheet } from "../lib/zip-css";
import { assetSrc, withSignedAssetUrls } from "../lib/assets";
import { readHtmlZip } from "../lib/html-zip";
import { buildClipPayload, mergeClipDeps, remapAssetIds } from "../lib/clip-transfer";
import { buildPagePayload, applyPagePayload } from "../lib/page-transfer";
import { createInitialDoc } from "../lib/presets";
import { generateProject } from "../lib/generator";
import { assetUsage } from "../components/left-panel/AssetsTab";
import type { Asset, DocNode } from "../lib/types";

const sheet = (id: string, path: string, source: string, group = "zip-a"): Asset => ({
  id, name: path.replaceAll("/", "-"), width: 0, height: 0, mimeType: "text/css",
  dataUrl: "data:text/css;base64," + Buffer.from(source).toString("base64"),
  zip: { version: 1, group, path, stylesheet: { source, references: [] } },
});
const image = (id = "photo", path = "images/photo.svg"): Asset => ({
  id, name: path.replaceAll("/", "-"), width: 1, height: 1, mimeType: "image/svg+xml", path: "assets/" + id,
  zip: { version: 1, group: "zip-a", path },
});
const record = (list: Asset[]) => Object.fromEntries(list.map((a) => [a.id, a]));
const cssFrom = (url: string) => decodeURIComponent(url.slice(url.indexOf(",") + 1).split("#")[0]);

test("CSS tokenizer supports quoted/escaped imports without changing namespace URIs, comments or strings", () => {
  const css = `/* @import 'no.css'; url(no.png) */\n@\\69mport /* gap */ 'nested\\2e css' layer(theme) supports(display: grid) screen;\n@import url("nested.css") print;\n@namespace svg url("nested.css"); @namespace "nested.css";\n.x{content:"@import 'no.css'; url(no.png)";background:image-set("nested.css" 1x,url(nested.css) 2x)}`;
  assert.deepEqual(cssAssetReferences(css).map((r) => r.url), ["nested.css", "nested.css", "nested.css", "nested.css"]);
  const out = replaceCssAssetUrls(css, new Map([["nested.css", "data:text/css,foo"]]));
  assert.ok(out.includes("layer(theme) supports(display: grid) screen"));
  assert.ok(out.includes('@namespace svg url("nested.css")'));
  assert.ok(out.includes('@namespace "nested.css"'));
  assert.ok(out.includes('content:"@import'));
});

test("separate preview sheets preserve conditions/order/repetition and prune only ancestor cycles", () => {
  const a = sheet("a", "css/a.css", `@import "b.css" layer(theme) supports(display: grid) screen;\n@import url('b.css') print;\n@namespace svg "http://www.w3.org/2000/svg";\n.x{background:url('../images/photo.svg?v=1#icon');filter:url(#local);content:"../images/photo.svg"}`);
  const b = sheet("b", "css/b.css", '@import "a.css"; @namespace svg "http://www.w3.org/2000/svg"; svg|rect{fill:red}');
  const img = image();
  attachZipDependencies([a, b, img]);
  const assets = record([a, b, img]);
  assert.deepEqual([...zipAssetClosure(assets, [a.id])].sort(), ["a", "b", "photo"]);
  const urls = zipCssPreviewUrls(assets, ["a", "b"], (asset) => `https://editor.test/file?path=${asset.id}&sig=abc`);
  const text = cssFrom(urls.get("a")!);
  const refs = cssAssetReferences(text).map((r) => r.url);
  assert.equal(refs[0], refs[1], "repeated imports are retained, not globally deduplicated");
  assert.ok(text.includes("layer(theme) supports(display: grid) screen"));
  assert.ok(text.includes(") print;"));
  assert.equal(refs[2], "https://editor.test/file?path=photo&sig=abc&v=1#icon");
  assert.equal(refs[3], "#local");
  const inner = cssFrom(refs[0]);
  assert.ok(inner.includes('svg|rect{fill:red}'));
  assert.equal(cssAssetReferences(inner)[0].url, "data:text/css;charset=utf-8,");
  assert.ok(cssFrom(urls.get("b")!).includes("svg|rect{fill:red}"), "a separate root is not pruned");
  assert.ok(text.includes('content:"../images/photo.svg"'));
});

test("data dependencies drop cache queries without corrupting bytes and keep SVG fragments; export keeps full suffixes", () => {
  const a = sheet("a", "a.css", '@import "b.css?v=2#x";.x{background:url("images/photo.svg?v=1#icon")}');
  const b = sheet("b", "b.css", '.x{color:red}');
  const img = { ...image(), path: undefined, dataUrl: "data:image/svg+xml;base64,PHN2Zy8+" };
  attachZipDependencies([a, b, img]);
  const text = cssFrom(zipCssPreviewUrls(record([a, b, img]), ["a"], assetSrc).get("a")!);
  const refs = cssAssetReferences(text).map((r) => r.url);
  assert.ok(refs[0].endsWith("#x"));
  assert.equal(cssFrom(refs[0]), ".x{color:red}");
  assert.equal(refs[1], img.dataUrl + "#icon");
  assert.equal(exportZipStylesheet(a, new Map([["b", "nested.css"], ["photo", "photo.svg"]])), '@import "nested.css?v=2#x";.x{background:url("photo.svg?v=1#icon")}');
});

test("preview work is bounded for amplifying DAGs while a 200-sheet chain works", () => {
  const chain = Array.from({ length: 200 }, (_, i) => sheet("s" + i, i + ".css", i === 199 ? '.x{color:red}' : `@import "${i + 1}.css";`));
  attachZipDependencies(chain);
  assert.ok(zipCssPreviewUrls(record(chain), ["s0"], assetSrc).get("s0")!.length < 1024 * 1024);
  const dag = Array.from({ length: 16 }, (_, i) => sheet("d" + i, i + ".css", i === 15 ? ".x{color:red}" : `@import "${i + 1}.css";@import "${i + 1}.css";`));
  attachZipDependencies(dag);
  assert.throws(() => zipCssPreviewUrls(record(dag), ["d0"], assetSrc), /CSS/);
});

test("export rewrites source bytes once, retains native cycles, and never emits original CSS as remote/binary", () => {
  const doc = createInitialDoc();
  const a = sheet("a", "css/a.css", '@import "b.css";.x{background:url("../images/photo.svg#icon")}');
  const b = { ...sheet("b", "css/b.css", '@import "a.css";'), path: "assets/original-b" };
  const img = image();
  attachZipDependencies([a, b, img]);
  doc.assets = record([a, b, img]);
  doc.pages[doc.pageOrder[0]].rawHtml = `<link rel="stylesheet" href="${zipCssUrl("a")}?v=1#theme">`;
  const project = generateProject(doc);
  assert.equal(project.files["public/assets/css-a.css"], '@import "css-b.css";.x{background:url("images-photo.svg#icon")}');
  assert.equal(project.files["public/assets/css-b.css"], '@import "css-a.css";');
  assert.equal(project.remoteAssets["public/assets/images-photo.svg"], "assets/photo");
  for (const name of ["public/assets/css-a.css", "public/assets/css-b.css"]) {
    assert.equal(project.binaries[name], undefined);
    assert.equal(project.remoteAssets[name], undefined);
  }
  assert.ok(Object.values(project.files).some((s) => s.includes("/assets/css-a.css?v=1#theme")));
  assert.ok(Object.values(project.files).every((s) => !s.includes("tsumu-zip-css:")));
});

test("copy collects transitive local CSS, dedupes binary assets across archive groups and remaps edges only", () => {
  const doc = createInitialDoc();
  const a = sheet("a", "a.css", '@import "b.css"; /* photo */');
  const b = sheet("b", "b.css", '.x{background:url("images/photo.svg");content:"photo"}');
  const img = image();
  attachZipDependencies([a, b, img]);
  doc.assets = record([a, b, img]);
  doc.pages[doc.pageOrder[0]].rawHtml = `<link rel="stylesheet" href="${zipCssUrl("a")}">`;
  const payload = buildPagePayload(doc, doc.pageOrder);
  assert.deepEqual(Object.keys(payload.deps.assets).sort(), ["a", "b", "photo"]);
  const target = createInitialDoc();
  target.assets.existing = { ...img, id: "existing", zip: { version: 1, group: "other-archive", path: "other/image.svg" } };
  applyPagePayload(target, payload);
  assert.equal(target.assets.photo, undefined);
  assert.equal(target.assets.b.zip!.stylesheet!.references[0].assetId, "existing");
  assert.equal(target.assets.b.zip!.stylesheet!.source, b.zip!.stylesheet!.source);
  const preview = zipCssPreviewUrls(target.assets, ["a"], assetSrc);
  assert.ok(cssFrom(cssAssetReferences(cssFrom(preview.get("a")!))[0].url).includes("assets%2Fphoto"));
  const usage = assetUsage(target);
  assert.ok(usage.has("a") && usage.has("b") && usage.has("existing"));
});

test("identical CSS bytes with different archive bases are separate identities, including conflicting copied IDs", () => {
  const a = sheet("a", "one/style.css", 'body{background:url("pic.svg")}');
  const b = sheet("b", "two/style.css", a.zip!.stylesheet!.source);
  const left = image("left", "one/pic.svg"), right = image("right", "two/pic.svg");
  attachZipDependencies([a, b, left, right]);
  const doc = createInitialDoc();
  doc.assets = record([a, b, left, right]);
  const payload = buildClipPayload(doc, { nodes: [{ id: "node", type: "code", children: [], styles: {}, code: { html: `${zipCssUrl("a")} ${zipCssUrl("b")}` } } as DocNode], rootIds: ["node"] });
  const target = createInitialDoc();
  target.assets.a = { ...sheet("a", "old/style.css", "body{color:blue}") };
  const remap = mergeClipDeps(target, payload).assetIds;
  assert.notEqual(remap.get("a"), "a");
  assert.equal(target.assets.a.zip!.stylesheet!.source, "body{color:blue}");
  assert.ok(target.assets.b);
  assert.equal(Object.values(target.assets).filter((a) => zipStylesheet(a)).length, 3);
  const rendered = zipCssPreviewUrls(target.assets, [remap.get("a")!, "b"], assetSrc);
  assert.ok(cssFrom(rendered.get(remap.get("a")!)!).includes("assets%2Fleft"));
  assert.ok(cssFrom(rendered.get("b")!).includes("assets%2Fright"));
});

test("standalone CSS assets retain their bytes and large imported dependency graphs are not subject to preview limits", () => {
  const doc = createInitialDoc();
  const local = sheet("local", "local.css", 'a{color:red}');
  delete local.zip;
  const remote = { ...sheet("remote", "remote.css", 'a{color:blue}'), path: "assets/remote" };
  delete remote.zip;
  doc.assets = record([local, remote]);
  const project = generateProject(doc);
  assert.equal(project.binaries["public/assets/local.css"], Buffer.from('a{color:red}').toString("base64"));
  assert.equal(project.remoteAssets["public/assets/remote.css"], "assets/remote");
  const many = record(Array.from({ length: 2100 }, (_, i) => ({ ...image("i" + i), zip: undefined })));
  assert.equal(zipAssetClosure(many, Object.keys(many)).size, 2100);
});

test("clipboard permits only metadata-bearing text/css data URLs, never HTML or JS masquerading as CSS", () => {
  for (const dataUrl of ["data:text/html,<script>alert(1)</script>", "data:text/javascript,alert(1)", "data:application/xhtml+xml,<html/>"]) {
    const doc = createInitialDoc();
    const a = { ...sheet("a", "a.css", "a{}"), dataUrl };
    const payload = buildClipPayload({ ...doc, assets: { a } }, { nodes: [{ id: "n", code: { html: zipCssUrl("a") } } as DocNode], rootIds: ["n"] });
    mergeClipDeps(doc, payload);
    assert.equal(doc.assets.a, undefined);
  }
});

test("invalid or oversized CSS metadata fails explicitly, rather than leaking unresolved internal URLs", async () => {
  const a = sheet("a", "a.css", "a{}");
  a.zip!.version = 2 as 1;
  await assert.rejects(() => withSignedAssetUrls(`<link href="${zipCssUrl("a")}">`, { a }), /CSS/);
  await assert.rejects(() => withSignedAssetUrls(`<link href="${zipCssUrl("missing")}">`, {}), /CSS/);
});

test("real ZIP import rejects unsupported CSS encodings and excessive CSS without committing document state", async () => {
  const originalFetch = globalThis.fetch;
  const doc = createInitialDoc();
  const before = structuredClone(doc);
  let uploads = 0;
  globalThis.fetch = async () => { uploads++; return Response.json({ path: "assets/test" }); };
  try {
    for (const css of [Buffer.from('@charset "shift_jis";a{}'), Buffer.from([0xff, 0xfe, 65, 0]), Buffer.alloc(2 * 1024 * 1024 + 1, 32)]) {
      const zip = new JSZip().file("index.html", '<link href="style.css">').file("script.js", 'export {};').file("style.css", css);
      await assert.rejects(async () => {
        const result = await readHtmlZip(await zip.generateAsync({ type: "uint8array" }));
        for (const a of result.assets) doc.assets[a.id] = a;
        doc.pages[doc.pageOrder[0]].rawHtml = result.html;
      }, /UTF-8|CSS/);
      assert.deepEqual(doc, before);
    }
    assert.equal(uploads, 0, "preflight must reject invalid CSS before any asset upload");
  } finally { globalThis.fetch = originalFetch; }
});

test("import, delete-unused, delete dependency, undo and redo preserve the stylesheet graph", async () => {
  const { useEditor } = await import("../lib/store");
  const state = () => useEditor.getState();
  const before = createInitialDoc();
  state().replaceDoc(before);
  const a = sheet("a", "a.css", '@import "b.css";');
  const b = sheet("b", "b.css", '.x{background:url("images/photo.svg")}');
  const img = image();
  const unused = image("unused", "unused.svg");
  attachZipDependencies([a, b, img, unused]);
  state().updateDoc((d) => {
    d.assets = record([a, b, img, unused]);
    d.pages[d.pageOrder[0]].rawHtml = `<link rel="stylesheet" href="${zipCssUrl("a")}">`;
  });
  const imported = structuredClone(state().doc);
  state().undo();
  assert.deepEqual(state().doc, before);
  state().redo();
  assert.deepEqual(state().doc, imported);
  state().updateDoc((d) => {
    const usage = assetUsage(d);
    for (const id of Object.keys(d.assets)) if (!usage.has(id)) delete d.assets[id];
  });
  assert.deepEqual(Object.keys(state().doc.assets).sort(), ["a", "b", "photo"]);
  state().updateDoc((d) => { delete d.assets.photo; });
  assert.doesNotThrow(() => zipCssPreviewUrls(state().doc.assets, ["a"], assetSrc));
  state().undo();
  const restored = state().doc;
  assert.ok(restored.assets.photo);
  assert.equal(restored.assets.b.zip!.stylesheet!.references[0].assetId, "photo");
  assert.ok(generateProject(restored).files["public/assets/b.css"].includes("images-photo.svg"));
});


test("export resolves complete internal CSS tokens, not asset-ID prefixes", async () => {
  const { cssValue } = await import("../lib/generator/css");
  const doc = createInitialDoc();
  doc.assets = record([sheet("a", "a.css", "a{}"), sheet("ab", "ab.css", "b{}")]);
  const names = new Map([["a", "first.css"], ["ab", "second.css"]]);
  const html = `<link href="${zipCssUrl("ab")}?v=1&amp;x=2#theme"><link href="${zipCssUrl("a")}#other">`;
  assert.equal(cssValue(doc, "rawHtml", html, names), '<link href="/assets/second.css?v=1&amp;x=2#theme"><link href="/assets/first.css#other">');
  assert.throws(() => cssValue(doc, "rawHtml", '<link href="tsumu-zip-css:abc">', names), /CSS/);
});


test("invalid nested stylesheet metadata is not silently treated as a unmapped remote file", () => {
  const a = sheet("a", "a.css", '@import "b.css";');
  const b = sheet("b", "b.css", ".x{color:red}");
  attachZipDependencies([a, b]);
  b.zip!.version = 9 as 1;
  assert.throws(() => zipCssPreviewUrls(record([a, b]), ["a"], assetSrc), /CSS/);
  assert.throws(() => exportZipStylesheet(b, new Map([["a", "a.css"], ["b", "b.css"]])), /CSS/);
});

test("signing batches distinct remote paths within the endpoint limit and propagates cancellation", async () => {
  const originalFetch = globalThis.fetch;
  const batches: string[][] = [];
  globalThis.fetch = async (_url, options) => {
    const { paths } = JSON.parse(options!.body as string);
    batches.push(paths);
    assert.ok(paths.length <= 500);
    return Response.json({ urls: Object.fromEntries(paths.map((p: string) => [p, `/api/assets/file?path=${encodeURIComponent(p)}&exp=9999999999999&sig=fixture`])) });
  };
  try {
    const urls = Array.from({ length: 601 }, (_, i) => `/api/assets/file?path=assets%2F${i}`);
    const html = [...urls, ...urls].map((url) => `<img src="${url}">`).join("");
    const result = await withSignedAssetUrls(html, {}, { baseUrl: "https://editor.test/sites/example" });
    assert.deepEqual(batches.map((b) => b.length), [500, 101]);
    assert.equal(new Set(batches.flat()).size, 601);
    assert.equal((result.match(/https:\/\/editor\.test\/api\/assets\/file/g) ?? []).length, 1202);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(() => withSignedAssetUrls(html, {}, { signal: controller.signal }), { name: "AbortError" });
    assert.equal(batches.length, 2, "already-cancelled work sends no requests");
  } finally { globalThis.fetch = originalFetch; }
});


test("CSS graph source limits count UTF-8 bytes, including copied Japanese stylesheets", () => {
  const text = "/*" + "あ".repeat(400_000) + "*/";
  const a = sheet("a", "a.css", '@import "b.css";' + text);
  const b = sheet("b", "b.css", text);
  attachZipDependencies([a, b]);
  assert.ok(zipStylesheet(a) && zipStylesheet(b), "each sheet individually fits");
  assert.throws(() => zipCssPreviewUrls(record([a, b]), ["a"], assetSrc), /CSS/);
  const oversized = sheet("large", "large.css", "/*" + "あ".repeat(800_000) + "*/");
  assert.equal(zipStylesheet(oversized), undefined, "an individual non-ASCII sheet uses the same byte limit");
});


test("preview signing preserves complete absolute/protocol-relative URL boundaries and unrelated origins", async () => {
  const originalFetch = globalThis.fetch;
  const batches: string[][] = [];
  globalThis.fetch = async (_url, options) => {
    const { paths } = JSON.parse(options!.body as string);
    batches.push(paths);
    return Response.json({ urls: { "assets/a.png": "/api/assets/file?path=assets%2Fa.png&exp=9999999999999&sig=test" } });
  };
  try {
    const source = '/api/assets/file?path=assets%2Fa.png';
    const html = `<img src="${source}"><img src="https://editor.test${source}"><img src="//editor.test${source}"><img src="HTTPS://EDITOR.TEST${source}"><img src="https://other.test${source}"><img src="https://editor.test/nested${source}">`;
    const output = await withSignedAssetUrls(html, {}, { baseUrl: "https://editor.test/sites/demo" });
    const signed = 'https://editor.test/api/assets/file?path=assets%2Fa.png&exp=9999999999999&sig=test';
    assert.equal(output, `<img src="${signed}"><img src="${signed}"><img src="${signed}"><img src="${signed}"><img src="https://other.test${source}"><img src="https://editor.test/nested${source}">`);
    assert.deepEqual(batches, [["assets/a.png"]]);
  } finally { globalThis.fetch = originalFetch; }
});


test("preview absolutizes archive-external root/protocol-relative CSS URLs without changing source or exports", () => {
  const source = '@import "//cdn.example/theme.css?rev=1" screen;@font-face{src:url(/shared/font.woff2)}.x{background:url(//cdn.example/pic.png);filter:url(#local);content:"//cdn.example/literal"}';
  const a = sheet("a", "css/a.css", source);
  attachZipDependencies([a]);
  const output = cssFrom(zipCssPreviewUrls({ a }, ["a"], assetSrc, { baseUrl: "https://editor.test/sites/demo" }).get("a")!);
  assert.deepEqual(cssAssetReferences(output).map((r) => r.url), ["https://cdn.example/theme.css?rev=1", "https://editor.test/shared/font.woff2", "https://cdn.example/pic.png", "#local"]);
  assert.ok(output.includes('content:"//cdn.example/literal"'));
  assert.equal(a.zip!.stylesheet!.source, source);
  assert.equal(exportZipStylesheet(a, new Map([["a", "a.css"]])), source);
});


test("copy remaps original IDs simultaneously when a dedupe target is another conflicting source ID", () => {
  const red: Asset = { id: "asset-bravo", name: "red.png", mimeType: "image/png", dataUrl: "data:image/png;base64,RED", width: 1, height: 1 };
  const blue: Asset = { ...red, name: "blue.png", dataUrl: "data:image/png;base64,BLUE" };
  const source = createInitialDoc();
  source.assets = { "asset-alpha": { ...red, id: "asset-alpha" }, "asset-bravo": blue };
  const node = { id: "node", type: "code", styles: {}, children: [], code: { html: "asset-alpha asset-bravo" } } as DocNode;
  const payload = buildClipPayload(source, { nodes: [node], rootIds: ["node"] });
  const target = createInitialDoc();
  target.assets[red.id] = red;
  const remap = mergeClipDeps(target, payload).assetIds;
  const out = remapAssetIds({ image: { assetId: "asset-alpha" }, other: { assetId: "asset-bravo" }, html: `${zipCssUrl("asset-alpha")} ${zipCssUrl("asset-bravo")}` }, remap);
  assert.equal(out.image.assetId, "asset-bravo");
  assert.equal(target.assets[out.image.assetId].dataUrl, red.dataUrl);
  assert.equal(target.assets[out.other.assetId].dataUrl, blue.dataUrl);
  assert.notEqual(out.image.assetId, out.other.assetId);
  assert.equal(out.html, `${zipCssUrl("asset-bravo")} ${zipCssUrl(out.other.assetId)}`);
});
