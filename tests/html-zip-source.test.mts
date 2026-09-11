import assert from "node:assert/strict";
import { test } from "node:test";
import { htmlZipSource, rewriteHtmlZipSource } from "../lib/html-zip-source";
import type { Asset, HtmlZipPage, SiteDoc } from "../lib/types";
import { generateProject } from "../lib/generator";
import { generateExportProject } from "../lib/export-formats";

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
