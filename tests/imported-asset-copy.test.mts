import assert from "node:assert/strict";
import { test } from "node:test";
import { assetSrc } from "../lib/assets";
import { buildClipPayload, mergeClipDeps } from "../lib/clip-transfer";
import { validSiteDoc } from "../lib/doc-tree";
import { generateProject } from "../lib/generator";
import { htmlZipSource } from "../lib/html-zip-source";
import { importedAssetPath } from "../lib/generator/imported-assets";
import { buildPagePayload, applyPagePayload } from "../lib/page-transfer";
import { createInitialDoc, makeCode } from "../lib/presets";
import { useEditor } from "../lib/store";
import type { Asset, SiteDoc } from "../lib/types";

const asset = (id: string, path: string, group = "zip_page"): Asset => ({
  id, name: path.split("/").at(-1)!, path: "assets/" + id, width: 0, height: 0,
  mimeType: path.endsWith(".js") ? "text/javascript" : "image/png",
  zip: { version: 1, group, path },
});
function fixture() {
  const doc = createInitialDoc();
  const assets = [asset("entry", "scripts/main.js"), asset("dependency", "scripts/chunk.js"),
    asset("picture", "images/icon.png"), asset("unrelated", "other.js", "other_zip")];
  doc.assets = Object.fromEntries(assets.map(a => [a.id, a]));
  const code = makeCode();
  code.code!.html = `<script type="module" src="${assetSrc(doc.assets.entry)}"></script>`;
  doc.nodes[code.id] = code;
  doc.pages[doc.pageOrder[0]].children = [code.id];
  return { doc, code };
}
function assertCopied(doc: SiteDoc) {
  assert.deepEqual(Object.keys(doc.assets).sort(), ["dependency", "entry", "picture"]);
  assert.equal(validSiteDoc(doc), true);
  const project = generateProject(doc);
  for (const a of Object.values(doc.assets)) {
    assert.equal(project.remoteAssets[importedAssetPath(a)!], a.path);
  }
}

test("page copy retains ZIP module siblings and resource paths referenced only inside script bytes", () => {
  const { doc, code } = fixture();
  // ページ設定内のモジュールも、要素のコピーと同じ依存関係を保持する。
  doc.pages[doc.pageOrder[0]].customEndHtml = code.code!.html;
  doc.pages[doc.pageOrder[0]].children = [];
  delete doc.nodes[code.id];
  const before = structuredClone(doc);
  const payload = buildPagePayload(doc, doc.pageOrder);
  const target = createInitialDoc();
  applyPagePayload(target, payload);
  assertCopied(target);
  assert.deepEqual(doc, before);
});

test("clipboard paste retains ZIP module dependencies through undo and redo", () => {
  const { doc, code } = fixture();
  const payload = buildClipPayload(doc, { nodes: [code], rootIds: [code.id] });
  const before = structuredClone(payload);
  const target = createInitialDoc();
  const state = () => useEditor.getState();
  state().replaceDoc(target);
  state().setActivePage(target.pageOrder[0]);
  state().select(null);
  state().pasteClipboard(payload);
  const copied = state().doc;
  assertCopied(copied);
  state().undo();
  assert.deepEqual(state().doc, target);
  state().redo();
  assert.deepEqual(state().doc, copied);
  assert.deepEqual(payload, before);
});

test("copying a ZIP image alone does not pull in unused scripts from its archive", () => {
  const { doc, code } = fixture();
  code.code!.html = `<img src="${assetSrc(doc.assets.picture)}">`;
  const payload = buildClipPayload(doc, { nodes: [code], rootIds: [code.id] });
  assert.deepEqual(Object.keys(payload.assets), ["picture"]);
});

for (const conflict of ["different-id", "same-id"] as const) {
  test(`copying a ZIP script retains dependency aliases despite ${conflict} destination dedupe`, () => {
    const { doc } = fixture();
    const target = createInitialDoc();
    const original = doc.assets.picture;
    const id = conflict === "same-id" ? original.id : "existing-picture";
    target.assets[id] = { ...original, id, zip: { version: 1, group: "other_zip", path: "other.png" } };
    const existing = structuredClone(target.assets[id]);
    const payload = buildPagePayload(doc, doc.pageOrder);
    const before = structuredClone(payload);
    applyPagePayload(target, payload);
    const project = generateProject(target);
    assert.equal(project.remoteAssets[importedAssetPath(original)!], original.path);
    assert.deepEqual(target.assets[id], existing);
    assert.deepEqual(payload, before);
    assert.equal(validSiteDoc(target), true);
  });
}

test("ZIP module dependencies sharing bytes at different relative paths retain both aliases", () => {
  const { doc, code } = fixture();
  doc.assets.alias = { ...doc.assets.picture, id: "alias", zip: { ...doc.assets.picture.zip!, path: "images/second.png" } };
  const payload = buildClipPayload(doc, { nodes: [code], rootIds: [code.id] });
  const target = createInitialDoc();
  mergeClipDeps(target, payload);
  const project = generateProject(target);
  for (const a of [doc.assets.picture, doc.assets.alias]) {
    assert.equal(project.remoteAssets[importedAssetPath(a)!], a.path);
  }
  // 同じ ZIP の同じ場所なら再度貼り付けてもアセットを増やさない。
  const before = structuredClone(target.assets);
  assert.equal(mergeClipDeps(target, payload).assetIds.size, 0);
  assert.deepEqual(target.assets, before);
});

test("copies without ZIP scripts still dedupe identical image bytes across archive groups", () => {
  const { doc, code } = fixture();
  code.code!.html = `<img src="${assetSrc(doc.assets.picture)}">`;
  const target = createInitialDoc();
  target.assets.existing = { ...doc.assets.picture, id: "existing", zip: { version: 1, group: "other_zip", path: "other.png" } };
  const payload = buildClipPayload(doc, { nodes: [code], rootIds: [code.id] });
  assert.equal(mergeClipDeps(target, payload).assetIds.get("picture"), "existing");
  assert.deepEqual(Object.keys(target.assets), ["existing"]);
});

test("copied raw ZIP pages keep their archive paths and remap destination asset IDs", () => {
  const source = createInitialDoc();
  const picture = asset("picture", "images/logo.png");
  source.assets = { picture };
  const page = source.pages[source.pageOrder[0]];
  page.rawHtml = '<img src="images/logo.png">';
  page.htmlZip = { path: "index.html", assetIds: [picture.id] };
  const payload = buildPagePayload(source, [page.id]);

  const target = createInitialDoc();
  target.assets = {
    picture: { ...asset("picture", "images/other.png"), path: "assets/other" },
    alias: { ...picture, id: "alias", zip: undefined },
  };
  const original = structuredClone(target.assets);
  applyPagePayload(target, payload);
  const copied = target.pages[target.pageOrder.at(-1)!];
  const [id] = copied.htmlZip!.assetIds;
  assert.notEqual(id, picture.id);
  assert.deepEqual(target.assets[id], { ...picture, id });
  assert.deepEqual(target.assets.picture, original.picture);
  assert.deepEqual(target.assets.alias, original.alias);
  assert.equal(copied.rawHtml, page.rawHtml);
  assert.equal(htmlZipSource(copied.rawHtml!, copied.htmlZip, target.assets, a => a.path!),
    '<img src="assets/picture">');
  // A second copy reuses the destination ID assigned on the first transfer.
  const assets = structuredClone(target.assets);
  applyPagePayload(target, payload);
  assert.deepEqual(target.assets, assets);
  assert.deepEqual(target.pages[target.pageOrder.at(-1)!].htmlZip!.assetIds, [id]);
  assert.deepEqual(page.htmlZip.assetIds, [picture.id]);
});
