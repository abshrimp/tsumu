import assert from "node:assert/strict";
import { test } from "node:test";
import { assetMediaUrl, validAssetSuffix } from "../lib/media-url";
import { mediaSrc, replaceEmbeddedAsset } from "../lib/assets";
import { safeResourceUrl } from "../lib/url-policy";
import { createInitialDoc, makeMedia } from "../lib/presets";
import { validSiteDoc } from "../lib/doc-tree";
import { validateImportedDoc } from "../lib/site-import-format";

function fixture() {
  const doc = createInitialDoc();
  const node = makeMedia("video");
  node.media = { kind: "video", src: "", assetId: "movie", assetSuffix: "?v=a%26b#t=3,7",
    sources: [{ src: "", assetId: "movie", assetSuffix: "#t=1", type: "video/mp4", media: "(min-width: 1px)" }] };
  doc.assets.movie = { id: "movie", name: "movie.mp4", mimeType: "video/mp4", dataUrl: "data:video/mp4;base64,AQID", width: 1, height: 1 };
  doc.nodes[node.id] = node;
  doc.pages[doc.pageOrder[0]].children = [node.id];
  return { doc, node };
}

test("media asset suffixes preserve bytes without replacing the resource URL", () => {
  const suffix = "?v=a%26b&lang=ja#t=3,7";
  assert.equal(assetMediaUrl("/assets/movie.mp4", suffix), "/assets/movie.mp4" + suffix);
  assert.equal(assetMediaUrl("/api/assets/file?path=movie", suffix), "/api/assets/file?path=movie&v=a%26b&lang=ja#t=3,7");
  assert.equal(assetMediaUrl("data:video/mp4;base64,AQID", suffix), "data:video/mp4;base64,AQID#t=3,7");
  assert.equal(assetMediaUrl("", suffix), "");
  for (const invalid of ["javascript:alert(1)", "//evil.test/", "file.mp4", "#a\nb", "?a\u0000", {}, 123]) {
    assert.equal(validAssetSuffix(invalid), false);
    assert.equal(assetMediaUrl("/assets/movie.mp4", invalid), "/assets/movie.mp4");
  }
  assert.equal(safeResourceUrl("data:video/mp4;base64,AQID#t=3,7"), "data:video/mp4;base64,AQID#t=3,7");
  assert.equal(safeResourceUrl("data:text/html;base64,AQID#t=3,7"), "#");
  assert.equal(safeResourceUrl("data:video/mp4;base64,AQID#t=3\n7"), "#");
});

test("native source suffixes survive persistence and storage relocation", () => {
  const { doc, node } = fixture();
  assert.equal(validSiteDoc(doc), true);
  assert.deepEqual(validateImportedDoc(JSON.parse(JSON.stringify(doc))), doc);
  assert.equal(mediaSrc(doc, node.media!), "data:video/mp4;base64,AQID#t=3,7");
  replaceEmbeddedAsset(doc, "movie", "assets/restored.mp4");
  assert.equal(mediaSrc(doc, node.media!), "/api/assets/file?path=assets%2Frestored.mp4&v=a%26b#t=3,7");
  assert.equal(mediaSrc(doc, node.media!.sources![0]), "/api/assets/file?path=assets%2Frestored.mp4#t=1");
  assert.equal(validSiteDoc(doc), true);
});

test("import and persistence reject malformed suffixes and dangling source assets", () => {
  for (const change of [
    (m: any) => { m.assetSuffix = "javascript:alert(1)"; },
    (m: any) => { delete m.assetId; },
    (m: any) => { m.sources[0].assetSuffix = "#bad\nfragment"; },
    (m: any) => { m.sources[0].assetId = "missing"; },
    (m: any) => { m.sources[0].type = {}; },
    (m: any) => { m.sources = {}; },
  ]) {
    const { doc, node } = fixture();
    change(node.media);
    assert.equal(validSiteDoc(doc), false);
    assert.throws(() => validateImportedDoc(doc));
  }
});


test("source alternatives relocate on restore and participate in publication checks and copying", async () => {
  const { rebindImportedAssetUrls } = await import("../lib/imported-asset-urls");
  const { runChecks } = await import("../lib/generator/checks");
  const { buildClipPayload, remapAssetIds } = await import("../lib/clip-transfer");
  const { doc, node } = fixture();
  node.media!.assetId = undefined;
  node.media!.assetSuffix = undefined;
  node.media!.sources!.push({ src: "data:video/mp4;base64,AQID#t=9" });
  const original = structuredClone(doc);
  doc.assets.movie.path = "assets/restored.mp4";
  delete doc.assets.movie.dataUrl;
  rebindImportedAssetUrls(original, doc);
  assert.equal(node.media!.sources![1].src, "/api/assets/file?path=assets%2Frestored.mp4#t=9");
  const payload = buildClipPayload(doc, { nodes: [node], rootIds: [node.id] });
  assert.ok(payload.assets!.movie);
  const moved = remapAssetIds(node, new Map([["movie", "copy-movie"]]));
  assert.equal(moved.media!.sources![0].assetId, "copy-movie");
  assert.equal(moved.media!.sources![0].assetSuffix, "#t=1");
  delete doc.assets.movie;
  assert.ok(runChecks(doc).some(check => check.level === "error" && check.help === "img-add"));
});
