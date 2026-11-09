import assert from "node:assert/strict";
import { test } from "node:test";
import type { Asset } from "../lib/types";
import { expandZipCss } from "../lib/html-css-import";

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
  const mobile = css("mobile", "css/mobile.css",
    ".card { gap: 4px; }");
  const base = css("base", "css/base.css",
    '@import url("mobile.css") screen and (max-width: 768px); .card { background-image: url("../images/icon.svg#mark"); }',
    [{ url: "mobile.css", assetId: "mobile", suffix: "" },
     { url: "../images/icon.svg#mark", assetId: "image", suffix: "#mark" }]);
  const main = css("main", "css/main.css",
    '@import "./base.css"; .card { display: grid; }',
    [{ url: "./base.css", assetId: "base", suffix: "" }]);
  const warnings: string[] = [];
  const resolved = expandZipCss(main.zip!.stylesheet!.source, [main, base, mobile, image],
    (msg) => warnings.push(msg), main);
  assert.match(resolved.css, /@media screen and \(max-width: 768px\)/);
  assert.match(resolved.css, /gap: 4px/);
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

test("bare CSS @import layer modifiers are not mistaken for media queries", () => {
  const theme = css("theme", "css/theme.css", ".card { color: red; }");
  const main = css("main", "css/main.css", '@import "theme.css" layer; .card { display: grid; }',
    [{ url: "theme.css", assetId: "theme", suffix: "" }]);
  const warnings: string[] = [];
  const result = expandZipCss(main.zip!.stylesheet!.source, [main, theme],
    message => warnings.push(message), main);
  assert.deepEqual(result.unresolved, ['@import "theme.css" layer;']);
  assert.ok(!result.css.includes("@media layer"));
  assert.match(result.css, /display: grid/);
  assert.equal(warnings.length, 1);
});
