import { describe, before, test } from "node:test";
import assert from "node:assert/strict";
import { cssUsesAssetUrl, replaceCssAssetUrls, escapeStyleContent, rewriteCssAssetUrls, cssAssetReferences } from "../lib/css-assets";
import { replaceEmbeddedAsset, assetSrc, mediaSrc, withSignedAssetUrls } from "../lib/assets";
import { createCssValueResolver, rewriteHtmlAssetUrls } from "../lib/generator/css";
import { makeBox, createInitialDoc, makeIcon, makeCode } from "../lib/presets";
import { type SiteDoc, type Asset, type HtmlZipPage, type DocNode } from "../lib/types";
import { assetUsage } from "../lib/asset-usage";
import { buildClipPayload, parseClipPayload, mergeClipDeps, remapAssetIds } from "../lib/clip-transfer";
import { buildPagePayload, applyPagePayload } from "../lib/page-transfer";
import { generateProject } from "../lib/generator";
import { useEditor } from "../lib/store";
import { encodedCssAssetDoc, emptyAssetDestination, escapedPictureCss, escapedPictureUrl, picture, setAssetCss, sparePicture, type CssLocation } from "./helpers/encoded-css-assets";
import { expandZipCss } from "../lib/html-css-import";
import { requireEditableHtmlContent } from "../lib/html-file-import";
import { type HtmlConversion, convertHtmlToSite } from "../lib/html-to-site";
import { ZipArchive, ZipBuilder, type ZipEntry } from "../lib/zip";
import { EDITABLE_ASSETS_PATH, EDITABLE_DOC_PATH, parseSiteImport, restoreImportAssets } from "../lib/site-import";
import { IMPORT_LIMITS, validateImportedDoc } from "../lib/site-import-format";
import { parse, serializeOuter, type DefaultTreeAdapterTypes as Html } from "parse5";
import { generateExportProject, prepareExportProject } from "../lib/export-formats";
import { tr } from "../lib/i18n";
import { elements, importCallbacks } from "./helpers/pending-import";
import { createRequire } from "node:module";
import { createSiteFromFile } from "../lib/import-site-file";
import { readHtmlZip, applyHtmlZipPage } from "../lib/html-zip";
import { exportProjectZip } from "../lib/exportZip";
import { buildAssetNames } from "../lib/generator/names";
import { HTML_ZIP_LIMITS, inspectHtmlZip } from "../lib/html-zip-guard";
import { readZipEntryLimited } from "../lib/zip-stream";
import { importedAssetUrl, importedAssetPath } from "../lib/generator/imported-assets";
import { rewriteHtmlZipScriptUrls, missingHtmlZipScriptAssets } from "../lib/html-zip-script-assets";
import { runChecks } from "../lib/generator/checks";
import { htmlZipSource, rewriteHtmlZipSource } from "../lib/html-zip-source";
import { sanitizeImportedInlineIcons, sanitizeImportedSvg } from "../lib/imported-svg";
import { validSiteDoc } from "../lib/doc-tree";
import { submissionAttributes, submissionProps } from "../lib/imported-form";
import { importedAttributes, importedClass } from "../lib/imported-html-attrs";
import { openImportZip } from "../lib/zip-directory";
import { attachZipDependencies, exportZipStylesheet, zipAssetClosure, zipCssPreviewUrls, zipCssUrl, zipStylesheet } from "../lib/zip-css";
import { resolveZipReference, zipDependency } from "../lib/zip-references";

describe("css-assets", () => {
const source = "/api/assets/file?path=assets%2Flogo.svg";
const target = "/assets/logo.svg";
const replace = (css: string) => replaceCssAssetUrls(css, new Map([[source, target]]));

test("CSS asset references match whole URLs and preserve fragments, layers and syntax", () => {
  for (const quote of ['', '"', "'"]) {
    const value = `linear-gradient(red, blue), URL( ${quote}${source}#mark${quote} ), url(${quote}${source}.backup${quote})`;
    assert.equal(replace(value), value.replace(`${source}#mark`, `${target}#mark`));
    assert.equal(cssUsesAssetUrl(`url(${quote}${source}.backup${quote})`, source), false);
    assert.equal(cssUsesAssetUrl(`url(${quote}${source}?other=1${quote})`, source), false);
    assert.equal(cssUsesAssetUrl(value, source), true);
  }
});

test("comments, ordinary strings and longer data URLs are not asset references", () => {
  for (const value of [`/* url(${source}) */ red`, `"url(${source})"`, `'${source}'`, `not-url(${source})`]) {
    assert.equal(replace(value), value);
    assert.equal(cssUsesAssetUrl(value, source), false);
  }
  const data = "data:image/png;base64,AAAA";
  const value = `url('${data}BBBB'), url(${data})`;
  assert.equal(replaceCssAssetUrls(value, new Map([[data, target]])), `url('${data}BBBB'), url(${target})`);
});

test("image-set URL strings are recognized without rewriting type strings or other functions", () => {
  const value = `image-set("${source}" 1x type("${source}"), url('${source}#icon') 2x), -webkit-image-set('${source}' 1x)`;
  assert.equal(replace(value), `image-set("${target}" 1x type("${source}"), url('${target}#icon') 2x), -webkit-image-set('${target}' 1x)`);
  assert.equal(cssUsesAssetUrl(`image-set("${source}" 1x)`, source), true);
});

test("CSS escapes, escaped quotes, comments and line continuations remain safe", () => {
  assert.equal(replace(`u\\72 l("\\2f api/assets/file?path=assets%2Flogo.svg")`), `u\\72 l("${target}")`);
  assert.equal(replace(`url(/* before */ '${source}' /* after */)`), `url(/* before */ '${target}' /* after */)`);
  assert.equal(replace(`url("${source.slice(0, 5)}\\\n${source.slice(5)}")`), `url("${target}")`);
  const quoteSource = '/a"b)c.svg';
  const css = `url("/a\\"b)c.svg"), url(/a\\"b\\)c.svg)`;
  assert.equal(replaceCssAssetUrls(css, new Map([[quoteSource, '/new"(x).svg']])), `url("/new\\"(x).svg"), url(/new\\"\\(x\\).svg)`);
  const ordinary = `"escaped \\" url(${source})"`;
  assert.equal(replace(ordinary), ordinary);
});

test("exact URL takes priority over fragment fallback and replacements never cascade", () => {
  const map = new Map([[source, target], [`${source}#a`, '/exact'], [target, '/wrong']]);
  assert.equal(replaceCssAssetUrls(`url(${source}) url(${source}#a)`, map), `url(${target}) url(/exact)`);
  for (const value of [`url("${source})`, `url(${source} extra)`, `/* url(${source})`]) assert.equal(replace(value), value);
});

test("migration and export do not corrupt distinct prefix-sharing asset references", () => {
  const data = "data:image/png;base64,AAAA";
  const node = { ...makeBox(), id: 'box', styles: { base: { default: {
    backgroundImage: `url(${data}BBBB), image-set("${data}" 1x)`,
    content: `"${data}"`,
  } } } };
  const doc = { pages: {}, nodes: { box: node }, assets: { a: { id: 'a', name: 'logo.svg', width: 1, height: 1, dataUrl: data } } } as unknown as SiteDoc;
  const names = new Map([['a', 'logo.svg']]);
  const resolveEmbedded = createCssValueResolver(doc, names);
  const original = node.styles.base.default.backgroundImage;
  assert.equal(resolveEmbedded('backgroundImage', original), `url(${data}BBBB), image-set("${target}" 1x)`);
  replaceEmbeddedAsset(doc, 'a', 'assets/logo.svg');
  assert.equal(node.styles.base.default.backgroundImage, `url(${data}BBBB), image-set("${source}" 1x)`);
  assert.equal(node.styles.base.default.content, `"${data}"`);
  const resolveUploaded = createCssValueResolver(doc, names);
  assert.equal(resolveUploaded('backgroundImage', `url(${source}.backup), url(${source}#mark)`), `url(${source}.backup), url(${target}#mark)`);
});

test("export preserves imported ZIP queries without replacing longer CSS URLs or ordinary strings", () => {
  const doc = { assets: {
    a: { id: 'a', name: 'logo.svg', path: 'assets/logo.svg', width: 1, height: 1 },
  } } as unknown as SiteDoc;
  const names = new Map([['a', 'logo.svg']]);
  const resolveValue = createCssValueResolver(doc, names);
  const value = `image-set("${source}&v=1&theme=dark#mark" 1x), url('${source}.backup&v=2'), url(${source}#icon&part)`;
  assert.equal(resolveValue('backgroundImage', value),
    `image-set("${target}?v=1&theme=dark#mark" 1x), url('${source}.backup&v=2'), url(${target}#icon&part)`);
  assert.equal(resolveValue('content', `"${source}&v=1"`), `"${source}&v=1"`);
  assert.equal(resolveValue('backgroundImage', `url('${source}&amp;v=1&amp;theme=dark#mark')`),
    `url('${target}?v=1&amp;theme=dark#mark')`);
  // 書き出しでのクエリの変換を、使用箇所の判定や削除にまで広げない。
  assert.equal(cssUsesAssetUrl(`url('${source}&v=1')`, source), false);
});
});

describe("encoded-css-assets", () => {
  before(() => {
    useEditor.setState({
      breakpoint: "base", customWidth: null, styleState: "default", mode: "design",
      pageTheme: "light", selection: null, selectedIds: [], editingComponentId: null, scriptEditor: null,
    });
  });
const locations: CssLocation[] = ["node.styles", "node.customCss", "page.bodyStyles"];
const ids = (assets: object) => Object.keys(assets).sort();
function assertExport(doc: Parameters<typeof generateProject>[0]) {
  const result = generateProject(doc);
  assert.equal(result.remoteAssets["public/assets/hero.png"], picture.path);
  assert.match(result.files["styles/site.css"], /\/assets\/hero\.png/);
  assert.doesNotMatch(result.files["styles/site.css"], /api\/assets\/file/);
  return result.files["styles/site.css"];
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
      const outputCss = assertExport(target);
      if (syntax === "proxyQuery") assert.match(outputCss, /hero\.png\?v=1#icon/);
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
    if (field === "script") doc.pages.p.scripts = [{ id: "s", trigger: "load", steps: [{ id: "step", kind: "open-url", url: assetSrc(picture) }] }];
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
});

describe("html-css-import", () => {
const group = "zip_css_test";
function css(id: string, path: string, source: string, refs: { url: string; assetId: string; suffix: string }[] = []): Asset {
  return {
    id, name: path.split("/").at(-1)!, mimeType: "text/css",
    width: 0, height: 0, path: "assets/" + id,
    zip: { version: 1, group, path, stylesheet: { source, references: refs } },
  };
}

test("recursively resolves CSS @imports, media conditions and child-relative URLs", () => {
  const image: Asset = {
    id: "image", name: "icon.svg", mimeType: "image/svg+xml",
    width: 16, height: 16, path: "assets/icon",
    zip: { version: 1, group, path: "images/icon.svg" },
  };
  const mobile = css("mobile", "css/nested/mobile.css",
    '.card { gap: 4px; mask: url("../images/icon.svg#mark"); }');
  const base = css("base", "css/base.css",
    '@import url("nested/mobile.css") screen and (max-width: 768px); .card { background-image: url("../images/icon.svg#mark"); }',
    [{ url: "nested/mobile.css", assetId: "mobile", suffix: "" },
     { url: "../images/icon.svg#mark", assetId: "image", suffix: "#mark" }]);
  const main = css("main", "css/main.css",
    '@import "./base.css"; .card { display: grid; }',
    [{ url: "./base.css", assetId: "base", suffix: "" }]);
  const warnings: string[] = [];
  const resolved = expandZipCss(main.zip!.stylesheet!.source, [main, base, mobile, image],
    (msg) => warnings.push(msg), main);
  assert.match(resolved.css, /@media screen and \(max-width: 768px\)/);
  assert.match(resolved.css, /gap: 4px/);
  assert.ok(resolved.css.includes('mask: url("../images/icon.svg#mark")'),
    "a missing child-relative file cannot resolve against a parent stylesheet");
  assert.match(resolved.css, /display: grid/);
  assert.match(resolved.css, /background-image: url\("\/api\/assets\/file\?path=assets%2Ficon#mark"\)/);
  assert.deepEqual(resolved.unresolved, []);
  assert.deepEqual(warnings, []);
});

test("ignores apparent imports inside comments and quotes", () => {
  const source = '/* @import "fake.css"; */ .note::before { content: "@import fake.css;"; }';
  const result = expandZipCss(source, []);
  assert.equal(result.css, source);
  assert.deepEqual(result.unresolved, []);
});

test("unresolved imports stay available for the custom-code fallback", () => {
  const warnings: string[] = [];
  const source = '@import "https://example.test/styles.css"; .card { display: grid; }';
  const result = expandZipCss(source, [], (message) => warnings.push(message));
  assert.equal(result.unresolved.length, 1);
  assert.match(result.unresolved[0], /@import "https:\/\/example.test\/styles.css"/);
  assert.match(result.css, /display: grid/);
  assert.equal(warnings.length, 1);
});

test("circular imports are bounded and do not execute recursively", () => {
  const a = css("a", "css/a.css", '@import "b.css"; .a { color: red; }',
    [{ url: "b.css", assetId: "b", suffix: "" }]);
  const b = css("b", "css/b.css", '@import "a.css"; .b { color: blue; }',
    [{ url: "a.css", assetId: "a", suffix: "" }]);
  const warnings: string[] = [];
  const result = expandZipCss(a.zip!.stylesheet!.source, [a, b], (msg) => warnings.push(msg), a);
  assert.match(result.css, /\.a/);
  assert.match(result.css, /\.b/);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /circular/i);
});

test("bare and named CSS @import layers survive conversion with their cascade scopes", () => {
  const theme = css("theme", "css/theme.css", ".card { color: red; }");
  for (const modifier of ["layer", "layer(theme)", "layer(theme.parts) screen and (max-width: 600px)"]) {
    const main = css("main", "css/main.css", `@import "theme.css" ${modifier}; .card { display: grid; }`,
      [{ url: "theme.css", assetId: "theme", suffix: "" }]);
    const warnings: string[] = [];
    const result = expandZipCss(main.zip!.stylesheet!.source, [main, theme],
      message => warnings.push(message), main);
    assert.deepEqual(result.unresolved, []);
    assert.match(result.css, /@layer(?: theme(?:\.parts)?)? \{\n\.card \{ color: red; \}/);
    if (modifier.includes("screen")) assert.match(result.css, /@media screen and \(max-width: 600px\)/);
    assert.ok(!result.css.includes("@media layer"));
    assert.match(result.css, /display: grid/);
    assert.deepEqual(warnings, []);
  }
});

test("complex @import modifier syntax stays unresolved instead of producing invalid CSS", () => {
  const theme = css("theme", "css/theme.css", ".card { color: red; }");
  const main = css("main", "css/main.css", '@import "theme.css" supports(display: grid);',
    [{ url: "theme.css", assetId: "theme", suffix: "" }]);
  const result = expandZipCss(main.zip!.stylesheet!.source, [main, theme], () => {}, main);
  assert.deepEqual(result.unresolved, ['@import "theme.css" supports(display: grid);']);
  assert.ok(!result.css.includes("@media supports"));
});
});

describe("html-file-import-guard", () => {
describe("html-file-import-guard", () => {
  test("a zero-element HTML conversion cannot replace a page", () => {
    const doc = createInitialDoc();
    const home = doc.pageOrder[0];
    doc.pages[home].children = [];
    const result: HtmlConversion = { doc, warnings: [] };
    assert.throws(() => requireEditableHtmlContent(result), /no editable elements/);
    doc.pages[home].children = ["existing"];
    assert.equal(requireEditableHtmlContent(result), result);
  });

  test("a multi-page conversion rejects an empty page even if an earlier page contains elements", () => {
    const doc = createInitialDoc();
    const home = doc.pageOrder[0];
    doc.pages[home].children = ["existing"];
    doc.pages.other = { id: "other", name: "Empty", slug: "other", title: "", description: "", children: [] };
    doc.pageOrder.push("other");
    assert.throws(() => requireEditableHtmlContent({ doc, warnings: [] }), /no editable elements/);
  });
});

describe("import-zip-canonical-paths", () => {
  function archiveWith(...paths: string[]) {
    const doc = createInitialDoc();
    doc.assets = {};
    const zip = new ZipBuilder()
      .file(EDITABLE_DOC_PATH, JSON.stringify(doc))
      .file(EDITABLE_ASSETS_PATH, JSON.stringify({ version: 1, assets: {} }));
    for (const path of paths) zip.file(path, "content");
    return zip.toBytes();
  }

  test("editable ZIPs reject case-insensitive path collisions before loading assets", async () => {
    const bytes = await archiveWith("assets/Logo.svg", "assets/logo.svg");
    await assert.rejects(parseSiteImport(bytes, "zip"), /duplicate file paths/);
  });

  test("editable ZIPs reject canonically equivalent Unicode paths", async () => {
    const bytes = await archiveWith("assets/café.svg", "assets/cafe\u0301.svg");
    await assert.rejects(parseSiteImport(bytes, "zip"), /duplicate file paths/);
  });

  test("editable ZIPs reject control characters in member names", async () => {
    for (const path of ["assets/bad\nfile.svg", "assets/bad\u007ffile.svg"]) {
      const bytes = await archiveWith(path);
      await assert.rejects(parseSiteImport(bytes, "zip"), /unsafe path/);
    }
  });
});

describe("site-import-large", () => {
  test("large editable projects with more than 500 assets round-trip through document and ZIP imports", async () => {
    const doc = createInitialDoc();
    const mapping: Record<string, string> = {};
    const zip = new ZipBuilder();
    const bytes = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
    for (let i = 0; i < 501; i++) {
      const id = "asset-" + i;
      const name = "image-" + i + ".png";
      const location = "public/assets/" + name;
      doc.assets[id] = {
        id, name, mimeType: "image/png", path: "assets/existing-" + i, width: 1, height: 1,
      };
      mapping[id] = location;
      zip.file(location, bytes);
    }
    assert.ok(IMPORT_LIMITS.assets >= 501);
    assert.ok(IMPORT_LIMITS.entries >= 503);
    assert.equal(validateImportedDoc(doc), doc);
    const raw = JSON.stringify(doc);
    const direct = await parseSiteImport(new TextEncoder().encode(raw), "doc");
    assert.equal(Object.keys(direct.doc.assets).length, 501);

    zip.file(EDITABLE_DOC_PATH, raw);
    zip.file(EDITABLE_ASSETS_PATH, JSON.stringify({ version: 1, assets: mapping }));
    const archived = await parseSiteImport(await zip.toBytes(), "zip");
    assert.equal(Object.keys(archived.doc.assets).length, 501);
    assert.equal(archived.assets.size, 501);
    assert.deepEqual(archived.assets.get("asset-500"), bytes);
  });

  test("large import support retains a finite asset-count guard", () => {
    const doc = createInitialDoc();
    for (let i = 0; i <= IMPORT_LIMITS.assets; i++) {
      const id = "asset-" + i;
      doc.assets[id] = { id, name: "asset.png", width: 1, height: 1 };
    }
    assert.throws(() => validateImportedDoc(doc), /page, element or asset data/i);
  });
});
});

describe("html-import-code-boundaries", () => {
// DOMParser と同じく、HTML のパーサーの実際の名前空間と、スクリプトが無効なときの noscript の
// ツリーを使う。この準備に必要な DOM の操作だけを合わせる。CSSOM と、結果の書き出しの実行は、
// ブラウザのテストで確かめる。
function importHtml(source: string) {
  const tree = parse(source, { scriptingEnabled: false });
  class NodeAdapter {
    readonly childNodes: NodeAdapter[];
    constructor(readonly node: Html.Node, readonly parentElement: NodeAdapter | null = null) {
      this.childNodes = "childNodes" in node
        ? node.childNodes.map(child => new NodeAdapter(child, this)) : [];
    }
    get nodeType() { return "tagName" in this.node ? 1 : this.node.nodeName === "#text" ? 3 : 9; }
    get tagName() { return "tagName" in this.node ? this.node.tagName.toUpperCase() : ""; }
    get namespaceURI() { return "namespaceURI" in this.node ? this.node.namespaceURI : null; }
    get attributes() { return "attrs" in this.node ? this.node.attrs : []; }
    get id() { return this.getAttribute("id") || ""; }
    get outerHTML() { return serializeOuter(this.node); }
    get textContent(): string {
      return "value" in this.node ? this.node.value : this.childNodes.map(child => child.textContent).join("");
    }
    get children() { return this.childNodes.filter(child => child.nodeType === 1); }
    getAttribute(name: string) { return this.attributes.find(attr => attr.name === name)?.value ?? null; }
    matches(selector: string): boolean {
      if (selector === "[style]") return this.getAttribute("style") !== null;
      if (selector === 'meta[name="description"]') return this.tagName === "META" && this.getAttribute("name") === "description";
      assert.match(selector, /^[a-z]+(?:,\s*[a-z]+)*$/i, "add explicit adapter support for new selectors");
      return selector.split(/,\s*/).some(tag => tag.toUpperCase() === this.tagName);
    }
    querySelectorAll(selector: string): NodeAdapter[] {
      return this.children.flatMap(child => [
        ...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector),
      ]);
    }
    querySelector(selector: string) { return this.querySelectorAll(selector)[0] || null; }
    closest(selector: string): NodeAdapter | null {
      return this.matches(selector) ? this : this.parentElement?.closest(selector) ?? null;
    }
  }
  const root = new NodeAdapter(tree);
  const document = Object.assign(root, {
    head: root.querySelector("head")!, body: root.querySelector("body")!,
    documentElement: root.querySelector("html")!, title: "Code boundaries",
  });
  const originals = Object.getOwnPropertyDescriptors(globalThis);
  Object.assign(globalThis, {
    DOMParser: class { parseFromString() { return document; } },
    Node: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
  });
  try { return convertHtmlToSite(source).doc; }
  finally {
    for (const key of ["DOMParser", "Node"]) {
      if (originals[key]) Object.defineProperty(globalThis, key, originals[key]);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
}

for (const wrapper of ["noscript", "math"]) {
  for (const code of ["<script>window.inertProbe = 1;</script>", "<style>body { --inert-probe: 1; }</style>"]) {
    test(`HTML import keeps ${wrapper} ${code.startsWith("<script>") ? "scripts" : "styles"} inert`, () => {
      const fallback = `<${wrapper}>${code}</${wrapper}>`;
      const doc = importHtml(`<body>${fallback}<p>Visible content</p></body>`);
      const page = doc.pages[doc.pageOrder[0]];
      assert.doesNotMatch(page.customEndHtml || "", /inertProbe/);
      assert.doesNotMatch(page.customTopHtml || "", /inert-probe/);
      assert.ok(Object.values(doc.nodes).some(node => node.code?.html === fallback),
        "preserve the fallback in its original context");

      const output = generateExportProject(doc, "html").files["index.html"];
      const tree = parse(output); // 公開した文書では、スクリプトが有効になっている。
      const active: string[] = [];
      const visit = (node: Html.Node) => {
        if ("tagName" in node && node.namespaceURI === "http://www.w3.org/1999/xhtml" &&
            ["script", "style"].includes(node.tagName)) active.push(serializeOuter(node));
        if ("childNodes" in node) node.childNodes.forEach(visit);
      };
      visit(tree);
      assert.doesNotMatch(active.join("\n"), /inertProbe|inert-probe/);
    });
  }
}

test("HTML import preserves intentional page scripts and active styles for publication", () => {
  const doc = importHtml('<head><script>window.headProbe = 1;</script></head><body>' +
    '<section><script>window.bodyProbe = 1;</script><style>body { --active-probe: 1; }</style></section></body>');
  const page = doc.pages[doc.pageOrder[0]];
  assert.match(page.customTopHtml || "", /window.headProbe = 1/);
  assert.match(page.customEndHtml || "", /window.bodyProbe = 1/);
  assert.match(page.customTopHtml || "", /--active-probe: 1/);
  const output = generateExportProject(doc, "html").files["index.html"];
  assert.match(output, /window.headProbe = 1/);
  assert.match(output, /window.bodyProbe = 1/);
});
});

describe("html-import-lifecycle", () => {
  before(() => {
    useEditor.setState({
      breakpoint: "base", customWidth: null, styleState: "default", mode: "design",
      pageTheme: "light", selection: null, selectedIds: [], editingComponentId: null, scriptEditor: null,
    });
  });
const state = () => useEditor.getState();
const tick = () => new Promise((r) => setImmediate(r));
const original = "<p>Original</p>";
const imported = '<link rel="stylesheet" href="tsumu-zip-css:css">';
const assets: Asset[] = [
  { id: "image", name: "a.png", path: "assets/a.png", width: 1, height: 1, zip: { version: 1, group: "g", path: "a.png" } },
  { id: "css", name: "a.css", path: "assets/a.css", width: 0, height: 0, zip: { version: 1, group: "g", path: "a.css", stylesheet: { source: 'p{background:url(a.png)}', references: [{ url: "a.png", assetId: "image", suffix: "" }] } } },
];
function fixture() {
  state().endGesture();
  state().replaceDoc({ siteName: "HTML imports", assets: {}, nodes: {}, pageOrder: ["p", "q"], pages: Object.fromEntries(["p", "q"].map(id => [id, { id, name: id, slug: id, title: "", description: "", children: [], rawHtml: original }])) });
  state().setActivePage("p");
  const jobs: { resolve: (v: any) => void; reject: (e: Error) => void; progress: (s: string) => void }[] = [];
  const ui = importCallbacks("html", undefined, async (_file, progress = () => {}) => new Promise((resolve, reject) => jobs.push({ resolve, reject, progress })));
  const readers: any[] = [];
  const oldReader = globalThis.FileReader;
  globalThis.FileReader = class { result = ""; onload?: () => void; readAsText() { readers.push(this); } } as any;
  const render = () => elements(ui.render());
  const start = (zip: boolean) => render().find(e => e.type === "input" && e.props.accept?.startsWith(zip ? ".zip" : ".html")).props.onChange({ target: { files: [new File([], zip ? "site.zip" : "index.html")], value: "" } });
  const complete = async (zip: boolean, index = 0) => { if (zip) jobs[index].resolve({ html: imported, source: imported, zip: { path: "index.html", assetIds: assets.map(a => a.id) }, assets, name: "index.html" }); else { readers[index].result = imported; readers[index].onload(); } await tick(); };
  render();
  return { ui, render, start, complete, jobs, readers, close() { ui.unmount(); globalThis.FileReader = oldReader; } };
}

for (const zip of [false, true]) {
  for (const change of ["edit", "typing", "kind", "page", "delete", "unmount", "undo", "undo-redo", "restore", "replace"]) {
    test(`${zip ? "ZIP" : "HTML"} import cannot overwrite ${change} or clear its history`, async () => {
      const f = fixture();
      try {
        state().updatePage("p", { title: "Keep this edit" });
        f.start(zip); f.render();
        if (change === "edit") state().updatePage("p", { rawHtml: "Newer" });
        if (change === "typing") f.render().find(e => e.props?.rows === 14).props.onChange();
        if (change === "kind") await f.render().find(e => e.props?.options?.some((o: any) => o.value === "html")).props.onChange("normal");
        if (change === "page") state().setActivePage("q");
        if (change === "delete") state().updateDoc(d => { delete d.pages.p; });
        if (change === "unmount") f.ui.unmount();
        if (change.startsWith("undo")) state().undo();
        if (change === "undo-redo") state().redo();
        if (change === "restore") state().restoreDoc({ ...structuredClone(state().doc), siteName: "Restored" });
        if (change === "replace") state().replaceDoc(structuredClone(state().doc));
        // 再描画の前にわざと解決する。現在の状態での確認も働かなければならない。
        const before = structuredClone(state().doc); const past = structuredClone(state().past); const future = structuredClone(state().future);
        await f.complete(zip);
        const retain = (d: typeof before) => zip ? { ...d, assets: Object.fromEntries(assets.map(a => [a.id, a])) } : d;
        assert.deepEqual(state().doc, retain(before));
        assert.deepEqual(state().past, past.map(retain));
        assert.deepEqual(state().future, future.map(retain));
      } finally { f.close(); }
    });
  }
  test(`${zip ? "ZIP" : "HTML"} normal import preserves unrelated edits and is one Undo/Redo step`, async () => {
    const f = fixture();
    try {
      f.start(zip); state().updatePage("q", { name: "Keep this name" }); f.render();
      const before = structuredClone(state().doc);
      await f.complete(zip); const completed = structuredClone(state().doc);
      assert.equal(completed.pages.p.rawHtml, imported);
      if (zip) assert.deepEqual(completed.assets, Object.fromEntries(assets.map(a => [a.id, a])));
      state().undo(); assert.deepEqual(state().doc, before);
      state().redo(); assert.deepEqual(state().doc, completed);
    } finally { f.close(); }
  });
}

for (const firstZip of [false, true]) test(`newer ${firstZip ? "HTML" : "ZIP"} selection supersedes earlier import`, async () => {
  const f = fixture();
  try {
    f.start(firstZip); f.start(!firstZip); f.render();
    await f.complete(firstZip);
    assert.equal(state().doc.pages.p.rawHtml, original);
    if (firstZip) assert.deepEqual(state().doc.assets, Object.fromEntries(assets.map(a => [a.id, a])));
    await f.complete(!firstZip);
    assert.equal(state().doc.pages.p.rawHtml, imported);
  } finally { f.close(); }
});

test("old ZIP progress, failure and completion do not affect a new page/import", async () => {
  const f = fixture();
  try {
    f.start(true); state().setActivePage("q"); f.render(); f.start(true); f.render();
    f.jobs[0].progress("Old progress"); f.jobs[0].reject(new Error("Old failure")); await tick();
    assert.equal(f.render().some(e => e.props?.role === "status"), false);
    assert.equal(f.render().find(e => e.type === "button" && e.props.disabled)?.props.disabled, true);
    await f.complete(true, 1); assert.equal(state().doc.pages.q.rawHtml, imported);
    assert.equal(state().doc.pages.p.rawHtml, original);
  } finally { f.close(); }
});

test("a late editable HTML read failure does not replace a newer page's import result", async () => {
  const f = fixture();
  try {
    for (const id of ["p", "q"]) state().updatePage(id, { rawHtml: null });
    const selectFile = (file: File) => {
      const input = f.render().find(e => e.props?.id === `page-${state().activePageId}-import-html`);
      input.props.onChange({ target: { files: [file], value: "" } });
    };
    const read = Promise.withResolvers<void>();
    class SlowFile extends File {
      override async arrayBuffer() { await read.promise; return super.arrayBuffer(); }
    }
    selectFile(new SlowFile([Uint8Array.of(0xc3)], "first.html"));
    state().setActivePage("q");
    selectFile(new File([], "second.html"));
    await tick();
    const status = () => f.render().find(e => e.props?.role === "status")?.props.children;
    assert.equal(status(), tr("The file is empty."));
    read.resolve();
    await tick();
    assert.equal(status(), tr("The file is empty."));
  } finally { f.close(); }
});

for (const event of ["onerror", "onabort"]) test(`HTML ${event} settles its request without cancelling a newer ZIP`, async () => {
  const f = fixture();
  try {
    f.start(false); f.readers[0][event](); f.render();
    f.start(false); f.start(true); f.render();
    f.readers[1][event]();
    assert.equal(f.render().find(e => e.type === "button" && e.props.disabled)?.props.disabled, true);
    await f.complete(true);
    assert.equal(state().doc.pages.p.rawHtml, imported);
    assert.equal(f.render().some(e => e.type === "button" && e.props.disabled), false);
  } finally { f.close(); }
});

for (const zip of [false, true]) for (const interrupt of ["finish", "undo", "unmount", "edit"]) test(`${zip ? "ZIP" : "HTML"} waits for manual gesture: ${interrupt}`, async () => {
  const f = fixture();
  try {
    f.start(zip); f.render(); const before = structuredClone(state().doc);
    const finish = state().beginGesture();
    state().updatePage("p", { htmlBackground: "#ff0000" });
    await f.complete(zip);
    assert.equal(state().doc.pages.p.rawHtml, original);
    assert.deepEqual(state().doc.assets, {});
    state().updatePage("p", { htmlBackground: "#00ff00" });
    const manual = structuredClone(state().doc);
    if (interrupt === "undo") state().undo();
    if (interrupt === "unmount") f.ui.unmount();
    if (interrupt === "edit") { f.render().find(e => e.props?.rows === 14).props.onChange(); f.render(); }
    if (interrupt === "finish") finish();
    await tick();
    if (interrupt === "finish") {
      const completed = structuredClone(state().doc); assert.equal(completed.pages.p.rawHtml, imported);
      state().undo(); assert.deepEqual(state().doc, manual);
      state().undo(); assert.deepEqual(state().doc, before);
      state().redo(); state().redo(); assert.deepEqual(state().doc, completed);
    } else {
      assert.equal(state().doc.pages.p.rawHtml, original);
      if (zip) assert.deepEqual(state().doc.assets, Object.fromEntries(assets.map(a => [a.id, a])));
      if (interrupt === "undo") assert.equal(state().future.length, 1);
    }
  } finally { f.close(); }
});
});

describe("html-import-media-urls", () => {
const { parse } = createRequire(import.meta.url)("next/dist/compiled/node-html-parser");

// この CSS を使わない変換で使う、動作しない DOM の一部にパーサーを合わせる。
// ZIP の読み込み・変換・アセットの復元・書き出しは、すべて本番のコードを使う。
function parseDocument(html: string) {
  const cache = new WeakMap<object, any>();
  const wrap = (node: any): any => {
    if (!node) return node;
    if (cache.has(node)) return cache.get(node);
    const proxy = new Proxy(node, { get(target, key) {
      if (key === "style") {
        const declarations = (target.getAttribute?.("style") || "").split(";").map((part: string) => part.split(":"));
        const entries = declarations.filter((pair: string[]) => pair.length === 2);
        return { length: entries.length, item: (i: number) => entries[i][0],
          getPropertyValue: (name: string) => entries.find((pair: string[]) => pair[0] === name)?.[1] || "",
          getPropertyPriority: () => "" };
      }
      if (key === "attributes") return Object.entries(target.attributes).map(([name, value]) => ({ name, value }));
      if (key === "namespaceURI") return "http://www.w3.org/1999/xhtml";
      if (key === "childNodes") return target.childNodes.map(wrap);
      if (key === "children") return target.childNodes.filter((child: any) => child.nodeType === 1).map(wrap);
      if (key === "querySelector") return (selector: string) => wrap(target.querySelector(selector));
      if (key === "querySelectorAll") return (selector: string) => target.querySelectorAll(selector).map(wrap);
      const value = target[key];
      return typeof value === "function" ? value.bind(target) : value;
    } });
    cache.set(node, proxy);
    return proxy;
  };
  const root = wrap(parse(html));
  return { head: root.querySelector("head"), body: root.querySelector("body"),
    title: root.querySelector("title")?.textContent || "",
    documentElement: root.querySelector("html"), querySelectorAll: root.querySelectorAll };
}

for (const local of [false, true]) test(`HTML ZIP preserves media URL suffixes with ${local ? "embedded" : "uploaded"} assets`, async (t) => {
  const originals = Object.getOwnPropertyDescriptors(globalThis);
  let uploads = 0, embed = local;
  const stored = new Map<string, File>();
  let download: Blob | undefined;
  let importedDoc: SiteDoc | undefined;
  const createUrl = URL.createObjectURL;
  URL.createObjectURL = blob => {
    download = blob;
    return createUrl(blob);
  };
  Object.assign(globalThis, {
    document: { createElement: () => ({ href: "", download: "", click() {} }) },
    DOMParser: class { parseFromString(html: string) { return parseDocument(html); } },
    Node: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
    Image: class {
      naturalWidth = 12; naturalHeight = 8; onload?: () => void;
      set src(_value: string) { queueMicrotask(() => this.onload?.()); }
    },
    FileReader: class {
      result = ""; onload?: () => void;
      readAsDataURL(blob: Blob) { void blob.arrayBuffer().then(bytes => {
        this.result = "data:" + blob.type + ";base64," + Buffer.from(bytes).toString("base64");
        this.onload?.();
      }); }
    },
    fetch: async (input: string, init?: RequestInit) => {
      if (input === "/api/sites") {
        const { importId } = JSON.parse(String(init?.body));
        assert.ok(importId);
        return Response.json({ site: { id: importId } });
      }
      if (input.startsWith("/api/doc?site=") && init?.method === "PUT") {
        importedDoc = JSON.parse(String(init.body));
        return Response.json({ ok: true, rev: "1" });
      }
      if (/^\/api\/sites\/[a-z0-9]{10}$/.test(input) && init?.method === "PATCH")
        return Response.json({ site: { id: input.split("/").at(-1) } });
      if (input.startsWith("data:")) return originals.fetch.value(input, init);
      if (input.startsWith("/api/assets/file?")) {
        const file = stored.get(new URL(input, "https://import.test").searchParams.get("path")!);
        assert.ok(file);
        return new Response(file);
      }
      assert.equal(input, "/api/assets");
      assert.equal(init?.method, "POST");
      uploads++;
      if (!embed) stored.set("assets/upload-" + uploads, (init!.body as FormData).get("file") as File);
      return Response.json({ path: "assets/upload-" + uploads }, { status: embed ? 503 : 200 });
    },
  });
  try {
    const zip = new ZipBuilder().file("index.html", `<!doctype html><html><head><title>Media suffixes</title></head><body>
    <img id="plain" src="view.svg" alt="Plain">
    <video id="plain-clip" src="clip.mp4"></video>
    <img id="view" src="view.svg?version=2#detail" alt="Detail">
    <video id="clip" src="clip.mp4?version=3#t=5,10" style="opacity:0.5;transform:translateX(12px)" controls></video>
    <audio id="sound"><source src="sound.mp3#t=2,4" type="audio/mpeg" media="(min-width: 600px)"><source src="clip.mp4#t=3" type="audio/mp4"></audio></body></html>`)
    .file("view.svg", '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="8"><view id="detail" viewBox="0 0 6 4"/><rect width="12" height="8"/></svg>')
    .file("clip.mp4", "video fixture").file("sound.mp3", "audio fixture");

    const bytes = await zip.toBytes();
    const file = new File([bytes], "site.zip");
    const reads = t.mock.method(file, "arrayBuffer");
    const opens = t.mock.method(ZipArchive, "open");
    const { warnings } = await createSiteFromFile(file, "server");
    assert.equal(reads.mock.callCount(), 1);
    assert.equal(opens.mock.callCount(), 1);
    opens.mock.restore();
    const sourceArchive = await ZipArchive.open(bytes);
    const doc = importedDoc!;
    assert.ok(doc);
    const plain = Object.values(doc.nodes).find(node => node.attrId === "plain")!;
    assert.equal(plain.type, "image");
    assert.ok(plain.image?.assetId);
    assert.equal(plain.image.src, "");
    const plainClip = Object.values(doc.nodes).find(node => node.attrId === "plain-clip")!;
    assert.equal(plainClip.type, "media");
    assert.ok(plainClip.media?.assetId);
    assert.equal(plainClip.media.src, "");
    const cases = [["view", "view.svg", "#detail", "&version=2"],
      ["clip", "clip.mp4", "#t=5,10", "&version=3"], ["sound", "sound.mp3", "#t=2,4", ""]];
    const names = buildAssetNames(doc);
    const usage = assetUsage(doc);
    const expectedUrls: string[] = [];
    for (const [id, path, fragment, query] of cases) {
      const node = Object.values(doc.nodes).find(node => node.attrId === id)!;
      const asset = Object.values(doc.assets).find(asset => asset.zip?.path === path)!;
      assert.equal(node.type, id === "view" ? "image" : "media", id);
      const ref = node.image || node.media!.sources?.[0] || node.media!;
      assert.equal(ref.assetId, asset.id);
      assert.equal(ref.assetSuffix, (local || !query ? "" : "?" + query.slice(1)) + fragment);
      assert.equal(mediaSrc(doc, ref), assetSrc(asset) + (local ? "" : query) + fragment);
      assert.ok(usage.has(asset.id), path + " must remain in use");
      expectedUrls.push("assets/" + names.get(asset.id) + ref.assetSuffix);
    }
    assert.equal(Object.values(doc.nodes).find(node => node.attrId === "sound")!.media!.sources![0].type, "audio/mpeg");
    assert.ok(!warnings.some(message => message.includes("カスタムコード")));
    const clip = Object.values(doc.nodes).find(node => node.attrId === "clip")!;
    assert.equal(clip.styles.base.default.opacity, "0.5");
    assert.equal(clip.styles.base.default.transform, "translateX(12px)");
    assert.equal(clip.code, undefined);
    const sound = Object.values(doc.nodes).find(node => node.attrId === "sound")!;
    assert.equal(sound.media!.sources!.length, 2);
    assert.equal(sound.media!.sources![0].media, "(min-width: 600px)");
    assert.equal(sound.media!.sources![1].assetSuffix, "#t=3");
    assert.equal(uploads, 3);
    assert.equal(Object.keys(doc.assets).length, 3);
    const before = structuredClone(doc);
    const sourceAssets = new Map<string, Uint8Array>();
    for (const asset of Object.values(doc.assets)) {
      sourceAssets.set(asset.id, await sourceArchive.file(asset.zip!.path)!.bytes());
    }
    for (const framework of ["html", "nextjs", "react", "vue", "nuxt", "sveltekit"] as const) {
      download = undefined;
      assert.deepEqual(await exportProjectZip(doc, framework), []);
      assert.ok(download);
      const archiveBytes = new Uint8Array(await (download as Blob).arrayBuffer());
      const archive = await ZipArchive.open(archiveBytes);
      const files = Object.values(archive.files).filter(entry => !entry.dir && !entry.name.includes("/_tsumu/"));
      const output = (await Promise.all(files.map(entry => entry.text()))).join("\n");
      assert.ok(!output.includes("/api/assets/file"), framework);
      if (framework === "html") {
        const page = files.find(entry => entry.name.endsWith("/index.html"))!;
        const html = parse(await page.text());
        assert.equal(html.querySelectorAll("#clip").length, 1);
        assert.equal(html.querySelector("#clip").tagName, "VIDEO");
        assert.equal(html.querySelector("#clip").getAttribute("style"), undefined);
        assert.equal(html.querySelector("#sound").getAttribute("src"), undefined);
        assert.equal(html.querySelectorAll("#sound > source").length, 2);
        assert.equal(html.querySelector("#sound > source").getAttribute("type"), "audio/mpeg");
      }
      for (const url of expectedUrls) assert.ok(output.includes(url), framework + ": " + url);
      const imported = await parseSiteImport(archiveBytes, "zip");
      assert.deepEqual(imported.doc, before, "editable source retains its asset identities and URLs");
      assert.deepEqual(doc, before, "export must not mutate the active document");
      assert.deepEqual(imported.assets, sourceAssets);
    }
    const responsiveBytes = await new ZipBuilder()
      .file("site/index.html", '<html><head><link rel="preload" as="image" href="small.svg" ' +
        'imagesrcset="small.svg 1x, large.svg#wide 2x" imagesizes="100vw"></head><body>' +
        '<picture><source srcset="small.svg 1x, large.svg#wide 2x"><img src="small.svg"></picture></body></html>')
      .file("site/small.svg", '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>')
      .file("site/large.svg", '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"/>')
      .toBytes();
    const responsive = await ZipArchive.open(responsiveBytes);
    const result = await readHtmlZip(responsiveBytes);
    const { doc: converted } = convertHtmlToSite(result.html, { assets: result.assets });
    const pageId = converted.pageOrder[0];
    const raw = structuredClone(converted);
    Object.assign(raw.pages[pageId], { rawHtml: result.source, htmlZip: result.zip, children: [], customTopHtml: undefined });
    for (const site of [converted, raw]) {
      const project = await prepareExportProject(site, { framework: "single-html", language: "javascript",
        style: "css", scope: "page", pageId });
      const markup = parse(project.files["index.html"]);
      const data = await Promise.all(["small", "large"].map(async (name) => "data:image/svg+xml;base64," +
        await responsive.file("site/" + name + ".svg")!.base64()));
      const candidates = data[0] + " 1x, " + data[1] + "#wide 2x";
      assert.equal(markup.querySelector('link[rel="preload"]').getAttribute("href"), data[0]);
      assert.equal(markup.querySelector('link[rel="preload"]').getAttribute("imagesrcset"), candidates);
      assert.equal(markup.querySelector('link[rel="preload"]').getAttribute("imagesizes"), "100vw");
      assert.equal(markup.querySelector("picture source").getAttribute("srcset"), candidates);
      assert.deepEqual(Object.keys(project.files), ["index.html"]);
    }
    if (local) {
      embed = false;
      const { doc: restored } = await restoreImportAssets({ doc, assets: new Map(), warnings: [] });
      for (const [id, path, fragment] of cases) {
        const node = Object.values(restored.nodes).find(node => node.attrId === id)!;
        const asset = Object.values(restored.assets).find(asset => asset.zip?.path === path)!;
        assert.equal(mediaSrc(restored, node.image || node.media!.sources?.[0] || node.media!), assetSrc(asset) + fragment);
        assert.ok(assetUsage(restored).has(asset.id));
      }
    }
  } finally {
    URL.createObjectURL = createUrl;
    for (const key of ["document", "DOMParser", "Node", "Image", "FileReader", "fetch"]) {
      if (originals[key]) Object.defineProperty(globalThis, key, originals[key]);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
});

describe("html-zip-guard", () => {
async function reopen(zip: ZipBuilder): Promise<ZipArchive> {
  const bytes = await zip.toBytes({ compression: "DEFLATE" });
  return ZipArchive.open(bytes);
}

test("HTML ZIP inspection accepts ordinary nested pages and static assets", async () => {
  const zip = await reopen(new ZipBuilder()
    .file("site/docs/index.html", "<main>Docs</main>")
    .file("site/index.html", "<main>Home</main>")
    .file("site/about.html", "<main>About</main>")
    .file("site/styles.css", "body{margin:0}")
    .file("site/photo.png", new Uint8Array([1, 2, 3])));
  const result = inspectHtmlZip(zip);
  assert.equal(result.htmlEntry.name, "site/index.html");
  assert.deepEqual(result.htmlEntries.map((e) => e.name),
    ["site/docs/index.html", "site/index.html", "site/about.html"]);
  assert.deepEqual(result.assetEntries.map((e) => e.name),
    ["site/styles.css", "site/photo.png"]);
});

test("HTML ZIP rejects traversal paths before any file is extracted", async () => {
  const zip = await reopen(new ZipBuilder()
    .file("index.html", "<main>Safe</main>")
    .file("../outside.js", "bad"));
  assert.throws(() => inspectHtmlZip(zip), /unsafe path/);
});

test("HTML ZIP rejects case-folded path collisions", async () => {
  const zip = await reopen(new ZipBuilder()
    .file("index.html", "<main>Safe</main>")
    .file("assets/logo.svg", "<svg/>")
    .file("assets/LOGO.svg", "<svg/>"));
  assert.throws(() => inspectHtmlZip(zip), /duplicate file paths/);
});

test("HTML ZIP rejects advertised oversize assets before uploading", async () => {
  const zip = await reopen(new ZipBuilder()
    .file("index.html", "<main>Safe</main>")
    .file("huge.bin", new Uint8Array(HTML_ZIP_LIMITS.assetBytes + 1)));
  assert.throws(() => inspectHtmlZip(zip), /asset in the ZIP is too large/);
});

test("HTML ZIP rejects aggregate expansion and implausible metadata", async () => {
  const input = new ZipBuilder().file("index.html", "<main>Safe</main>");
  for (let i = 0; i < 13; i++) input.file("asset-" + i + ".bin", "x");
  const zip = await reopen(input);
  for (let i = 0; i < 13; i++) {
    const entry = zip.file("asset-" + i + ".bin") as ZipEntry;
    entry.uncompressedSize = HTML_ZIP_LIMITS.assetBytes;
  }
  assert.throws(() => inspectHtmlZip(zip), /expands beyond the size limit/);

  const entry = zip.file("asset-0.bin") as ZipEntry;
  delete entry.uncompressedSize;
  assert.throws(() => inspectHtmlZip(zip), /invalid size/);
});

test("streamed decompression rejects real expansion beyond the advertised limit", async () => {
  const original = new Uint8Array(256 * 1024).fill(65);
  const zip = await reopen(new ZipBuilder().file("index.html", "ok").file("payload.bin", original));
  const entry = zip.file("payload.bin")!;
  await assert.rejects(readZipEntryLimited(entry, 1024), /expands beyond the size limit/);
  assert.deepEqual(await readZipEntryLimited(entry, original.length), original);
});

test("HTML ZIP enforces both file and directory record limits", async () => {
  const input = new ZipBuilder().file("index.html", "safe");
  for (let i = 0; i < HTML_ZIP_LIMITS.entries; i++) input.file("assets/" + i + ".txt", "x");
  const zip = await reopen(input);
  assert.throws(() => inspectHtmlZip(zip), /up to 200 files/);
  const directories = new ZipBuilder().file("index.html", "home");
  for (let i = 0; i < HTML_ZIP_LIMITS.entries * 4; i++) directories.folder("folder-" + i);
  const opened = await reopen(directories);
  assert.throws(() => inspectHtmlZip(opened), /too many files/);
});

test("raw HTML ZIP import rejects oversized HTML without starting uploads", async () => {
  const input = new ZipBuilder()
    .file("index.html", "x".repeat(HTML_ZIP_LIMITS.htmlBytes + 1))
    .file("asset.js", "export {}");
  const bytes = await input.toBytes({ compression: "DEFLATE" });
  const originalFetch = globalThis.fetch;
  let uploads = 0;
  globalThis.fetch = async () => { uploads++; throw new Error("Unexpected upload"); };
  try {
    await assert.rejects(readHtmlZip(bytes), /HTML file in the ZIP is too large/);
    assert.equal(uploads, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("invalid HTML encoding and an empty ZIP entry page fail before uploading assets", async t => {
  const fetch = t.mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected upload"); });
  for (const [index, about, reason] of [
    ["<p>home</p>", Uint8Array.of(0xff), /about.htm.*UTF-8/],
    [" \n", "<p>about</p>", /HTML file in the ZIP is empty/],
  ] as const) {
    const zip = new ZipBuilder().file("index.html", index).file("about.htm", about).file("style.css", "p{}");
    await assert.rejects(readHtmlZip(await zip.toBytes()), reason);
  }
  assert.equal(fetch.mock.callCount(), 0);
});

test("raw HTML ZIP import validates all stylesheets before uploading other assets", async () => {
  const input = new ZipBuilder()
    .file("index.html", "<link rel=\"stylesheet\" href=\"bad.css\">")
    .file("first.js", "export {}")
    .file("bad.css", new Uint8Array([0xff, 0xfe, 0xfd]));
  const bytes = await input.toBytes({ compression: "DEFLATE" });
  const originalFetch = globalThis.fetch;
  let uploads = 0;
  globalThis.fetch = async () => { uploads++; throw new Error("Unexpected upload"); };
  try {
    await assert.rejects(readHtmlZip(bytes), /UTF-8/);
    assert.equal(uploads, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("ZIPs with duplicate physical names cannot hide a record in the archive file map", async () => {
  const zip = new ZipBuilder().file("index.html", "<main></main>").file("a.txt", "one").file("b.txt", "two");
  const bytes = await zip.toBytes();
  // これで、ローカルヘッダーとセントラルディレクトリの両方で、2つの名前が同じバイト列になる。
  const duplicated = Buffer.from(Buffer.from(bytes).toString("latin1").replaceAll("b.txt", "a.txt"), "latin1");
  await assert.rejects(readHtmlZip(duplicated), /duplicate file paths/);
});

test("failure after an upload removes exactly the new archive asset", async () => {
  const zip = new ZipBuilder().file("index.html", "<html></html>").file("first.js", "x").file("second.js", "y");
  const bytes = await zip.toBytes();
  const before = globalThis.fetch;
  const deleted: Array<{ site: string | null; path: string | null }> = [];
  let posts = 0;
  try {
    globalThis.fetch = async (url, init) => {
      if (init?.method === "DELETE") {
        const parsed = new URL(String(url), "https://editor.test");
        deleted.push({ site: parsed.searchParams.get("site"), path: parsed.searchParams.get("path") });
        return new Response();
      }
      return ++posts === 1 ? Response.json({ path: "assets/first", name: "first.js" }) :
        Response.json({ error: "upload failed" }, { status: 500 });
    };
    await assert.rejects(readHtmlZip(bytes, undefined, undefined, [], false, "site-target"), /upload failed/);
    assert.equal(posts, 2);
    assert.deepEqual(deleted, [{ site: "site-target", path: "assets/first" }]);
  } finally { globalThis.fetch = before; }
});

test("archive-local script and stylesheet integrity is checked before uploading a single asset", async () => {
  for (const tag of ['<link href=assets/a.css rel=stylesheet integrity="sha512-AAAA">',
    '<script type=module src=assets/a.js integrity="sha256-AAAA"></script>']) {
    const zip = new ZipBuilder().file("site/index.html", tag).file("site/assets/a.css", ".x{color:red}")
      .file("site/assets/a.js", "globalThis.unverified = true");
    const fetch = globalThis.fetch;
    let uploads = 0;
    globalThis.fetch = async () => { uploads++; return Response.json({ path: "assets/new" }); };
    try {
      await assert.rejects(readHtmlZip(await zip.toBytes()), /integrity/i);
      assert.equal(uploads, 0);
    } finally { globalThis.fetch = fetch; }
  }
});

test("valid empty files and comments containing a ZIP signature can be imported", async () => {
  const { openImportZip } = await import("../lib/zip-directory");
  const original = new ZipBuilder().file("site/index.html", "<p>Home</p>").file("site/empty.css", "");
  original.comment = "ordinary PK\u0005\u0006" + "x".repeat(28);
  const zip = await openImportZip(await original.toBytes(), 200);
  const { assetEntries } = inspectHtmlZip(zip);
  assert.equal(assetEntries[0].name, "site/empty.css");
  assert.equal((await readZipEntryLimited(assetEntries[0], 16)).length, 0);
});

test("corrupt stored bytes do not silently replace an imported document or asset", async () => {
  const { openImportZip } = await import("../lib/zip-directory");
  const original = new ZipBuilder().file("a.js", "original-payload");
  const bytes = Buffer.from(await original.toBytes({ compression: "STORE" }));
  const start = bytes.indexOf("original-payload");
  assert.ok(start >= 0);
  bytes[start] ^= 1;
  const zip = await openImportZip(bytes, 200);
  await assert.rejects(readZipEntryLimited(zip.file("a.js")!, 100), /CRC/i);
});

test("a forged zero size cannot discard a nonempty deflated member", async () => {
  const { openImportZip } = await import("../lib/zip-directory");
  const original = new ZipBuilder().file("payload.txt", "not empty");
  const bytes = Buffer.from(await original.toBytes({ compression: "DEFLATE" }));
  const central = bytes.indexOf(Buffer.from([80, 75, 1, 2]));
  bytes.writeUInt32LE(0, 14); bytes.writeUInt32LE(0, 22);
  bytes.writeUInt32LE(0, central + 16); bytes.writeUInt32LE(0, central + 24);
  await assert.rejects(openImportZip(bytes, 200));
});

test("ZIP import resolves a Unicode Path field only when its version and filename CRC match", async () => {
  const { crc32 } = await import("node:zlib");
  const rawName = "photo.png";
  const name = "写真.png";
  const archive = Buffer.from(await new ZipBuilder().file(rawName, "photo").toBytes());
  const end = archive.length - 22;
  const central = archive.readUInt32LE(end + 16);
  const utf8Name = Buffer.from(name);
  const field = Buffer.alloc(9 + utf8Name.length);
  field.writeUInt16LE(0x7075);
  field.writeUInt16LE(field.length - 4, 2);
  utf8Name.copy(field, 9);
  archive.writeUInt16LE(field.length, central + 30);
  archive.writeUInt32LE(archive.readUInt32LE(end + 12) + field.length, end + 12);

  for (const [version, crcName, expected] of [[1, rawName, name], [1, "renamed.png", rawName], [2, rawName, rawName]] as const) {
    field[4] = version;
    field.writeUInt32LE(crc32(crcName), 5);
    const bytes = Buffer.concat([archive.subarray(0, end), field, archive.subarray(end)]);
    const zip = await openImportZip(bytes, 200);
    assert.equal(await zip.file(expected)?.text(), "photo");
    assert.deepEqual(Object.keys(zip.files), [expected]);
  }
});

test("ZIP local and central filenames must identify the same member", async () => {
  const { openImportZip } = await import("../lib/zip-directory");
  const bytes = Buffer.from(await new ZipBuilder().file("a.txt", "hello").toBytes());
  bytes[30] = "b".charCodeAt(0);
  await assert.rejects(openImportZip(bytes, 200), /file directory is invalid/);
});

test("true DEFLATE empty members survive validation", async () => {
  const { deflateRawSync } = await import("node:zlib");
  const { openImportZip, zipEntrySize } = await import("../lib/zip-directory");
  const bytes = Buffer.from(await new ZipBuilder().file("empty.txt", "").toBytes());
  const central = bytes.indexOf(Buffer.from([80, 75, 1, 2]));
  const compressed = deflateRawSync(Buffer.alloc(0));
  const encoded = Buffer.concat([bytes.subarray(0, central), compressed, bytes.subarray(central)]);
  const shifted = central + compressed.length;
  encoded.writeUInt16LE(8, 8); encoded.writeUInt32LE(compressed.length, 18);
  encoded.writeUInt16LE(8, shifted + 10); encoded.writeUInt32LE(compressed.length, shifted + 20);
  encoded.writeUInt32LE(shifted, encoded.length - 6);
  const entry = (await openImportZip(encoded, 200)).file("empty.txt")!;
  assert.equal(zipEntrySize(entry), 0);
  assert.equal((await readZipEntryLimited(entry, 10)).length, 0);
});

test("corruption in a later binary member rejects the HTML ZIP before an earlier member is uploaded", async () => {
  const input = new ZipBuilder().file("index.html", "<p>Test</p>").file("a.js", "first").file("z.bin", "later bytes");
  const bytes = Buffer.from(await input.toBytes({ compression: "STORE" }));
  bytes[bytes.indexOf("later bytes")] ^= 1;
  const fetch = globalThis.fetch;
  let writes = 0;
  globalThis.fetch = async () => { writes++; return Response.json({ path: "assets/upload" }); };
  try {
    await assert.rejects(readHtmlZip(bytes), /CRC/);
    assert.equal(writes, 0);
  } finally { globalThis.fetch = fetch; }
});
});

describe("html-zip-reimport", () => {
for (const modules of [false, true]) {
  test(`reimport preserves another page's ZIP ${modules ? "modules" : "nested stylesheets"}`, async (t) => {
    let uploads = 0;
    t.mock.method(globalThis, "fetch", async () =>
      Response.json({ path: "assets/upload-" + ++uploads }));
    const archive = new ZipBuilder()
      .file("index.html", modules ? '<script type="module" src="main.js"></script>' : '<link href="main.css" rel="stylesheet">')
      .file("main.css", '@import "theme.css";')
      .file("theme.css", '@font-face{src:url(font.woff2)}')
      .file("font.woff2", "first");
    if (modules) archive.file("main.js", 'export const font = new URL("./font.woff2", import.meta.url);');
    const read = async (existing: Asset[] = []) =>
      readHtmlZip(await archive.toBytes(), undefined, undefined, existing, true);
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
  const archive = new ZipBuilder().file("index.html", '<script src="main.js"></script>')
    .file("main.js", 'new URL("./font.woff2", import.meta.url)')
    .file("theme.css", '@font-face{src:url(font.woff2)}').file("font.woff2", "first");
  const read = async (previous: Asset[] = []) =>
    readHtmlZip(await archive.toBytes(), undefined, undefined, previous, true);
  const doc = createInitialDoc(), page = doc.pages[doc.pageOrder[0]];
  const first = await read();
  applyHtmlZipPage(doc, page.id, first);
  const original = structuredClone(doc);
  const assets = () => page.htmlZip!.assetIds.map(id => doc.assets[id]);
  const ids = () => new Map(assets().map(asset => [asset.zip!.path, asset.id]));
  const before = ids();
  archive.file("font.woff2", "second");
  const staged = await read(assets());
  // アップロードが完了した後で、別のページがこのアーカイブを使い始めることがある。
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

  // ZIP の版を分ける前にできた、古いパスの衝突を再現する。
  const oldFont = doc.assets[before.get("font.woff2")!];
  oldFont.zip!.group = module.zip!.group;
  const collidingGroup = module.zip!.group;
  applyHtmlZipPage(doc, page.id, await read(assets()));
  assert.notEqual(doc.assets[before.get("main.js")!].zip!.group, collidingGroup);
  assert.equal(Object.keys(doc.assets).length, Object.keys(original.assets).length + 1);
  assert.equal(uploads, 4);
});

test("reimport replaces a matching asset whose stored bytes could not be restored", async t => {
  const uploaded: string[] = [];
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    const file = (init!.body as FormData).get("file") as File;
    uploaded.push(await file.text());
    return Response.json({ path: "assets/upload-" + uploaded.length });
  });
  const script = 'export const label = "notes";';
  const archive = await new ZipBuilder().file("index.html", '<script type="module" src="main.js"></script>')
    .file("main.js", script).toBytes();
  const read = (previous: Asset[] = []) => readHtmlZip(archive, undefined, undefined, previous, true);
  const doc = createInitialDoc(), pageId = doc.pageOrder[0];
  const first = await read();
  applyHtmlZipPage(doc, pageId, first);

  const restored = await restoreImportAssets({ doc, assets: new Map(), warnings: [] });
  const missing = restored.doc.assets[first.assets[0].id];
  assert.equal(missing.path, undefined);
  assert.equal(missing.dataUrl, undefined);
  const repaired = await read([missing]);
  assert.deepEqual(uploaded, [script, script]);
  assert.equal(repaired.assets[0].path, "assets/upload-2");
  applyHtmlZipPage(restored.doc, pageId, repaired);
  assert.ok(Object.values(generateProject(restored.doc).remoteAssets).includes("assets/upload-2"));

  await read(repaired.assets);
  assert.equal(uploaded.length, 2);
});
});

describe("html-zip-script-assets", () => {
const stored = (id: string, name: string, path?: string): Asset => ({
  id, name, path: "assets/" + id, width: 10, height: 10,
  mimeType: name.endsWith(".mp3") ? "audio/mpeg" : name.endsWith(".js") ? "text/javascript" : "image/png",
  ...(path ? { zip: { version: 1 as const, group: "dream_zip", path } } : {}),
});

function fixture() {
  const doc = createInitialDoc();
  const home = doc.pageOrder[0];
  doc.pages = { [home]: { ...doc.pages[home], slug: "", unpublished: false } };
  doc.pageOrder = [home];
  const assets = [
    stored("existing", "MENU.png"),
    stored("menu", "MENU.png", "MENU.png"),
    stored("scene", "classroom.png", "classroom.png"),
    stored("audio", "sound.mp3", "sound.mp3"),
    stored("module", "bgm.js", "bgm.js"),
  ];
  doc.assets = Object.fromEntries(assets.map(a => [a.id, a]));
  const tick = String.fromCharCode(96);
  const source = '<!doctype html><html lang="ja"><head><title>Keep source</title></head><body>\n' +
    '<script>\n' +
    '/* url: "classroom.png" stays in this comment */\n' +
    'const BG_ASSETS = { scene: { url: "classroom.png?v=1#frame" } };\n' +
    "const UI_ASSETS = { MENU: { url: 'MENU.png' } };\n" +
    'const BGM_ASSETS = { sound: { url: ' + tick + 'sound.mp3' + tick + ' }, missing: {url: "underwater.mp3"} };\n' +
    'const remote = "https://example.test/x.png";\n' +
    'const re = /classroom\\.png/g;\n' +
    '</script>\n' +
    '<script type="application/ld+json">{"url":"MENU.png"}</script>\n' +
    '<script type="module">import "./bgm.js";</script>\n' +
    '<img src="MENU.png"><!-- MENU.png -->\n</body></html>';
  doc.pages[home].rawHtml = source;
  doc.pages[home].htmlZip = { path: "index.html", assetIds: assets.slice(1).map(a => a.id) };
  return { doc, source };
}

test("ZIP script media literals resolve without altering comments, regexes, inert scripts, markup or stored source", () => {
  const { doc, source } = fixture();
  const zip = doc.pages[doc.pageOrder[0]].htmlZip!;
  const mapped = rewriteHtmlZipScriptUrls(source, zip, doc.assets, assetSrc);
  const tick = String.fromCharCode(96);
  assert.ok(mapped.includes('url: "/api/assets/file?path=assets%2Fscene&v=1#frame"'));
  assert.ok(mapped.includes('url: "/api/assets/file?path=assets%2Fmenu"'));
  assert.ok(mapped.includes('url: ' + tick + '/api/assets/file?path=assets%2Faudio' + tick));
  assert.ok(mapped.includes('import "/api/assets/file?path=assets%2Fmodule"'));
  assert.ok(mapped.includes('/* url: "classroom.png" stays in this comment */'));
  assert.ok(mapped.includes('const re = /classroom\\.png/g;'));
  assert.ok(mapped.includes('"https://example.test/x.png"'));
  assert.ok(mapped.includes('<script type="application/ld+json">{"url":"MENU.png"}</script>'));
  assert.ok(mapped.includes('<img src="MENU.png">'));
  assert.ok(mapped.includes('<!-- MENU.png -->'));
  assert.equal(source, doc.pages[doc.pageOrder[0]].rawHtml);
  assert.deepEqual(missingHtmlZipScriptAssets(source, zip, doc.assets), ["underwater.mp3"]);
});

test("Next.js and HTML export map script image/audio paths to actual published assets including collisions", () => {
  const { doc, source } = fixture();
  const before = structuredClone(doc);
  const names = buildAssetNames(doc);
  assert.equal(names.get("menu"), "MENU-2.png");
  const next = generateProject(doc);
  const match = /^const html = (.*);$/m.exec(next.files["app/route.ts"]);
  assert.ok(match);
  const page = JSON.parse(match[1]) as string;
  const tick = String.fromCharCode(96);
  assert.ok(page.includes('url: "/assets/classroom.png?v=1#frame"'));
  assert.ok(page.includes('url: "/assets/MENU-2.png"'));
  assert.ok(page.includes('url: ' + tick + '/assets/sound.mp3' + tick));
  assert.ok(page.includes('import "/assets/_imports/dream_zip/bgm.js"'));
  assert.ok(page.includes('<img src="/assets/MENU-2.png">'));
  assert.ok(page.includes('"underwater.mp3"'));
  assert.equal(next.remoteAssets["public/assets/MENU-2.png"], "assets/menu");
  assert.equal(next.remoteAssets["public/assets/classroom.png"], "assets/scene");
  assert.equal(next.remoteAssets["public/assets/_imports/dream_zip/bgm.js"], "assets/module");

  const flat = generateExportProject(doc, "html");
  assert.ok(flat.files["index.html"].includes('url: "./assets/MENU-2.png"'));
  assert.ok(flat.files["index.html"].includes('url: "./assets/classroom.png?v=1#frame"'));
  assert.ok(flat.files["index.html"].includes('import "./assets/_imports/dream_zip/bgm.js"'));
  assert.ok(flat.files["index.html"].includes('url: ' + tick + './assets/sound.mp3' + tick));
  assert.equal(flat.remoteAssets["assets/MENU-2.png"], "assets/menu");
  assert.deepEqual(doc, before);
  assert.equal(doc.pages[doc.pageOrder[0]].rawHtml, source);
});

test("ZIP media missing in JavaScript causes a warning without preventing publication", () => {
  const { doc } = fixture();
  const warnings = runChecks(doc).filter(item => item.message.includes("underwater.mp3"));
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].level, "warn");
  assert.ok(!warnings[0].message.includes("MENU.png"));
});

test("non-ZIP HTML and external or inactive script values are never changed", () => {
  const { doc } = fixture();
  const zip = doc.pages[doc.pageOrder[0]].htmlZip!;
  const html = '<!-- <script>const url = "MENU.png";</script> -->' +
    '<script type="application/json">{"url":"MENU.png"}</script>' +
    '<script src="/other.js">let x = "MENU.png";</script>' +
    '<script>const a = "https://example.test/MENU.png"; const b = "missing.png";</script>';
  assert.equal(rewriteHtmlZipScriptUrls(html, zip, doc.assets, a => "/assets/" + a.name), html);
  assert.deepEqual(missingHtmlZipScriptAssets(html, undefined, doc.assets), []);
  assert.equal(rewriteHtmlZipScriptUrls(html, undefined, doc.assets, a => a.name), html);
});

test("markup, scripts and preflight resolve files from the active HTML base", () => {
  const { doc } = fixture();
  const page = doc.pages[doc.pageOrder[0]];
  doc.assets.root = stored("root", "root.png", "logo.png");
  doc.assets.nested = stored("nested", "nested.png", "media/logo.png");
  page.htmlZip!.assetIds.push("root", "nested");
  page.rawHtml = '<head><template><base href="https://inert.test/"></template>' +
    '<base href="media/"></head><img src="logo.png"><script>new Image().src = "logo.png";</script>';
  const published = JSON.parse(/^const html = (.*);$/m.exec(generateProject(doc).files["app/route.ts"])![1]) as string;
  assert.ok(published.includes('src="/assets/nested.png"'));
  assert.ok(published.includes('src = "/assets/nested.png"'));
  assert.deepEqual(missingHtmlZipScriptAssets(page.rawHtml, page.htmlZip, doc.assets), []);
  page.rawHtml = '<base href="https://cdn.example.test/"><script>new Image().src = "logo.png";</script>';
  assert.equal(rewriteHtmlZipScriptUrls(page.rawHtml, page.htmlZip, doc.assets, assetSrc), page.rawHtml);
  assert.deepEqual(missingHtmlZipScriptAssets(page.rawHtml, page.htmlZip, {}), []);
  assert.deepEqual(missingHtmlZipScriptAssets('<script>new Audio("missing.mp3")</script>',
    { path: "index.html", assetIds: [] }, {}), ["missing.mp3"]);
});

test("standalone HTML resolves responsive and script assets from the exported file's base", () => {
  const { doc } = fixture();
  const page = doc.pages[doc.pageOrder[0]];
  doc.pages.outer = { ...page, id: "outer", slug: "games/dream" };
  doc.pageOrder.push("outer");
  const entry = doc.pages.outer;
  const file = new URL("file:///arbitrary/export/games/dream/index.html");
  const asset = new URL("../../assets/classroom.png", file).href;
  for (const href of ["", "media/", "/media/", "../", "file.html"]) {
    const image = "/classroom.png";
    entry.rawHtml = '<head><script>new Image().src = "' + image + '";</script>' +
      (href ? '<base href="' + href + '">' : "") +
      '<link rel="preload" as="image" imagesrcset="' + image + ' 2x"></head>' +
      '<picture><source srcset="' + image + ' 1x, https://cdn.example.test/x 2x">' +
      '<img src="' + image + '"></picture>';
    const exported = generateExportProject(doc, "html").files["games/dream/index.html"];
    const base = new URL(/<base href="([^"]*)"/.exec(exported)?.[1] ?? "", file);
    for (const match of [/<img src="([^"]+)"/, /srcset="([^"]+) 1x/, /imagesrcset="([^"]+) 2x/, /src = "([^"]+)"/]) {
      const ref = match.exec(exported)?.[1];
      assert.ok(ref, match.source);
      assert.equal(new URL(ref, base).href, asset, href + " " + ref);
    }
  }
});

test("single HTML embeds media referenced from classic and module ZIP scripts", async () => {
  const { doc } = fixture();
  const page = doc.pages[doc.pageOrder[0]];
  page.rawHtml = '<base href="media/"><script>/* ../assets/MENU-2.png */ ' +
    'new Image().src="/MENU.png?v=1#icon";</script>' +
    '<script type="module">new Audio(`/sound.mp3`);</script>' +
    '<script type="application/json">{"draft":"../assets/MENU-2.png"}</script>';
  for (const id of ["menu", "audio"]) {
    const asset = doc.assets[id];
    delete asset.path;
    asset.dataUrl = "data:" + asset.mimeType + ";base64,AQID";
  }
  const ready = await prepareExportProject(doc, "single-html");
  assert.deepEqual(Object.keys(ready.files), ["index.html"]);
  const html = ready.files["index.html"];
  assert.match(html, /new Image\(\)\.src="data:image\/png;base64,AQID#icon"/);
  assert.match(html, /new Audio\(`data:audio\/mpeg;base64,AQID`\)/);
  assert.ok(html.includes("/* ../assets/MENU-2.png */"));
  assert.ok(html.includes('{"draft":"../assets/MENU-2.png"}'));
});

test("ZIP markup selects its own exported file when stored URLs share bytes or a prefix", () => {
  const { doc } = fixture();
  const page = doc.pages[doc.pageOrder[0]];
  const assets = [
    stored("first", "short.png", "short.png"),
    stored("first-long", "long.png", "long.png"),
    { ...stored("alias", "alias.png", "copy.png"), path: "assets/first" },
  ];
  doc.assets = Object.fromEntries(assets.map(a => [a.id, a]));
  page.htmlZip!.assetIds = assets.map(a => a.id);
  page.rawHtml = '<img src="short.png?v=1#icon"><source srcset="long.png 1x, copy.png 2x">';
  const next = JSON.parse(/^const html = (.*);$/m.exec(generateProject(doc).files["app/route.ts"])![1]);
  const flat = generateExportProject(doc, "html").files["index.html"];
  for (const [html, prefix] of [[next, "/"], [flat, "./"]]) {
    assert.ok(html.includes('src="' + prefix + 'assets/short.png?v=1#icon"'), html);
    assert.ok(html.includes('srcset="' + prefix + 'assets/long.png 1x, ' + prefix + 'assets/alias.png 2x"'), html);
  }
});

test("single HTML embeds ZIP audio with a generic stored media type", async t => {
  const { doc } = fixture();
  const page = doc.pages[doc.pageOrder[0]];
  const clip = { ...stored("clip", "voice.ogg", "voice.ogg"), mimeType: "application/octet-stream" };
  doc.assets = { clip };
  page.htmlZip!.assetIds = ["clip"];
  page.rawHtml = '<script>new Audio("voice.ogg?v=1#sample")</script>';
  t.mock.method(globalThis, "fetch", async () => new Response(new Uint8Array([1, 2, 3]), {
    headers: { "Content-Type": "application/octet-stream" },
  }));
  const project = await prepareExportProject(doc, "single-html");
  assert.match(project.files["index.html"], /new Audio\("data:audio\/ogg;base64,AQID#sample"\)/);
});
});

describe("html-zip-source", () => {
const urls = new Map([
  ["site/images/logo.svg", "/api/assets/file?path=assets%2Flogo"],
  ["site/css/main.css", "tsumu-zip-css:main"],
]);
const html = '<!-- before document -->\n<!doctype html>\n<HTML lang="ja">\n' +
  '  <head><!-- KEEP --><link rel="stylesheet" href="css/main.css" integrity="sha256-original">\n' +
  '  <style>/* authored */ .a{background:url(images/logo.svg)}</style></head>\n' +
  '  <body><img  alt=\'Logo\' src="images/logo.svg?v=1#icon">\n' +
  '  <script>const unmodified = "images/logo.svg";</script><!-- after script -->\n' +
  '  </body></HTML>\n<!-- after document -->';

test("HTML ZIP source rewriting changes only resource locations, preserving comments and formatting", () => {
  const converted = rewriteHtmlZipSource(html, "site/index.html", urls);
  assert.ok(converted.startsWith('<!-- before document -->\n<!doctype html>\n<HTML lang="ja">\n'));
  assert.ok(converted.includes('<!-- KEEP -->'));
  assert.ok(converted.includes('<!-- after script -->'));
  assert.ok(converted.endsWith('<!-- after document -->'));
  assert.ok(converted.includes('href="tsumu-zip-css:main"'));
  assert.ok(!converted.includes('integrity="sha256-original"'));
  assert.ok(converted.includes('src="/api/assets/file?path=assets%2Flogo&amp;v=1#icon"'));
  assert.ok(converted.includes('.a{background:url(/api/assets/file?path=assets%2Flogo)}'));
  assert.ok(converted.includes('const unmodified = "images/logo.svg"'));
  assert.ok(converted.includes('<img  alt=\'Logo\''));
  assert.equal(html.includes('integrity="sha256-original"'), true);
});

test("unresolved and external paths cause no serialization or source changes", () => {
  const source = '<!-- top -->\r\n<!DOCTYPE html>\r\n<p data-x="a&b"> <img src="missing.svg"> <!-- end -->';
  assert.equal(rewriteHtmlZipSource(source, "site/index.html", urls), source);
  assert.equal(rewriteHtmlZipSource(source, "site/index.html", new Map()), source);
  const external = '<base href="https://cdn.example.test/site/"><img src="local.svg">';
  assert.equal(rewriteHtmlZipSource(external, "site/index.html", urls), external.replace('src="local.svg"', 'src="https://cdn.example.test/site/local.svg"'));
});

test("each HTML page resolves only its own ZIP asset ID list", () => {
  const assets: Record<string, Asset> = {
    old: { id: "old", name: "logo.svg", width: 1, height: 1, path: "assets/old", zip: { version: 1, group: "a", path: "site/images/logo.svg" } },
    new: { id: "new", name: "logo.svg", width: 1, height: 1, path: "assets/new", zip: { version: 1, group: "a", path: "site/images/logo.svg" } },
  };
  const zip: HtmlZipPage = { path: "site/index.html", assetIds: ["new"] };
  assert.equal(htmlZipSource('<img src="images/logo.svg">', zip, assets, a => a.path!), '<img src="assets/new">');
  assert.equal(htmlZipSource('<img src="images/logo.svg">', undefined, assets, a => a.path!), '<img src="images/logo.svg">');
});

test("srcset and inline styles are rewritten without touching HTML comments", () => {
  const source = '<picture><!-- images/logo.svg --><source srcset="images/logo.svg 1x, /site/images/logo.svg 2x"><img style=\'background:url(images/logo.svg)\' src="data:image/png;base64,AAAA"></picture>';
  const output = rewriteHtmlZipSource(source, "site/index.html", urls);
  assert.ok(output.includes("<!-- images/logo.svg -->"));
  assert.ok(output.includes('srcset="/api/assets/file?path=assets%2Flogo 1x, /api/assets/file?path=assets%2Flogo 2x"'));
  assert.ok(output.includes('style="background:url(/api/assets/file?path=assets%2Flogo)"'));
  assert.ok(output.includes('src="data:image/png;base64,AAAA"'));
});


test("wrapped HTML ZIP images resolve in published Next.js and standalone HTML pages", () => {
  const picture: Asset = {
    id: "logo", name: "logo.svg", mimeType: "image/svg+xml", width: 12, height: 8,
    path: "assets/uploaded-logo",
    zip: { version: 1, group: "wrapped_site", path: "website/images/logo.svg" },
  };
  const source = '<!doctype html><html><head><base href="/"><style>.hero{background:url("images/logo.svg")}</style></head>' +
    '<body><img id="root" src="/images/logo.svg"><img id="relative" src="images/logo.svg">' +
    '<picture><source srcset="/images/logo.svg 1x, images/logo.svg 2x"></picture></body></html>';
  const doc: SiteDoc = {
    schemaVersion: 1, siteName: "ZIP resources", assets: { logo: picture }, nodes: {},
    pageOrder: ["home"], pages: { home: {
      id: "home", name: "Home", slug: "", title: "", description: "", children: [],
      rawHtml: source, htmlZip: { path: "website/index.html", assetIds: ["logo"] },
    } },
  };
  const original = structuredClone(doc);
  const next = generateProject(doc);
  const match = /^const html = (.*);$/m.exec(next.files["app/route.ts"]);
  assert.ok(match);
  const publishedHtml = JSON.parse(match[1]) as string;
  for (const id of ["root", "relative"]) {
    assert.ok(publishedHtml.includes(`id="${id}" src="/assets/logo.svg"`), id);
  }
  assert.ok(publishedHtml.includes('srcset="/assets/logo.svg 1x, /assets/logo.svg 2x"'));
  assert.ok(publishedHtml.includes('background:url("/assets/logo.svg")'));
  assert.equal(next.remoteAssets["public/assets/logo.svg"], "assets/uploaded-logo");
  assert.ok(!publishedHtml.includes("/api/assets/file?path="));
  const standalone = generateExportProject(doc, "html");
  assert.match(standalone.files["index.html"], /src="(?:\.\/)?assets\/logo\.svg"/);
  assert.equal(standalone.remoteAssets["assets/logo.svg"], "assets/uploaded-logo");
  assert.deepEqual(doc, original, "export never rewrites the editable HTML source");
});

test("only transformed archive stylesheets lose their original integrity metadata", () => {
  const external = '<base href="https://cdn.example/"><link rel="stylesheet" href="css/main.css" integrity="keep">';
  assert.equal(rewriteHtmlZipSource(external, "site/index.html", urls), external.replace('href="css/', 'href="https://cdn.example/css/'));
  const preload = '<link rel="preload" as="style" href="css/main.css" integrity="old">';
  assert.ok(!rewriteHtmlZipSource(preload, "site/index.html", urls).includes('integrity'));
});
});

describe("import-doc-shapes", () => {
const encoder = new TextEncoder();

test("imported node settings must have usable shape before the document is persisted", async () => {
  const corruptions: { name: string; patch: Record<string, unknown> }[] = [
    { name: "missing styles", patch: { styles: null } },
    { name: "array styles", patch: { styles: [] } },
    { name: "non-string CSS property", patch: { styles: { base: { default: { color: 1 } } } } },
    { name: "unknown node type", patch: { type: "unknown-element" } },
    { name: "unknown node semantic", patch: { semantic: "script" } },
    { name: "non-string text", patch: { text: { content: 42, heading: 0 } } },
    { name: "non-string link", patch: { link: { kind: "url", url: 5 } } },
    { name: "invalid image source", patch: { image: { src: {}, alt: "", width: 10, height: 10 } } },
    { name: "malformed field options", patch: { field: { kind: "select", options: [false] } } },
    { name: "non-array scripts", patch: { scripts: { steps: [] } } },
    { name: "invalid icon SVG", patch: { icon: { name: "imported", svg: 3 } } },
  ];
  for (const { name, patch } of corruptions) {
    const doc = createInitialDoc();
    const node = Object.values(doc.nodes)[0];
    Object.assign(node, patch);
    assert.throws(() => validateImportedDoc(doc), /invalid element settings/i, name);
    await assert.rejects(parseSiteImport(encoder.encode(JSON.stringify(doc)), "doc"), /invalid element settings/i, name);
  }
});

test("imported page style maps cannot contain malformed declarations", () => {
  const doc = createInitialDoc();
  Object.assign(doc.pages[doc.pageOrder[0]], {
    bodyStyles: { base: { default: { backgroundColor: ["red"] } } },
  });
  assert.throws(() => validateImportedDoc(doc), /page structure/i);
});

test("imported SiteDoc rejects dangling asset references before saving or reopening", async () => {
  const referenceCases: Array<(doc: ReturnType<typeof createInitialDoc>) => void> = [
    doc => { Object.values(doc.nodes)[0].image = { src: "", alt: "", width: 1, height: 1, assetId: "missing" }; },
    doc => { Object.values(doc.nodes)[0].media = { kind: "video", src: "", assetId: "missing" }; },
    doc => { doc.pages[doc.pageOrder[0]].ogImage = { assetId: "missing" }; },
    doc => { doc.favicon = { assetId: "missing" }; },
    doc => { doc.appleTouchIcon = { assetId: "missing" }; },
    doc => { doc.ogImage = { assetId: "missing" }; },
    doc => { doc.pwa = { enabled: true, icon: { assetId: "missing" } }; },
  ];
  for (const [index, setRef] of referenceCases.entries()) {
    const doc = createInitialDoc();
    setRef(doc);
    assert.throws(() => validateImportedDoc(doc), /asset references/i, String(index));
    await assert.rejects(parseSiteImport(encoder.encode(JSON.stringify(doc)), "doc"), /asset references/i, String(index));
  }
  const valid = createInitialDoc();
  valid.assets.existing = { id: "existing", name: "existing.png", width: 1, height: 1 };
  Object.values(valid.nodes)[0].image = { src: "", alt: "", width: 1, height: 1, assetId: "existing" };
  assert.equal(validateImportedDoc(valid), valid);
});

test("imported SiteDoc rejects missing or duplicate page folders", () => {
  const doc = createInitialDoc();
  const page = doc.pages[doc.pageOrder[0]];
  page.folderId = "missing";
  assert.throws(() => validateImportedDoc(doc), /page folder/i);
  doc.pageFolders = [{ id: "folder", name: "Folder" }];
  page.folderId = "folder";
  assert.equal(validateImportedDoc(doc), doc);
  doc.pageFolders.push({ id: "folder", name: "Duplicate" });
  assert.throws(() => validateImportedDoc(doc), /page folder/i);
});

test("valid documents retain editable node styles after validation", () => {
  const doc = createInitialDoc();
  assert.equal(validateImportedDoc(doc), doc);
});


test("non-browser import strips active or external SVG content rather than bypassing sanitization", () => {
  const hostile = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" ' +
    'onload="globalThis.injected=1"><script>alert(1)</script>' +
    '<foreignObject><div onclick="alert(2)">unsafe</div></foreignObject>' +
    '<rect width="10" height="10" fill="url(https://remote.example/payload)"/>' +
    '<circle cx="5" cy="5" r="3"/></svg><img src=x onerror="alert(3)">';
  const cleaned = sanitizeImportedSvg(hostile);
  assert.match(cleaned, /<svg\b/);
  assert.match(cleaned, /<circle\b/);
  assert.doesNotMatch(cleaned, /onload|onerror|<script|foreignobject|remote\.example|url\(https?:|<img|alert\(/i);
  assert.ok(!cleaned.includes('fill="url('));
});


test("import and clipboard validation block unsafe inline SVG across browser and server", () => {
  const doc = createInitialDoc();
  const icon = makeIcon();
  const page = doc.pages[doc.pageOrder[0]];
  doc.nodes[icon.id] = icon;
  page.children.push(icon.id);
  const originalBytes = icon.icon!.svg;
  assert.equal(sanitizeImportedSvg(originalBytes), originalBytes, "safe self-closing SVG preserves exact bytes");
  assert.equal(validateImportedDoc(doc), doc);
  for (const payload of [
    '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><rect width="5" height="5"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><iframe srcdoc="unsafe"></iframe></foreignObject></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://attacker.example/svg"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><style>body{background:url(https://attacker.example/css)}</style><rect width="5" height="5"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><a href="https://attacker.example"><rect width="5" height="5"/></a></svg>',
    String.raw`<svg xmlns="http://www.w3.org/2000/svg"><rect width="5" height="5" fill="u\72l(https://attacker.example/p)"/></svg>`,
    '<svg xmlns="http://www.w3.org/2000/svg"><rect width="5" height="5" fill="url(/*c*/https://attacker.example/p)"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><desc>unclosed',
    '<svg xmlns="http://www.w3.org/2000/svg"/>',
    '<!--<svg>--><svg xmlns="http://www.w3.org/2000/svg"><circle cx="1" cy="1" r="1"/></svg>',
  ]) {
    icon.icon!.svg = payload;
    assert.throws(() => validateImportedDoc(doc), /invalid element settings/i);
    assert.equal(parseClipPayload(JSON.stringify({
      v: 1, site: "s", breakpoints: doc.breakpoints ?? [], rootIds: [icon.id],
      nodes: [icon], assets: {}, components: {}, componentNodes: [],
    })), null);
  }
  assert.equal(
    sanitizeImportedSvg('<svg xmlns="http://www.w3.org/2000/svg"><desc>unclosed'),
    '<svg xmlns="http://www.w3.org/2000/svg"><desc>unclosed</desc></svg>',
  );
});

test("restoring a backup sanitizes inline SVG without changing other editable properties", () => {
  const doc = createInitialDoc();
  const icon = makeIcon();
  const original = '<svg xmlns="http://www.w3.org/2000/svg" onload="globalThis.bad=1">' +
    '<circle cx="5" cy="5" r="3"/><foreignObject><img src=x onerror="alert(1)"/></foreignObject></svg>';
  icon.icon!.svg = original;
  doc.nodes[icon.id] = icon;
  const rootId = doc.pages[doc.pageOrder[0]].children[0]!;
  doc.nodes[rootId].icon = { name: "box-icon", svg: original };
  doc.pages[doc.pageOrder[0]].children.push(icon.id);
  const before = structuredClone(doc);
  const restored = sanitizeImportedInlineIcons(structuredClone(doc));
  const cleaned = restored.nodes[icon.id].icon!.svg;
  assert.match(cleaned, /<circle\b/);
  assert.doesNotMatch(cleaned, /onload|onerror|foreignObject|<img|alert\(/i);
  assert.equal(restored.nodes[rootId].icon?.svg, cleaned);
  assert.equal(validateImportedDoc(restored), restored);
  assert.equal(doc.nodes[icon.id].icon!.svg, original);
  assert.deepEqual(restored.pages, before.pages);
  assert.deepEqual(restored.assets, before.assets);
});
});

describe("imported-asset-copy", () => {
  before(() => {
    useEditor.setState({
      breakpoint: "base", customWidth: null, styleState: "default", mode: "design",
      pageTheme: "light", selection: null, selectedIds: [], editingComponentId: null, scriptEditor: null,
    });
  });
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
  // ページの設定の中のモジュールも、要素のコピーと同じ依存関係を保つ。
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
  // 同じ ZIP の同じ場所のものなら、もう一度貼り付けても、アセットを増やさない。
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
  // 2回目のコピーでは、最初の転送で割り当てたコピー先の ID を使い回す。
  const assets = structuredClone(target.assets);
  applyPagePayload(target, payload);
  assert.deepEqual(target.assets, assets);
  assert.deepEqual(target.pages[target.pageOrder.at(-1)!].htmlZip!.assetIds, [id]);
  assert.deepEqual(page.htmlZip.assetIds, [picture.id]);
});

test("explicit page copies retain local ZIP scripts and data without changing clipboard acceptance", () => {
  const source = createInitialDoc(), page = source.pages[source.pageOrder[0]];
  const module: Asset = { ...asset("entry", "main.js"), path: undefined,
    dataUrl: "data:text/javascript;base64,ZXhwb3J0IHt9Ow==" };
  const data: Asset = { ...asset("json", "config.json"), path: undefined, mimeType: "application/json",
    dataUrl: "data:application/json;base64,e30=" };
  const audio: Asset = { ...asset("audio", "voice.ogg"), path: undefined, mimeType: "application/octet-stream",
    dataUrl: "data:application/octet-stream;base64,AQID" };
  source.assets = { entry: module, json: data, audio };
  page.rawHtml = '<script type="module" src="main.js"></script>';
  page.htmlZip = { path: "index.html", assetIds: ["entry", "json", "audio"] };
  const payload = buildPagePayload(source, [page.id]);
  const direct = createInitialDoc();
  direct.assets = {};
  mergeClipDeps(direct, payload.deps);
  assert.deepEqual(direct.assets, {});

  const dest = createInitialDoc();
  dest.assets.entry = asset("entry", "different.js");
  applyPagePayload(dest, payload);
  const copied = dest.pages[dest.pageOrder.at(-1)!];
  const [entryId, jsonId, audioId] = copied.htmlZip!.assetIds;
  assert.notEqual(entryId, "entry");
  assert.deepEqual(dest.assets[entryId], { ...module, id: entryId });
  assert.deepEqual(dest.assets[jsonId], data);
  assert.deepEqual(dest.assets[audioId], audio);
  const project = generateProject(dest);
  assert.equal(project.binaries[importedAssetPath(module)!], "ZXhwb3J0IHt9Ow==");
  assert.equal(project.binaries[importedAssetPath(data)!], "e30=");
  assert.ok(Object.values(project.files).some(file => file.includes("_imports/zip_page/main.js")));
  assert.ok(validSiteDoc(dest));
});

test("page copy fails before mutation if a required ZIP member is missing or disallowed", () => {
  const source = createInitialDoc(), page = source.pages[source.pageOrder[0]];
  source.assets = { first: asset("first", "picture.png"), second: asset("second", "main.js") };
  page.rawHtml = '<script src="main.js"></script>';
  page.htmlZip = { path: "index.html", assetIds: ["first", "second"] };
  const original = buildPagePayload(source, [page.id]);
  const dest = createInitialDoc();
  dest.assets.second = asset("second", "unrelated.js");
  const before = structuredClone(dest);
  for (const problem of ["missing", "html-name", "xml-path", "wrong-media"]) {
    const p = structuredClone(original);
    const member = p.deps.assets.second;
    if (problem === "missing") delete p.deps.assets.second;
    if (problem === "html-name") member.name = "page.html";
    if (problem === "xml-path") member.zip!.path = "page.xml";
    if (problem === "wrong-media") member.dataUrl = "data:text/html;base64,PGI+";
    assert.throws(() => applyPagePayload(dest, p), /Asset references are invalid/);
    assert.deepEqual(dest, before);
  }
});
});

describe("imported-asset-paths", () => {
function fixture(path: string, id: string, name: string): Asset {
  return {
    id, name, path: "assets/" + id, width: 0, height: 0,
    mimeType: name.endsWith(".js") ? "text/javascript" : "image/svg+xml",
    zip: { version: 1, group: "zip_example", path },
  };
}

test("relative ZIP module references retain their original public directory", () => {
  const script = fixture("website/js/main.js", "main", "main.js");
  const chunk = fixture("website/js/util.js", "util", "util.js");
  const image = fixture("website/images/icon.svg", "icon", "icon.svg");
  const doc = createInitialDoc();
  doc.assets = Object.fromEntries([script, chunk, image].map((item) => [item.id, item]));
  doc.pages[doc.pageOrder[0]].customEndHtml =
    '<script type="module" src="/api/assets/file?path=assets%2Fmain"></script>';
  const result = generateProject(doc);
  assert.equal(importedAssetPath(script), "public/assets/_imports/zip_example/website/js/main.js");
  assert.equal(importedAssetUrl(script), "/assets/_imports/zip_example/website/js/main.js");
  assert.equal(result.remoteAssets[importedAssetPath(script)!], "assets/main");
  assert.equal(result.remoteAssets[importedAssetPath(chunk)!], "assets/util");
  assert.equal(result.remoteAssets[importedAssetPath(image)!], "assets/icon");
  const page = result.files["app/page.tsx"];
  assert.ok(page);
  assert.match(page, /\/assets\/_imports\/zip_example\/website\/js\/main\.js/);
  assert.doesNotMatch(page, /api\/assets\/file\?path/);
});

test("portable punctuation in ZIP module paths keeps relative imports and media resolvable", () => {
  const script = fixture("web site/scripts/app (v2)&team!.js", "entry", "app.js");
  const chunk = fixture("web site/scripts/chunk [prod],v2.js", "chunk", "chunk.js");
  const image = fixture("web site/images/banner (2026)&team.png", "banner", "banner.png");
  const doc = createInitialDoc();
  doc.assets = { entry: script, chunk, banner: image };
  const page = doc.pages[doc.pageOrder[0]];
  page.rawHtml = '<script type="module" src="scripts/app%20(v2)%26team!.js"></script>';
  page.htmlZip = { path: "web site/index.html", assetIds: ["entry", "chunk", "banner"] };
  const generated = generateProject(doc);
  const html: string = JSON.parse(/^const html = (.*);$/m.exec(generated.files["app/route.ts"])![1]);
  const src = /<script type="module" src="([^"]+)"/.exec(html)?.[1];
  assert.ok(src);
  const entryUrl = new URL(src, "https://site.example/");
  const dependencyUrl = new URL("./chunk%20%5Bprod%5D%2Cv2.js", entryUrl);
  const mediaUrl = new URL("../images/banner%20(2026)%26team.png", entryUrl);
  assert.equal(generated.remoteAssets["public" + decodeURIComponent(entryUrl.pathname)], "assets/entry");
  assert.equal(generated.remoteAssets["public" + decodeURIComponent(dependencyUrl.pathname)], "assets/chunk");
  assert.equal(generated.remoteAssets["public" + decodeURIComponent(mediaUrl.pathname)], "assets/banner");
  assert.equal(importedAssetUrl(script), entryUrl.pathname);
});

test("unsafe or corrupted ZIP paths never become export output paths", () => {
  for (const input of ["../outside.js", "/outside.js", "js/../../outside.js",
    "js\\outside.js", "js//outside.js", "js/asset?danger.js", "js/%2e%2e.js"]) {
    assert.equal(importedAssetPath(fixture(input, "unsafe", "unsafe.js")), null, input);
  }
});

test("localized ZIP module paths remain directories and relative browser imports reach real files", () => {
  const script = fixture("@公開 版+2/入口.js", "main", "entry.js");
  const chunk = fixture("@公開 版+2/音声 読込.js", "chunk", "chunk.js");
  const doc = createInitialDoc();
  doc.assets = { main: script, chunk };
  const page = doc.pages[doc.pageOrder[0]];
  page.rawHtml = '<script type="module" src="%E5%85%A5%E5%8F%A3.js"></script>';
  page.htmlZip = { path: "@公開 版+2/index.html", assetIds: ["main", "chunk"] };
  const next = generateProject(doc);
  const html: string = JSON.parse(/^const html = (.*);$/m.exec(next.files["app/route.ts"])![1]);
  const entry = new URL(/<script type="module" src="([^"]+)"/.exec(html)![1], "https://site.example/");
  const dependency = new URL("./音声%20読込.js", entry);
  assert.equal(next.remoteAssets["public" + decodeURIComponent(entry.pathname)], "assets/main");
  assert.equal(next.remoteAssets["public" + decodeURIComponent(dependency.pathname)], "assets/chunk");
});
});

describe("imported-html-attrs", () => {
  before(() => {
    useEditor.setState({
      breakpoint: "base", customWidth: null, styleState: "default", mode: "design",
      pageTheme: "light", selection: null, selectedIds: [], editingComponentId: null, scriptEditor: null,
    });
  });
test("safe imported HTML attributes preserve original CSS and accessibility hooks", () => {
  const attrs = importedAttributes({
    "class": "ignored-in-extra-map",
    "data-topic": "billing",
    "aria-label": "Download site",
    "title": "Edit",
    "role": "button",
    "for": "query",
    "lang": "ja",
    "tabindex": "0",
  });
  assert.deepEqual(attrs, {
    "data-topic": "billing",
    "aria-label": "Download site",
    title: "Edit",
    role: "button",
    htmlFor: "query",
    lang: "ja",
    tabIndex: "0",
  });
  // 同じ属性は、SiteDoc から読み直したときにも正しくなければならない。
  assert.deepEqual(importedAttributes(attrs), attrs);
  assert.equal(importedClass("  btn  sm:hover:bg-gray-100  "), "btn  sm:hover:bg-gray-100");
});

test("untrusted HTML cannot override editor markers or inject handlers and URLs", () => {
  const attrs = importedAttributes({
    "onclick": "alert(1)",
    "onmouseover": "alert(1)",
    "src": "javascript:alert(1)",
    "href": "javascript:alert(1)",
    "style": "background:red",
    "data-node": "overwritten",
    "data-ghost": "overwritten",
    "data-tpl": "broken",
    "data-scripts": "run",
    "data-tsumu-secret": "x",
    "data-site-state": "selected",
    "data-row": "fake-row",
    "data-loader": "fake-loader",
    "data-page-plan": "fake-plan",
    "data-list-fallback": "fake-fallback",
    "data-live-href": "javascript:alert(1)",
    "data-live-src": "javascript:alert(1)",
    "data-image-src-parts": "unsafe",
    "data-edited": "",
    "data-page-variants": "alternate",
    "data-variant-root": "root",
    "data-driven": "true",
    "data-allowed": "safe",
  });
  assert.deepEqual(attrs, { "data-allowed": "safe" });
});

test("form attributes retain native defaults and apply only to their controls", () => {
  const fields = { form: "signup", formaction: "", formmethod: "POST", type: "submit", formnovalidate: "yes" };
  assert.deepEqual(submissionAttributes(fields, "textarea"), { form: "signup" });
  assert.deepEqual(submissionAttributes(fields, "input"), { form: "signup" });
  assert.deepEqual(submissionProps(submissionAttributes(fields, "button")), {
    form: "signup", formAction: "", formMethod: "post", formNoValidate: true, type: "submit",
  });
  assert.deepEqual(submissionAttributes({ action: "/apply", method: 1, target: {} }, "form", () => "file:///local"), { action: "#" });
});

test("duplicating a form keeps its label, form owner and ARIA references with the copy", () => {
  const editor = useEditor.getState();
  editor.replaceDoc({
    siteName: "Forms", assets: {}, pageOrder: ["p"],
    pages: { p: { id: "p", name: "Home", slug: "", title: "", description: "", children: ["form", "help"] } },
    nodes: {
      form: { ...makeBox(), id: "form", attrId: "signup", semantic: "form", children: ["label", "email"] },
      label: { ...makeBox(), id: "label", attrId: "email.label", semantic: "custom", customTag: "label", htmlAttrs: { htmlFor: "email" } },
      email: { ...makeBox(), id: "email", attrId: "email", type: "field", field: { kind: "input", inputType: "email" },
        htmlAttrs: { form: "signup", "aria-labelledby": "email.label  help", "data-field": "email" } },
      help: { ...makeBox(), id: "help", attrId: "help" },
    },
  });
  editor.setActivePage("p");
  editor.duplicateNode("form");
  const { doc, selection } = useEditor.getState();
  const form = doc.nodes[selection!];
  const [label, field] = form.children.map(id => doc.nodes[id]);
  assert.notEqual(field.attrId, doc.nodes.email.attrId);
  assert.equal(label.htmlAttrs!.htmlFor, field.attrId);
  assert.deepEqual(field.htmlAttrs, {
    form: form.attrId, "aria-labelledby": `${label.attrId}  help`, "data-field": "email",
  });
  assert.equal(doc.nodes.label.htmlAttrs!.htmlFor, "email");
});
});

describe("untrusted-zip-css", () => {
const SEED = 0x4a202611;
function seeded(seed: number) {
  let value = seed >>> 0;
  return () => {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    return value >>> 0;
  };
}

test("ZIP extraction round-trips bounded random bytes and rejects undersized output limits", async () => {
  const next = seeded(SEED ^ 0x707);
  for (let i = 0; i < 48; i++) {
    const payload = Uint8Array.from({ length: 1 + next() % 4096 }, () => next() & 255);
    const zipped = await new ZipBuilder()
      .file("index.html", "<main>valid</main>")
      .file("assets/random.bin", payload)
      .toBytes({ compression: i % 2 ? "DEFLATE" : "STORE" });
    const parsed = await openImportZip(zipped, 200);
    const inspected = inspectHtmlZip(parsed);
    assert.equal(inspected.htmlEntry.name, "index.html");
    assert.deepEqual(await readZipEntryLimited(parsed.file("assets/random.bin")!, payload.length), payload,
      "seed=" + SEED + " case=" + i);
    await assert.rejects(readZipEntryLimited(parsed.file("assets/random.bin")!, payload.length - 1),
      /expands beyond the size limit/, "seed=" + SEED + " case=" + i);
  }
});

test("central-directory and local-header corruptions fail before parsing untrusted documents", async () => {
  const doc = createInitialDoc();
  doc.assets = {};
  const raw = await new ZipBuilder()
    .file("_tsumu/doc.json", JSON.stringify(doc))
    .file("_tsumu/assets.json", JSON.stringify({ version: 1, assets: {} }))
    .toBytes({ compression: "STORE" });
  const normal = await parseSiteImport(raw, "zip");
  assert.deepEqual(normal.doc, JSON.parse(JSON.stringify(doc)));
  assert.doesNotThrow(() => validateImportedDoc(normal.doc));
  const end = raw.length - 22; // この準備のアーカイブには、コメントが無い。
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  assert.equal(view.getUint32(end, true), 0x06054b50);
  const central = view.getUint32(end + 16, true);
  assert.equal(view.getUint32(central, true), 0x02014b50);
  const mutations: { name: string; at: number; mask: number }[] = [
    { name: "end signature", at: end, mask: 1 },
    { name: "central signature", at: central, mask: 1 },
    { name: "local signature", at: 0, mask: 1 },
    { name: "local member name", at: 30, mask: 1 },
    { name: "record count", at: end + 10, mask: 1 },
    { name: "directory size", at: end + 12, mask: 0x80 },
    { name: "directory offset", at: end + 16, mask: 0x80 },
  ];
  for (const { name, at, mask } of mutations) {
    const damaged = raw.slice();
    damaged[at] ^= mask;
    await assert.rejects(parseSiteImport(damaged, "zip"), undefined,
      "seed=" + SEED + " mutation=" + name);
  }
});

test("archive path normalization is rejected across editable and raw HTML entry points", async () => {
  const doc = createInitialDoc();
  doc.assets = {};
  const paths = ["../escape.js", "assets/../escape.js", "assets\\escape.js", "/absolute.js"];
  for (const [i, path] of paths.entries()) {
    const html = await new ZipBuilder()
      .file("index.html", "<main>ok</main>")
      .file(path, "unsafe")
      .toBytes();
    const zip = await openImportZip(html, 200);
    assert.throws(() => inspectHtmlZip(zip), /unsafe path/,
      "seed=" + SEED + " HTML path=" + i);
    const editable = await new ZipBuilder()
      .file("_tsumu/doc.json", JSON.stringify(doc))
      .file("_tsumu/assets.json", JSON.stringify({ version: 1, assets: {} }))
      .file(path, "unsafe")
      .toBytes();
    await assert.rejects(parseSiteImport(editable, "zip"), /unsafe path/,
      "seed=" + SEED + " doc path=" + i);
  }
  for (const names of [
    ["assets/logo.svg", "assets/LOGO.svg"],
    ["assets/caf\u00e9.svg", "assets/cafe\u0301.svg"],
  ]) {
    const html = await new ZipBuilder()
      .file("index.html", "<main>ok</main>")
      .file(names[0], "first")
      .file(names[1], "second")
      .toBytes();
    const parsed = await openImportZip(html, 200);
    assert.throws(() => inspectHtmlZip(parsed), /duplicate file paths/);
  }
});

test("mutated CSS cannot terminate an inline style or create extra URL tokens", () => {
  const next = seeded(SEED ^ 0x1010);
  const tokens = [
    "</style>", "</StYlE><script>globalThis.injected=true</script><style>",
    "background:url(assets/a.png);", "@import url(assets/b.css);",
    "a::after{content:'<\\/style>'}", "\n", "\r", "/* comment */", "\\", "'",
    '"', "日本語", "<", ">", "url('data:image/png;base64,AAAA')",
  ];
  for (let i = 0; i < 400; i++) {
    const input = Array.from({ length: 1 + next() % 12 }, () => tokens[next() % tokens.length]).join("");
    const escaped = escapeStyleContent(input);
    assert.doesNotMatch(escaped, /<\/style/i, "seed=" + SEED + " case=" + i);
    assert.equal(escapeStyleContent(escaped), escaped);
    const rewritten = rewriteCssAssetUrls(input, (url) => url === "assets/a.png" ? "assets/b.png" : url);
    assert.equal(typeof rewritten, "string");
    assert.ok(rewritten.length >= 0);
  }
});
});

describe("zip-css", () => {
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

test("nested CSS functions retain only the current image-set candidates after the stack grows", () => {
  const css = 'image-set(linear-gradient(' + "f(".repeat(80) + '"ignored.png"' + ")".repeat(80) +
    '), "outer.png" 2x, -webkit-image-set("inner.png" 1x), "last.png" 4x)';
  assert.deepEqual(cssAssetReferences(css).map(ref => ref.url), ["outer.png", "inner.png", "last.png"]);
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
  assert.throws(() => zipCssPreviewUrls(record(dag), ["d0"], assetSrc), /CSS|stylesheet/i);
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

test("page export keeps query-bearing ZIP styles and standalone CSS resolves from its emitted file", () => {
  const doc = createInitialDoc();
  const a = sheet("base", "css/base.css", '@import "theme.css";');
  const b = sheet("theme", "css/theme.css", '.one{background:url("../images/photo.svg")}.two{mask:url("/assets/images-photo.svg?rev=2#mask")}');
  const photo = image();
  attachZipDependencies([a, b, photo]);
  doc.assets = record([a, b, photo, image("unused", "unused.svg")]);
  const pageId = doc.pageOrder[0];
  doc.pages[pageId].rawHtml = `<link rel="stylesheet" href="${zipCssUrl(a.id)}?rev=1#screen">`;
  const options = { framework: "html", language: "javascript", style: "css", scope: "page", pageId } as const;
  const project = generateExportProject(doc, options);
  assert.ok(project.files["index.html"].includes('href="./assets/css-base.css?rev=1#screen"'));
  assert.equal(project.files["assets/css-base.css"], '@import "css-theme.css";');
  const sheetFile = "assets/css-theme.css";
  const urls = cssAssetReferences(project.files[sheetFile]).map(ref =>
    new URL(ref.url, "https://example.test/subsite/" + sheetFile));
  assert.deepEqual(urls.map(url => url.pathname), ["/subsite/assets/images-photo.svg", "/subsite/assets/images-photo.svg"]);
  assert.equal(urls[1].search + urls[1].hash, "?rev=2#mask");
  assert.deepEqual(project.remoteAssets, { "assets/images-photo.svg": photo.path });
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
  await assert.rejects(() => withSignedAssetUrls(`<link href="${zipCssUrl("a")}">`, { a }), /CSS|stylesheet/i);
  await assert.rejects(() => withSignedAssetUrls(`<link href="${zipCssUrl("missing")}">`, {}), /CSS|stylesheet/i);
});

test("real ZIP import rejects unsupported CSS encodings and excessive CSS without committing document state", async () => {
  const originalFetch = globalThis.fetch;
  const doc = createInitialDoc();
  const before = structuredClone(doc);
  let uploads = 0;
  globalThis.fetch = async () => { uploads++; return Response.json({ path: "assets/test" }); };
  try {
    for (const css of [Buffer.from('@charset "shift_jis";a{}'), Buffer.from([0xff, 0xfe, 65, 0]), Buffer.alloc(2 * 1024 * 1024 + 1, 32)]) {
      const zip = new ZipBuilder().file("index.html", '<link href="style.css">').file("script.js", 'export {};').file("style.css", css);
      await assert.rejects(async () => {
        const result = await readHtmlZip(await zip.toBytes());
        for (const a of result.assets) doc.assets[a.id] = a;
        doc.pages[doc.pageOrder[0]].rawHtml = result.html;
      }, /UTF-8|ZIP stylesheets/);
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
  const { rewriteHtmlAssetUrls } = await import("../lib/generator/css");
  const doc = createInitialDoc();
  doc.assets = record([sheet("a", "a.css", "a{}"), sheet("ab", "ab.css", "b{}")]);
  const names = new Map([["a", "first.css"], ["ab", "second.css"]]);
  const html = `<link href="${zipCssUrl("ab")}?v=1&amp;x=2#theme"><link href="${zipCssUrl("a")}#other">`;
  assert.equal(rewriteHtmlAssetUrls(doc, html, names), '<link href="/assets/second.css?v=1&amp;x=2#theme"><link href="/assets/first.css#other">');
  assert.throws(() => rewriteHtmlAssetUrls(doc, '<link href="tsumu-zip-css:abc">', names), /CSS|stylesheet/i);
});


test("invalid nested stylesheet metadata is not silently treated as a unmapped remote file", () => {
  const a = sheet("a", "a.css", '@import "b.css";');
  const b = sheet("b", "b.css", ".x{color:red}");
  attachZipDependencies([a, b]);
  b.zip!.version = 9 as 1;
  assert.throws(() => zipCssPreviewUrls(record([a, b]), ["a"], assetSrc), /CSS|stylesheet/i);
  assert.throws(() => exportZipStylesheet(b, new Map([["a", "a.css"], ["b", "b.css"]])), /CSS|stylesheet/i);
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
  assert.throws(() => zipCssPreviewUrls(record([a, b]), ["a"], assetSrc), /CSS|stylesheet/i);
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
});

describe("zip-references", () => {
const proxy = "/api/assets/file?path=assets%2Flogo.svg";
const urls = new Map([["images/logo.svg", proxy], ["pages/photo one.png", "/api/assets/file?path=assets%2Fphoto.png"]]);

test("ZIP references resolve relative, root-relative and encoded archive paths", () => {
  assert.equal(resolveZipReference("../images/logo.svg", "pages/index.html", urls), proxy);
  assert.equal(resolveZipReference("/images/logo.svg", "pages/index.html", urls), proxy);
  assert.equal(resolveZipReference("./photo%20one.png", "pages/index.html", urls), urls.get("pages/photo one.png"));
});

test("missing and external ZIP references remain byte-for-byte unchanged", () => {
  for (const value of ["missing.css?v=1#theme", "next.html?one=1&two=2#section", "https://example.com/a?v=1#x", "//example.com/a", "data:image/png;base64,AAAA", "#local", "photo%XX.png"]) {
    assert.equal(resolveZipReference(value, "pages/index.html", urls), value);
  }
});

test("mapped ZIP references keep query and fragment without corrupting the asset path", () => {
  const rewritten = resolveZipReference("../images/logo.svg?v=1&theme=dark#icon", "pages/index.html", urls);
  assert.equal(rewritten, `${proxy}&v=1&theme=dark#icon`);
  const request = new URL(rewritten, "https://editor.example");
  assert.equal(request.searchParams.get("path"), "assets/logo.svg");
  assert.equal(request.searchParams.get("v"), "1");
  assert.equal(request.searchParams.get("theme"), "dark");
  assert.equal(request.hash, "#icon");
});

test("exported ZIP assets retain queries in CSS and serialized HTML", () => {
  const doc = createInitialDoc();
  doc.assets.logo = { id: "logo", name: "logo.svg", path: "assets/logo.svg", width: 10, height: 10 };
  const names = new Map([["logo", "logo.svg"]]);
  const resolveValue = createCssValueResolver(doc, names);
  assert.equal(resolveValue("backgroundImage", `url('${proxy}&v=1#icon')`), "url('/assets/logo.svg?v=1#icon')");
  assert.equal(rewriteHtmlAssetUrls(doc, `<img src="${proxy}&amp;v=1&amp;theme=dark#icon">`, names), '<img src="/assets/logo.svg?v=1&amp;theme=dark#icon">');
  assert.equal(rewriteHtmlAssetUrls(doc, `<img src="${proxy}#icon">`, names), '<img src="/assets/logo.svg#icon">');
});

test("archive directory names are literal, not URL-encoded", () => {
  for (const directory of ["50% off", "photo%20set"]) {
    const paths = new Map([[`${directory}/logo.svg`, proxy]]);
    assert.equal(resolveZipReference("logo.svg", `${directory}/index.html`, paths), proxy);
  }
});


test("local data assets drop cache queries without corrupting their bytes, even without a CSS root", () => {
  const data = "data:image/svg+xml;base64,PHN2Zy8+";
  const urls = new Map([["image.svg", data]]);
  assert.equal(resolveZipReference("image.svg?v=1", "index.html", urls), data);
  assert.equal(resolveZipReference("image.svg?v=1#icon", "index.html", urls), data + "#icon");
});


test("root-relative resources in a wrapped site ZIP resolve without altering external URLs", () => {
  const resources = new Map([
    ["site/images/logo.svg", proxy],
    ["site/css/main.css", "/api/assets/file?path=assets%2Fmain.css"],
  ]);
  assert.equal(resolveZipReference("/images/logo.svg", "site/index.html", resources), proxy);
  assert.equal(resolveZipReference("/images/logo.svg?v=1#icon", "site/pages/about.html", resources), proxy + "&v=1#icon");
  assert.equal(resolveZipReference("/css/main.css", "site/index.html", resources), resources.get("site/css/main.css"));
  assert.equal(zipDependency("/images/logo.svg", "site/css/main.css", new Map([
    ["site/images/logo.svg", "logo"],
  ]))?.assetId, "logo");
  // アーカイブの直下に明示的に置いたアセットを、包むフォルダからの代わりの解決より優先する。
  const both = new Map([["images/logo.svg", "at-root"], ["site/images/logo.svg", "wrapped"]]);
  assert.equal(resolveZipReference("/images/logo.svg", "site/index.html", both), "at-root");
  assert.equal(resolveZipReference("https://cdn.example/logo.svg", "site/index.html", resources), "https://cdn.example/logo.svg");
  assert.equal(resolveZipReference("/missing.svg", "site/index.html", resources), "/missing.svg");
});

test("root-relative URLs resolve through multiple wrapper directories around a ZIP site", () => {
  const nested = new Map([
    ["archive/project/dist/images/logo.svg", "nested-logo"],
    ["archive/project/dist/css/main.css", "nested-css"],
  ]);
  for (const html of ["archive/project/dist/index.html", "archive/project/dist/pages/about.html"]) {
    assert.equal(resolveZipReference("/images/logo.svg", html, nested), "nested-logo");
    assert.equal(resolveZipReference("/css/main.css?v=2#main", html, nested), "nested-css?v=2#main");
  }
  assert.equal(zipDependency("/images/logo.svg", "archive/project/dist/css/main.css",
    new Map([["archive/project/dist/images/logo.svg", "logo-id"]]))?.assetId, "logo-id");

  // Keep the existing rule that archive-root and shallower wrapper paths win.
  const withAlternatives = new Map([
    ["images/logo.svg", "archive-root"],
    ["archive/images/logo.svg", "first-wrapper"],
    ["archive/project/dist/images/logo.svg", "site-root"],
  ]);
  assert.equal(resolveZipReference("/images/logo.svg", "archive/project/dist/index.html", withAlternatives), "archive-root");
  withAlternatives.delete("images/logo.svg");
  assert.equal(resolveZipReference("/images/logo.svg", "archive/project/dist/index.html", withAlternatives), "first-wrapper");
});
});

describe("zip-svg-references", () => {
const { parse } = createRequire(import.meta.url)("next/dist/compiled/node-html-parser");

test("ZIP SVG image and sprite references follow uploaded assets through export", async () => {
  const originals = Object.getOwnPropertyDescriptors(globalThis);
  // Node.js の代わりの部品で、ネイティブの SVG の描画ではなく、実際の ZIP の取り込みと書き出しを試す。
  Object.assign(globalThis, {
    DOMParser: class {
      parseFromString(html: string) {
        const root = parse(html);
        return { querySelectorAll: (selector: string) => root.querySelectorAll(selector), documentElement: root.querySelector("html") };
      }
    },
    Image: class {
      naturalWidth = 24; naturalHeight = 24; onload?: () => void;
      set src(_value: string) { queueMicrotask(() => this.onload?.()); }
    },
    fetch: async (_url: unknown, options: RequestInit) => {
      const file = (options.body as FormData).get("file") as File;
      return Response.json({ path: `assets/${file.name}` });
    },
  });
  try {
    const html = `<html><body><svg xmlns:xlink="http://www.w3.org/1999/xlink">
      <use id="namespaced" xlink:href="icons/sprite.svg#check"></use>
      <use id="modern" href="icons/sprite.svg#check"></use>
      <image id="photo" xlink:href="images/photo.svg?v=2#view"></image>
      <use id="local" xlink:href="#local-check"></use>
      <use id="external" xlink:href="https://example.test/icons.svg#check"></use>
      <use id="missing" xlink:href="missing.svg#check"></use>
    </svg></body></html>`;
    const sprite = '<svg xmlns="http://www.w3.org/2000/svg"><symbol id="check" viewBox="0 0 24 24"><path d="M2 12 9 19 22 3"/></symbol></svg>';
    const photo = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24"/></svg>';
    const zip = new ZipBuilder().file("site/index.html", html).file("site/icons/sprite.svg", sprite).file("site/images/photo.svg", photo);
    const imported = await readHtmlZip(await zip.toBytes());
    const dom = parse(imported.html);
    const spriteAsset = imported.assets.find(a => a.zip?.path === "site/icons/sprite.svg")!;
    const photoAsset = imported.assets.find(a => a.zip?.path === "site/images/photo.svg")!;
    const proxy = (path: string) => `/api/assets/file?path=${encodeURIComponent(path)}`;
    assert.equal(dom.querySelector("#namespaced").getAttribute("xlink:href"), proxy(spriteAsset.path!) + "#check");
    assert.equal(dom.querySelector("#modern").getAttribute("href"), proxy(spriteAsset.path!) + "#check");
    assert.equal(dom.querySelector("#photo").getAttribute("xlink:href"), proxy(photoAsset.path!) + "&v=2#view");
    for (const [id, value] of [["local", "#local-check"], ["external", "https://example.test/icons.svg#check"], ["missing", "missing.svg#check"]]) {
      assert.equal(dom.querySelector(`#${id}`).getAttribute("xlink:href"), value);
    }
    const doc = createInitialDoc();
    doc.assets = Object.fromEntries(imported.assets.map(a => [a.id, a]));
    doc.pages[doc.pageOrder[0]].rawHtml = imported.html;
    const output = generateProject(doc);
    const route = output.files["app/route.ts"];
    const exported = parse(JSON.parse(/^const html = (.*);$/m.exec(route)![1]));
    const exportedPath = (source: string) => Object.entries(output.remoteAssets)
      .find(([, original]) => original === source)![0].replace(/^public/, "");
    assert.equal(exported.querySelector("#namespaced").getAttribute("xlink:href"), exportedPath(spriteAsset.path!) + "#check");
    assert.equal(exported.querySelector("#modern").getAttribute("href"), exportedPath(spriteAsset.path!) + "#check");
    assert.equal(exported.querySelector("#photo").getAttribute("xlink:href"), exportedPath(photoAsset.path!) + "?v=2#view");
    assert.equal(exported.querySelector("#local").getAttribute("xlink:href"), "#local-check");

  } finally {
    for (const key of ["DOMParser", "Image", "fetch"]) {
      if (originals[key]) Object.defineProperty(globalThis, key, originals[key]);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
});
