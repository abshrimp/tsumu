import assert from "node:assert/strict";
import { test } from "node:test";
import JSZip from "jszip";
import { applyHtmlZipPage, readHtmlZip } from "../lib/html-zip";
import { generateProject } from "../lib/generator";
import { generateExportProject } from "../lib/export-formats";
import { importedAssetUrl } from "../lib/generator/imported-assets";
import { createInitialDoc } from "../lib/presets";
import type { Asset } from "../lib/types";

for (const modules of [false, true]) {
  test(`reimport preserves another page's ZIP ${modules ? "modules" : "nested stylesheets"}`, async (t) => {
    let uploads = 0;
    t.mock.method(globalThis, "fetch", async () =>
      Response.json({ path: "assets/upload-" + ++uploads }));
    const archive = new JSZip()
      .file("index.html", modules ? '<script type="module" src="main.js"></script>' : '<link href="main.css" rel="stylesheet">')
      .file("main.css", '@import "theme.css";')
      .file("theme.css", '@font-face{src:url(font.woff2)}')
      .file("font.woff2", "first");
    if (modules) archive.file("main.js", 'export const font = new URL("./font.woff2", import.meta.url);');
    const read = async (existing: Asset[] = []) =>
      readHtmlZip(await archive.generateAsync({ type: "uint8array" }), undefined, undefined, existing, true);
    const before = await read();
    const old = structuredClone(before);
    archive.file("font.woff2", "second");
    const after = await read(before.assets);
    assert.deepEqual(before, old);
    assert.equal(uploads, old.assets.length + 1, "only new bytes are uploaded");
    const find = (assets: Asset[], path: string) => assets.find(a => a.zip!.path === path)!;
    for (const path of ["main.css", "theme.css"]) {
      assert.notEqual(find(after.assets, path).id, find(old.assets, path).id);
      assert.equal(find(after.assets, path).path, find(old.assets, path).path);
    }
    const doc = createInitialDoc();
    doc.pageOrder = ["old", "new"];
    const page = Object.values(doc.pages)[0];
    doc.pages = Object.fromEntries(([["old", before], ["new", after]] as const).map(([id, zip]) => {
      return [id, { ...page, id, slug: id, children: [], rawHtml: zip.source, htmlZip: zip.zip }];
    }));
    doc.assets = Object.fromEntries([...before.assets, ...after.assets].map(a => [a.id, a]));
    const project = generateProject(doc);
    const html = generateExportProject(doc, "html");
    for (const [slug, version] of [["old", before], ["new", after]] as const) {
      const font = find(version.assets, "font.woff2");
      const theme = doc.assets[find(version.assets, "main.css").zip!.stylesheet!.references[0].assetId];
      assert.equal(doc.assets[theme.zip!.stylesheet!.references[0].assetId].path, font.path);
      if (modules) {
        const entry = find(version.assets, "main.js");
        const url = importedAssetUrl(entry)!;
        const route = JSON.parse(/^const html = (.*);$/m.exec(project.files[`app/${slug}/route.ts`])![1]);
        assert.ok(route.includes('src="' + url + '"'));
        assert.ok(html.files[`${slug}/index.html`].includes('src="..' + url + '"'));
        assert.equal(project.remoteAssets["public" + url.replace(/main\.js$/, "font.woff2")], font.path);
      }
    }
    const repeated = await read(after.assets);
    assert.deepEqual(repeated.zip, after.zip);
    assert.equal(uploads, old.assets.length + 1);
  });
}

test("committing a ZIP media update reuses unshared members without erasing panel history", async t => {
  let uploads = 0;
  t.mock.method(globalThis, "fetch", async () => Response.json({ path: "assets/upload-" + ++uploads }));
  const archive = new JSZip().file("index.html", '<script src="main.js"></script>')
    .file("main.js", 'new URL("./font.woff2", import.meta.url)')
    .file("theme.css", '@font-face{src:url(font.woff2)}').file("font.woff2", "first");
  const read = async (previous: Asset[] = []) =>
    readHtmlZip(await archive.generateAsync({ type: "uint8array" }), undefined, undefined, previous, true);
  const doc = createInitialDoc(), page = doc.pages[doc.pageOrder[0]];
  const first = await read();
  applyHtmlZipPage(doc, page.id, first);
  const original = structuredClone(doc);
  const assets = () => page.htmlZip!.assetIds.map(id => doc.assets[id]);
  const ids = () => new Map(assets().map(asset => [asset.zip!.path, asset.id]));
  const before = ids();
  archive.file("font.woff2", "second");
  const staged = await read(assets());
  // Another page can start using this archive after the upload has completed.
  const shared = structuredClone(doc), duplicate = { ...structuredClone(page), id: "copy", slug: "copy" };
  shared.pages.copy = duplicate;
  shared.pageOrder.push("copy");
  applyHtmlZipPage(shared, page.id, staged);
  for (const id of duplicate.htmlZip!.assetIds) assert.deepEqual(shared.assets[id], original.assets[id]);
  assert.ok(shared.pages[page.id].htmlZip!.assetIds.every(id => !duplicate.htmlZip!.assetIds.includes(id)));

  const linked = structuredClone(original);
  const previousModule = linked.assets[before.get("main.js")!];
  linked.customHeadHtml = '<script src="' + importedAssetUrl(previousModule) + '"></script>';
  applyHtmlZipPage(linked, page.id, staged);
  assert.deepEqual(linked.assets[previousModule.id], original.assets[previousModule.id]);
  assert.ok(!linked.pages[page.id].htmlZip!.assetIds.includes(previousModule.id));

  applyHtmlZipPage(doc, page.id, staged);
  const after = ids();
  assert.equal(after.get("main.js"), before.get("main.js"));
  assert.equal(after.get("theme.css"), before.get("theme.css"));
  assert.notEqual(after.get("font.woff2"), before.get("font.woff2"));
  assert.deepEqual(doc.assets[before.get("font.woff2")!], original.assets[before.get("font.woff2")!]);
  assert.equal(Object.keys(doc.assets).length, Object.keys(original.assets).length + 1);
  assert.equal(doc.assets[before.get("theme.css")!].zip!.stylesheet!.references[0].assetId, after.get("font.woff2"));
  const module = doc.assets[before.get("main.js")!];
  const fontPath = "public" + importedAssetUrl(module)!.replace(/main\.js$/, "font.woff2");
  assert.equal(generateProject(doc).remoteAssets[fontPath], doc.assets[after.get("font.woff2")!].path);
  assert.equal(uploads, 4);

  // Simulate a stale path collision produced before ZIP version separation.
  const oldFont = doc.assets[before.get("font.woff2")!];
  oldFont.zip!.group = module.zip!.group;
  const collidingGroup = module.zip!.group;
  applyHtmlZipPage(doc, page.id, await read(assets()));
  assert.notEqual(doc.assets[before.get("main.js")!].zip!.group, collidingGroup);
  assert.equal(Object.keys(doc.assets).length, Object.keys(original.assets).length + 1);
  assert.equal(uploads, 4);
});
