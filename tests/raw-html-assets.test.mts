import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { transformSync } from "esbuild";
import { assetSrc } from "../lib/assets";
import { cssAssetReferences } from "../lib/css-assets";
import { generateProject } from "../lib/generator";
import { cssValue } from "../lib/generator/css";
import { applyPagePayload, buildPagePayload } from "../lib/page-transfer";
import type { Asset, SiteDoc } from "../lib/types";

const { parse } = createRequire(import.meta.url)("next/dist/compiled/node-html-parser");
const asset: Asset = { id: "hero", name: "hero.svg", path: "assets/hero.svg", width: 7, height: 5, mimeType: "image/svg+xml" };
const source = assetSrc(asset);
const target = "/assets/hero.svg";
const names = new Map([[asset.id, "hero.svg"]]);
const fixture = (html: string, item = asset): SiteDoc => ({
  siteName: "HTML assets", nodes: {}, assets: { [item.id]: item }, pageOrder: ["p"],
  pages: { p: { id: "p", name: "Home", slug: "", title: "", description: "", children: [], rawHtml: html } },
});
const rewrite = (html: string) => cssValue(fixture(html), "rawHtml", html, names);
const inline = (url: string, quote = "&quot;") => `<div style="background-image:url(${quote}${url}${quote})"></div>`;
const urls = (html: string) => cssAssetReferences(parse(html).querySelector("div").getAttribute("style")).map((ref) => ref.url);

test("HTML asset export preserves serialized CSS quotes without introducing a query", () => {
  for (const quote of ["&quot;", "&QUOT;", "&#34;", "&#x22;", "&#X00022;", "&apos;", "&#39;", "&#x27;"]) {
    const output = rewrite(inline(source, quote));
    assert.equal(output, inline(target, quote), quote);
    assert.deepEqual(urls(output), [target], quote);
    const set = `<div style="background-image:image-set(${quote}${source}${quote} 1x)"></div>`;
    assert.equal(rewrite(set), set.replace(source, target));
    assert.deepEqual(urls(rewrite(set)), [target]);
  }
});

test("HTML asset export leaves adjacent character references and unrelated markup intact", () => {
  for (const entity of ["&lt;", "&gt;", "&Tab;", "&NewLine;", "&#32;", "&#xA;", "&#x260;", "&#380;", "&#00034", "&#X22", "&quot", "&QUOT"]) {
    const html = `<!-- keep -->\n<div data-note='&quot;untouched&quot;' style="background:url(&quot;${source}${entity})"></div>\n<script>window.literal = '&lt;keep&gt;';</script>`;
    assert.equal(rewrite(html), html.replace(source, target), entity);
  }
});

test("HTML asset export converts real query separators and retains the remaining query and fragment bytes", () => {
  for (const separator of ["&", "&amp;", "&AMP;", "&#38;", "&#00038;", "&#x26;", "&#X0026;", "&#38", "&#x26"]) {
    const suffix = "v=1&amp;theme=dark#paint";
    assert.equal(rewrite(inline(source + separator + suffix)), inline(target + "?" + suffix), separator);
    assert.deepEqual(urls(rewrite(inline(source + separator + suffix))), [target + "?v=1&theme=dark#paint"], separator);
  }
  for (const query of ["download", "unknown;", "unknown;=1", "Quot;", "quot=1", "amp=1", "copy=1", "ampersand=1", "v=1&other=2", "amp;quot;", "#paint"]) {
    const suffix = query.startsWith("amp;") ? query.slice(4) : query;
    assert.equal(rewrite(inline(source + "&" + query)), inline(target + "?" + suffix), query);
  }
});

test("HTML asset export preserves literal quote styles, fragments, embedded assets and multiple occurrences", () => {
  for (const quote of ["", "'", "&quot;"]) {
    for (const suffix of ["", "#paint", "#paint&part"]) {
      const html = inline(source + suffix, quote);
      assert.equal(rewrite(html), inline(target + suffix, quote));
    }
  }
  const html = `<style>.hero { background: url("${source}"); }</style>\n${inline(source)}${inline(source + "&amp;v=1")}`;
  assert.equal(rewrite(html), `<style>.hero { background: url("${target}"); }</style>\n${inline(target)}${inline(target + "?v=1")}`);
  const local = { ...asset, path: undefined, dataUrl: "data:image/svg+xml;base64,PHN2Zy8+" };
  assert.equal(cssValue(fixture(inline(assetSrc(local)), local), "rawHtml", inline(assetSrc(local)), names), inline(target));
});

test("raw-text and comment query flags keep their existing export behavior", () => {
  for (const tag of ["style", "script", "xmp", "iframe", "noembed", "noframes"]) {
    const html = `<${tag}>url("${source}&quot;");url('${source}&unknown;')</${tag}>`;
    const expected = `<${tag}>url("${target}?quot;");url('${target}?unknown;')</${tag}>`;
    assert.equal(rewrite(html), expected, tag);
  }
  assert.equal(rewrite(`<!-- ${source}&quot; -->`), `<!-- ${target}?quot; -->`);
});

test("raw-text boundaries respect quote entities in tag attributes and RCDATA", () => {
  for (const tag of ["style", "script", "xmp", "iframe", "noembed", "noframes"]) {
    const html = `<${tag} data-example="<style> &quot;${source}&quot; >">url("${source}&quot;");url('${source}&unknown;')</${tag}>${inline(source)}`;
    const expected = `<${tag} data-example="<style> &quot;${target}&quot; >">url("${target}?quot;");url('${target}?unknown;')</${tag}>${inline(target)}`;
    assert.equal(rewrite(html), expected, tag);
  }
  assert.equal(rewrite(`<!-- ${source}&quot; -->${inline(source)}`), `<!-- ${target}?quot; -->${inline(target)}`);
  assert.equal(rewrite(`<div data-note='<style>url("${source}&quot;)</style>'></div>`), `<div data-note='<style>url("${target}&quot;)</style>'></div>`);
  for (const tag of ["title", "textarea"]) {
    assert.equal(rewrite(`<${tag}><style>&quot;${source}&quot;</style></${tag}>`), `<${tag}><style>&quot;${target}&quot;</style></${tag}>`);
  }
});

test("custom elements with raw-text tag prefixes do not consume ordinary markup", () => {
  for (const tag of ["style-card", "script-widget", "xmp-view", "iframe-panel", "noembed-card", "noframes-card", "title-card", "textarea-widget", "style:card", "script.widget"]) {
    const html = `<${tag} data-label="Keep > this">${inline(source)}</${tag}>${inline(source)}`;
    const expected = `<${tag} data-label="Keep > this">${inline(target)}</${tag}>${inline(target)}`;
    assert.equal(rewrite(html), expected, tag);
  }
  const html = `<style-card><script>window.image = "${source}&quot;";</script>${inline(source)}</style-card><style>.hero { background:url("${source}&quot;"); }</style>${inline(source)}`;
  const expected = `<style-card><script>window.image = "${target}?quot;";</script>${inline(target)}</style-card><style>.hero { background:url("${target}?quot;"); }</style>${inline(target)}`;
  assert.equal(rewrite(html), expected);
});

test("custom elements with RCDATA tag prefixes still contain real raw-text elements", () => {
  for (const tag of ["title-card", "textarea-widget"]) {
    const html = `<${tag}><style>.hero { background:url("${source}&quot;"); }</style></${tag}>${inline(source)}`;
    const expected = `<${tag}><style>.hero { background:url("${target}?quot;"); }</style></${tag}>${inline(target)}`;
    assert.equal(rewrite(html), expected, tag);
  }
});

test("generated and copied HTML routes retain usable quoted assets without changing the stored HTML", async () => {
  const html = `<!doctype html><html><head><title>Keep &amp; preserve</title></head><body>${inline(source)}</body></html>`;
  const original = fixture(html);
  const before = structuredClone(original);
  const copied = fixture("");
  copied.assets = {};
  copied.pages = {};
  copied.pageOrder = [];
  applyPagePayload(copied, buildPagePayload(original, ["p"]));
  for (const doc of [original, copied]) {
    const project = generateProject(doc);
    const routePath = "app/route.ts";
    const route = project.files[routePath];
    assert.ok(route, `missing ${routePath}`);
    const code = transformSync(route, { loader: "ts", format: "cjs" }).code;
    const mod = { exports: {} as { GET: () => Response } };
    new Function("module", "exports", code)(mod, mod.exports);
    const exported = await mod.exports.GET().text();
    assert.ok(exported.includes(inline(target)));
    assert.deepEqual(urls(exported), [target]);
    assert.equal(project.remoteAssets["public/assets/hero.svg"], asset.path);
  }
  assert.deepEqual(original, before);
});
