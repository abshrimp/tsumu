import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveZipReference, zipDependency } from "../lib/zip-references";
import { cssValue } from "../lib/generator/css";
import { createInitialDoc } from "../lib/presets";

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
  assert.equal(cssValue(doc, "backgroundImage", `url('${proxy}&v=1#icon')`, names), "url('/assets/logo.svg?v=1#icon')");
  assert.equal(cssValue(doc, "rawHtml", `<img src="${proxy}&amp;v=1&amp;theme=dark#icon">`, names), '<img src="/assets/logo.svg?v=1&amp;theme=dark#icon">');
  assert.equal(cssValue(doc, "rawHtml", `<img src="${proxy}#icon">`, names), '<img src="/assets/logo.svg#icon">');
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
  // An explicit asset at the archive root takes priority over the wrapper fallback.
  const both = new Map([["images/logo.svg", "at-root"], ["site/images/logo.svg", "wrapped"]]);
  assert.equal(resolveZipReference("/images/logo.svg", "site/index.html", both), "at-root");
  assert.equal(resolveZipReference("https://cdn.example/logo.svg", "site/index.html", resources), "https://cdn.example/logo.svg");
  assert.equal(resolveZipReference("/missing.svg", "site/index.html", resources), "/missing.svg");
});
