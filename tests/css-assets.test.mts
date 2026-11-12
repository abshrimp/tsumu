import assert from "node:assert/strict";
import { test } from "node:test";
import { cssUsesAssetUrl, replaceCssAssetUrls } from "../lib/css-assets";
import { replaceEmbeddedAsset } from "../lib/assets";
import { cssValue } from "../lib/generator/css";
import { makeBox } from "../lib/presets";
import type { SiteDoc } from "../lib/types";

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
  const original = node.styles.base.default.backgroundImage;
  assert.equal(cssValue(doc, 'backgroundImage', original, new Map([['a', 'logo.svg']])), `url(${data}BBBB), image-set("${target}" 1x)`);
  replaceEmbeddedAsset(doc, 'a', 'assets/logo.svg');
  assert.equal(node.styles.base.default.backgroundImage, `url(${data}BBBB), image-set("${source}" 1x)`);
  assert.equal(node.styles.base.default.content, `"${data}"`);
  assert.equal(cssValue(doc, 'backgroundImage', `url(${source}.backup), url(${source}#mark)`, new Map([['a', 'logo.svg']])), `url(${source}.backup), url(${target}#mark)`);
});

test("export preserves imported ZIP queries without replacing longer CSS URLs or ordinary strings", () => {
  const doc = { assets: {
    a: { id: 'a', name: 'logo.svg', path: 'assets/logo.svg', width: 1, height: 1 },
  } } as unknown as SiteDoc;
  const names = new Map([['a', 'logo.svg']]);
  const value = `image-set("${source}&v=1&theme=dark#mark" 1x), url('${source}.backup&v=2'), url(${source}#icon&part)`;
  assert.equal(cssValue(doc, 'backgroundImage', value, names),
    `image-set("${target}?v=1&theme=dark#mark" 1x), url('${source}.backup&v=2'), url(${target}#icon&part)`);
  assert.equal(cssValue(doc, 'content', `"${source}&v=1"`, names), `"${source}&v=1"`);
  assert.equal(cssValue(doc, 'backgroundImage', `url('${source}&amp;v=1&amp;theme=dark#mark')`, names),
    `url('${target}?v=1&amp;theme=dark#mark')`);
  // 書き出しでのクエリの変換を、使用箇所の判定や削除にまで広げない。
  assert.equal(cssUsesAssetUrl(`url('${source}&v=1')`, source), false);
});
