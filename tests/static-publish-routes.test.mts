import assert from "node:assert/strict";
import { test } from "node:test";
import { htmlResourceElements } from "../lib/html-zip-source";
import { runChecks } from "../lib/generator/checks";
import { exportHomeRequirement } from "../lib/generator/export-options";
import { generateExportProject } from "../lib/export-formats";
import { buildStaticPublishZip } from "../lib/static-publish-zip";
import { ZipArchive } from "../lib/zip";
import type { SiteDoc } from "../lib/types";

const page = { id: "home", name: "Campaign", title: "Campaign", description: "", children: [], slug: "news/winter" };
const site: SiteDoc = { siteName: "Campaign site", pages: { home: page }, pageOrder: ["home"], nodes: {}, assets: {} };
const publish = async (doc: SiteDoc) => ZipArchive.open(await (await buildStaticPublishZip(doc, "production")).arrayBuffer());

test("direct static publishing keeps a single page at its configured public URL", async () => {
  const zip = await publish(site);
  const route = zip.file("news/winter/index.html");
  assert.ok(route);
  assert.match(await route.text(), /<title>Campaign<\/title>/);
  assert.ok(zip.file("index.html"));
  const portable = generateExportProject(site, "html");
  assert.match(portable.files["index.html"], /<title>Campaign<\/title>/);
});

test("a host serving 404.html at a deep missing URL can load the site's resources", async () => {
  const missing = { ...page, id: "missing", slug: "404" };
  const doc = { ...site, pageOrder: ["home", "missing"], pages: { home: page, missing } };
  const zip = await publish(doc);
  const html = await zip.file("404.html")!.text();
  const { elements, baseElement } = htmlResourceElements(html);
  const missingUrl = "https://host.test/catalog/expired/item";
  const base = new URL(baseElement?.attrs.find(a => a.name === "href")?.value ?? "", missingUrl);
  const urls = elements.flatMap(el => el.attrs.filter(a =>
    (el.tagName === "script" && a.name === "src") || (el.tagName === "link" && a.name === "href"))
    .map(a => new URL(a.value, base)));
  assert.ok(urls.some(url => url.pathname === "/styles/site.css"));
  assert.ok(urls.some(url => url.pathname === "/scripts.js"));
  for (const url of urls) assert.ok(zip.file(url.pathname.slice(1)), url.href);
});

test("a site with only a custom 404 still supplies the host's 404.html", async () => {
  const zip = await publish({ ...site, pages: { home: { ...page, slug: "404" } } });
  assert.ok(zip.file("404.html"));
});

test("entry redirects choose a content page when the custom 404 is first", async () => {
  const doc = { ...site, pageOrder: ["missing", "home"], pages: { ...site.pages, missing: { ...page, id: "missing", slug: "404" } } };
  const html = await (await publish(doc)).file("index.html")!.text();
  assert.match(html, /href="\.\/news\/winter\/index\.html"/);
});

test("imported 404 pages resolve an authored base from the canonical document path", async () => {
  for (const [source, expected] of [
    ['<base href="media/">', "https://host.test/media/"],
    ['<base href="https://cdn.example/media/">', "https://cdn.example/media/"],
  ]) {
    const missing = { ...page, id: "missing", slug: "404", rawHtml: '<!doctype html><html><head>' + source + '</head><body><img src="logo.png"></body></html>' };
    const zip = await publish({ ...site, pages: { home: page, missing }, pageOrder: ["home", "missing"] });
    const html = await zip.file("404.html")!.text();
    const { baseElement } = htmlResourceElements(html);
    const value = baseElement?.attrs.find(attribute => attribute.name === "href")?.value;
    assert.ok(value);
    assert.equal(new URL(value, "https://host.test/missing/deep/page").href, expected);
  }
});

test("raw 404 resources use the site root while fragment links retain the requested URL", async () => {
  const rawHtml = '<!doctype html><head><base target="_self"></head><a href="#help">Help</a><img src="img/logo.png">';
  const doc = { ...site, pages: { home: { ...page, slug: "404", rawHtml } } };
  const html = await (await publish(doc)).file("404.html")!.text();
  assert.match(html, /src="\/img\/logo.png"/);
  assert.match(html, /href="#help"/);
  assert.equal(htmlResourceElements(html).baseElement, undefined);
});

test("static export checks allow a generated home while still respecting unpublished pages", () => {
  const settings = { requireHomePage: exportHomeRequirement("html", "project") };
  const draftErrors = (doc: SiteDoc) => runChecks(doc, settings).filter(check => check.help === "page-draft" && check.level === "error");
  assert.equal(draftErrors(site).length, 0);
  const draft = { ...page, id: "draft", slug: "", unpublished: true };
  assert.equal(draftErrors({ ...site, pages: { home: page, draft }, pageOrder: ["home", "draft"] }).length, 1);
  assert.equal(draftErrors({ ...site, pages: { draft }, pageOrder: ["draft"] }).length, 1);
  assert.equal(exportHomeRequirement("nextjs", "project"), true);
});

test("direct publishing cannot replace a deployment with an empty site", async () => {
  const doc = { ...site, pages: { home: { ...page, unpublished: true } } };
  await assert.rejects(buildStaticPublishZip(doc, "production"), /No pages to publish/);
});
