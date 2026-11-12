import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { rewriteSrcsetUrls } from "../lib/srcset";
import { resolveZipReference } from "../lib/zip-references";
import { rewriteZipReferences } from "../lib/html-zip";

const urls = new Map([
  ["photo,wide.png", "/assets/wide.png"], ["small.png", "/assets/small.png"],
  ["large.png", "/assets/large.png"], ["space\u00a0name.png", "/assets/nbsp.png"],
]);
const rewrite = (value: string) => rewriteSrcsetUrls(value, url => resolveZipReference(url, "index.html", urls));

test("srcset URLs retain internal commas and inline data while archive paths are rewritten", () => {
  const data = "data:image/svg+xml,%3Csvg%3E,%3C/svg%3E";
  assert.equal(rewrite(`${data} 1x, photo,wide.png 2x`), `${data} 1x, /assets/wide.png 2x`);
  assert.equal(rewrite("photo,wide.png 320w, large.png 640w"), "/assets/wide.png 320w, /assets/large.png 640w");
  assert.equal(rewrite("photo%2Cwide.png?rev=1#paint 2x"), "/assets/wide.png?rev=1#paint 2x");
});

test("srcset rewriting retains original whitespace, separators and descriptor text", () => {
  assert.equal(rewrite(" \t,small.png,\n large.png\t2x,  "), " \t,/assets/small.png,\n /assets/large.png\t2x,  ");
  assert.equal(rewrite("small.png 100w 50h,large.png 200w 100h"), "/assets/small.png 100w 50h,/assets/large.png 200w 100h");
  assert.equal(rewrite("small.png invalid(foo,bar) 2x, large.png 3x"), "/assets/small.png invalid(foo,bar) 2x, /assets/large.png 3x");
  assert.equal(rewrite("space\u00a0name.png 1x"), "/assets/nbsp.png 1x");
});

test("srcset rewriting does not reinterpret missing or external candidates", () => {
  for (const value of ["", " , \n,,", "data:image/png;base64,AAAA", "https://example.test/a,b.png 2x, missing.png 3x", "small.png,large.png", "small.png bad(unclosed,large.png 2x"]) {
    const expected = value.startsWith("small.png bad") ? value.replace("small.png", "/assets/small.png") : value;
    assert.equal(rewrite(value), expected);
  }
});

test("the HTML ZIP rewrite applies candidate parsing to img and source without changing data URLs", () => {
  const { parse } = createRequire(import.meta.url)("next/dist/compiled/node-html-parser");
  const previous = Object.getOwnPropertyDescriptor(globalThis, "DOMParser");
  // 実際のブラウザでの解析は、ネイティブの回帰テストで確かめる。この代わりの部品で、取り込みの処理を手元で動かす。
  Object.defineProperty(globalThis, "DOMParser", { configurable: true, value: class {
    parseFromString(html: string) {
      const root = parse(html);
      return { querySelectorAll: (selector: string) => root.querySelectorAll(selector), documentElement: root.querySelector("html") };
    }
  } });
  try {
    const value = "data:image/png;base64,AAAA 1x, photo,wide.png 2x";
    const output = rewriteZipReferences(`<html><body><picture><source srcset="${value}"><img srcset="${value}"></picture></body></html>`, "index.html", urls);
    const elements = parse(output.html).querySelectorAll("[srcset]");
    assert.equal(elements.length, 2);
    for (const element of elements) {
      assert.equal(element.getAttribute("srcset"), "data:image/png;base64,AAAA 1x, /assets/wide.png 2x");
    }
  } finally {
    if (previous) Object.defineProperty(globalThis, "DOMParser", previous);
    else Reflect.deleteProperty(globalThis, "DOMParser");
  }
});
