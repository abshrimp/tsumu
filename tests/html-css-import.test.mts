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
