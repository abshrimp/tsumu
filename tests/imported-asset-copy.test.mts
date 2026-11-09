import assert from "node:assert/strict";
import { test } from "node:test";
import { assetSrc } from "../lib/assets";
import { buildClipPayload } from "../lib/clip-transfer";
import { validSiteDoc } from "../lib/doc-tree";
import { generateProject } from "../lib/generator";
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
