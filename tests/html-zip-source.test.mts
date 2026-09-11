import assert from "node:assert/strict";
import { test } from "node:test";
import { htmlZipSource, rewriteHtmlZipSource } from "../lib/html-zip-source";
import type { Asset, HtmlZipPage } from "../lib/types";

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
