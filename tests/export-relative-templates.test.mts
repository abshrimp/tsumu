import assert from "node:assert/strict";
import test from "node:test";
import { generateExportProject } from "../lib/export-formats";
import { makeBox, makeImage } from "../lib/presets";
import type { SiteDoc } from "../lib/types";

function fixture(): SiteDoc {
  const link = { ...makeBox(), id: "download", link: { kind: "url" as const, url: "./files/{name}.pdf?lang={lang}#page" } };
  const image = { ...makeImage(), id: "poster" };
  image.image!.src = "../images/{poster}.svg?size=large#art";
  const nested = { ...makeBox(), id: "nested", link: { kind: "url" as const, url: "items/[slug]?view=list" } };
  return {
    siteName: "Relative templates",
    pages: {
      home: { id: "home", name: "Home", slug: "", title: "Home", description: "", children: [] },
      detail: { id: "detail", name: "Detail", slug: "guide/start", title: "Detail", description: "", children: ["download", "poster", "nested"] },
    },
    pageOrder: ["home", "detail"],
    nodes: { download: link, poster: image, nested },
    assets: {},
  };
}

test("HTML export rebases relative URLs with variables from the clean page URL", () => {
  const doc = fixture();
  const html = generateExportProject(doc, "html").files["guide/start/index.html"];
  const relativeLink = "../../guide/files/{name}.pdf?lang={lang}#page";
  const relativeImage = "../../images/{poster}.svg?size=large#art";
  assert.ok(html.includes('href="' + relativeLink + '"'), "link destination must use the original clean-page base");
  assert.ok(html.includes('data-live-href="' + relativeLink + '"'), "client-side URL interpolation must use the same base");
  assert.ok(html.includes('data-live-src="' + relativeImage + '"'), "live image source must use the original clean-page base");
  assert.ok(html.includes('href="../../guide/items/[slug]?view=list"'), "[slug] also remains a template token");
  const base = "https://example.test/portfolio/guide/start/index.html";
  assert.equal(new URL(relativeLink.replace("{name}", "manual").replace("{lang}", "ja"), base).href,
    "https://example.test/portfolio/guide/files/manual.pdf?lang=ja#page");
  assert.equal(new URL(relativeImage.replace("{poster}", "cover"), base).href,
    "https://example.test/portfolio/images/cover.svg?size=large#art");
});

test("HTML export retains leading URL variables and explicit base elements", () => {
  const doc = fixture();
  doc.nodes.download.link!.url = "{destination}?ref={tag}";
  let html = generateExportProject(doc, "html").files["guide/start/index.html"];
  assert.ok(html.includes('href="{destination}?ref={tag}"'), "a leading variable may be an absolute URL");

  doc.nodes.download.link!.url = "./files/{name}.pdf?lang={lang}#page";
  doc.customHeadHtml = '<base href="https://cdn.example.test/manual/">';
  html = generateExportProject(doc, "html").files["guide/start/index.html"];
  assert.ok(html.includes('href="./files/{name}.pdf?lang={lang}#page"'));
  assert.ok(html.includes('data-live-src="../images/{poster}.svg?size=large#art"'));
});

test("HTML export cannot confuse an authored marker-like URL segment with its placeholders", () => {
  const doc = fixture();
  doc.nodes.download.link!.url = "./tsumu-export-variable-0-end/{name}.pdf";
  const html = generateExportProject(doc, "html").files["guide/start/index.html"];
  assert.ok(html.includes('href="../../guide/tsumu-export-variable-0-end/{name}.pdf"'));
});
