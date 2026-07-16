import assert from "node:assert/strict";
import { test } from "node:test";
import { assetUsage } from "../lib/asset-usage";
import { assetSrc } from "../lib/assets";
import { buildClipPayload } from "../lib/clip-transfer";
import { buildPagePayload, applyPagePayload } from "../lib/page-transfer";
import { generateProject } from "../lib/generator";
import { useEditor } from "../lib/store";
import { encodedCssAssetDoc, emptyAssetDestination, escapedPictureCss, escapedPictureUrl, picture, setAssetCss, sparePicture, type CssLocation } from "./helpers/encoded-css-assets";

const locations: CssLocation[] = ["node.styles", "node.customCss", "page.bodyStyles"];
const ids = (assets: object) => Object.keys(assets).sort();
function assertExport(doc: Parameters<typeof generateProject>[0]) {
  const result = generateProject(doc);
  assert.equal(result.remoteAssets["public/assets/hero.png"], picture.path);
  assert.match(result.files["styles/site.css"], /\/assets\/hero\.png/);
  assert.doesNotMatch(result.files["styles/site.css"], /api\/assets\/file/);
}

for (const location of locations) {
  for (const [syntax, css] of Object.entries({
    url: escapedPictureCss,
    function: `u\\72 l("${escapedPictureUrl}#icon")`,
    imageSet: `image-set("${escapedPictureUrl}" 1x, url("${escapedPictureUrl}") 2x)`,
    proxyQuery: `url("${escapedPictureUrl}&v=1#icon")`,
  })) {
    test(`${location} keeps escaped ${syntax} dependencies through cleanup and page copy`, () => {
      const doc = encodedCssAssetDoc(location);
      setAssetCss(doc, location, css);
      const before = structuredClone(doc);
      const usage = assetUsage(doc);
      assert.equal(usage.get(picture.id), 1);
      assert.equal(usage.has(sparePicture.id), false);
      for (const id of ids(doc.assets)) if (!usage.has(id)) delete doc.assets[id];
      assert.deepEqual(ids(doc.assets), [picture.id]);
      const payload = buildPagePayload(doc, ["p"]);
      assert.deepEqual(ids(payload.deps.assets), [picture.id]);
      const target = emptyAssetDestination();
      applyPagePayload(target, payload);
      assert.deepEqual(target.assets[picture.id], picture);
      assertExport(target);
      if (syntax === "proxyQuery") assert.match(generateProject(target).files["styles/site.css"], /hero\.png\?v=1#icon/);
      assert.deepEqual(doc.nodes, before.nodes);
      assert.deepEqual(doc.pages, before.pages);
    });
  }
}

for (const location of ["node.styles", "node.customCss"] as const) {
  for (const nested of [false, true]) {
    test(`${location} survives ${nested ? "nested component" : "node"} clipboard paste and undo/redo`, () => {
      const doc = encodedCssAssetDoc(location, nested);
      const rootIds = doc.pages.p.children;
      const payload = buildClipPayload(doc, { nodes: rootIds.map((id) => structuredClone(doc.nodes[id])), rootIds });
      assert.deepEqual(ids(payload.assets), [picture.id]);
      if (nested) assert.deepEqual(ids(payload.components), ["inner", "outer"]);
      const target = emptyAssetDestination();
      const state = () => useEditor.getState();
      state().replaceDoc(target);
      state().setActivePage("dest");
      state().select(null);
      state().setEditingComponent(null);
      state().pasteClipboard(payload);
      const pasted = structuredClone(state().doc);
      assert.deepEqual(ids(pasted.assets), [picture.id]);
      assertExport(pasted);
      assert.deepEqual(Object.values(state().doc.nodes).find((node) => node.name === "Picture")?.customCss, doc.nodes.box.customCss);
      state().undo();
      assert.deepEqual(state().doc, target);
      state().redo();
      assert.deepEqual(state().doc, pasted);
      assert.deepEqual(doc.assets[picture.id], picture);
      const pageTarget = emptyAssetDestination();
      applyPagePayload(pageTarget, buildPagePayload(doc, ["p"]));
      assertExport(pageTarget);
    });
  }
}

test("CSS occurrences count once per node or page and retain all source aliases and fragments", () => {
  const doc = encodedCssAssetDoc("node.styles");
  doc.assets.alias = { ...picture, id: "alias" };
  doc.assets.fragment = { ...picture, id: "fragment", path: undefined, dataUrl: `${assetSrc(picture)}#icon` };
  doc.nodes.box.customCss = `background: ${escapedPictureCss}; mask: url("${escapedPictureUrl}#icon");`;
  doc.nodes.box.image = { src: "", assetId: picture.id, alt: "", width: 10, height: 10 };
  doc.pages.p.bodyStyles = { base: { default: { background: `${escapedPictureCss}, ${escapedPictureCss}` } } };
  const usage = assetUsage(doc);
  assert.equal(usage.get(picture.id), 3);
  assert.equal(usage.get("alias"), 2);
  assert.equal(usage.get("fragment"), 1);
  assert.deepEqual(ids(buildPagePayload(doc, ["p"]).deps.assets), ["alias", picture.id, "fragment"].sort());
});

test("escaped stylesheet discovery retains ZIP transitive dependencies", () => {
  const doc = encodedCssAssetDoc("node.customCss");
  doc.assets.asset_stylesheet_789 = { id: "asset_stylesheet_789", name: "sheet.css", path: "assets/sheet.css", width: 0, height: 0, mimeType: "text/css", zip: {
    version: 1, group: "archive", path: "sheet.css", stylesheet: { source: "body { background: url(hero.png) }", references: [{ url: "hero.png", assetId: picture.id, suffix: "" }] },
  } };
  doc.nodes.box.customCss = String.raw`@import "\2f api/assets/file?path=assets%2Fsheet.css";`;
  assert.deepEqual([...assetUsage(doc).keys()].sort(), [picture.id, "asset_stylesheet_789"].sort());
  assert.deepEqual(ids(buildPagePayload(doc, ["p"]).deps.assets), [picture.id, "asset_stylesheet_789"].sort());
});

test("CSS discovery does not treat escaped strings, comments or unrelated URL prefixes as dependencies", () => {
  for (const location of locations) for (const css of [
    `"${escapedPictureCss.replaceAll('"', "'")}"`, `/* ${escapedPictureCss} */ red`,
    `url("${escapedPictureUrl}.backup")`, `url("${escapedPictureUrl}.backup&v=1")`,
    `url("${escapedPictureUrl})`, `@namespace "${escapedPictureUrl}"`,
  ]) {
    const doc = encodedCssAssetDoc(location);
    setAssetCss(doc, location, css);
    assert.equal(assetUsage(doc).size, 0, `${location}: ${css}`);
    assert.deepEqual(ids(buildPagePayload(doc, ["p"]).deps.assets), [], `${location}: ${css}`);
  }
});

test("conservative ID and URL text fallbacks remain in HTML, scripts and CSS comments", () => {
  for (const field of ["html", "script", "comment"] as const) {
    const doc = encodedCssAssetDoc("node.customCss");
    delete doc.nodes.box.customCss;
    if (field === "html") doc.pages.p.rawHtml = `<img src="${assetSrc(picture)}">`;
    if (field === "script") doc.pages.p.scripts = [{ id: "s", trigger: "load", pos: { x: 0, y: 0 }, steps: [{ id: "step", kind: "open-url", url: assetSrc(picture) }] }];
    if (field === "comment") doc.nodes.box.customCss = `/* ${picture.id} */`;
    assert.equal(assetUsage(doc).get(picture.id), 1);
    assert.deepEqual(ids(buildPagePayload(doc, ["p"]).deps.assets), [picture.id]);
  }
});

test("page copy includes only selected page CSS and clipboard copy omits page-only resources", () => {
  const doc = encodedCssAssetDoc("page.bodyStyles");
  doc.pages.other = { id: "other", name: "Other", slug: "other", title: "", description: "", children: [], bodyStyles: { base: { default: { backgroundImage: `url("\\2f ${assetSrc(sparePicture).slice(1)}")` } } } };
  doc.pageOrder.push("other");
  assert.deepEqual(ids(buildClipPayload(doc, { nodes: [doc.nodes.box], rootIds: ["box"] }).assets), []);
  assert.deepEqual(ids(buildPagePayload(doc, ["p"]).deps.assets), [picture.id]);
  assert.deepEqual(ids(buildPagePayload(doc, ["other"]).deps.assets), [sparePicture.id]);
});

test("optional and sparse CSS fields do not change empty payloads", () => {
  const doc = encodedCssAssetDoc("node.styles");
  doc.nodes.box.styles = { base: { hover: undefined } };
  doc.pages.p.bodyStyles = { sm: { default: undefined } };
  assert.equal(assetUsage(doc).size, 0);
  assert.deepEqual(ids(buildPagePayload(doc, ["p"]).deps.assets), []);
  assert.deepEqual(ids(buildPagePayload(doc, []).deps.assets), []);
});


test("proxy queries prefer exact sources and do not match data URL prefixes", () => {
  const doc = encodedCssAssetDoc("node.customCss");
  const exact = "asset_exact_query_789";
  doc.assets[exact] = { ...picture, id: exact, path: undefined, dataUrl: `${assetSrc(picture)}&v=1` };
  doc.nodes.box.customCss = `background: url("${escapedPictureUrl}&v=1");`;
  assert.deepEqual([...assetUsage(doc).keys()], [exact]);
  assert.deepEqual(ids(buildPagePayload(doc, ["p"]).deps.assets), [exact]);
  doc.assets = { [picture.id]: { ...picture, path: undefined, dataUrl: "data:image/png;base64,AQID" } };
  doc.nodes.box.customCss = String.raw`background: url("\64 ata:image/png;base64,AQID&v=1");`;
  assert.equal(assetUsage(doc).size, 0);
  assert.deepEqual(ids(buildPagePayload(doc, ["p"]).deps.assets), []);
});
