import { expect, test } from "@playwright/test";
import { resolve } from "node:path";
import { prepareExportProject } from "../lib/export-formats";
import type { SiteDoc } from "../lib/types";
import { build } from "../tests/helpers/bundle";

// Keep each element's candidates distinct. A browser may reuse a decoded high-density image
// for another element even when its preferred candidate would otherwise be smaller.
const images = Object.fromEntries(Object.entries({
  fallback: 100, "density-small": 200, "density-large": 400, "width-small": 200, "width-large": 400,
  "only-large": 400, "auto-small": 200, "auto-large": 400, "art-small": 200, "art-large": 400,
}).map(([name, width]) => [name,
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="20"><title>${name}</title><rect width="100%" height="20"/></svg>`]));
const markup = '<meta name="viewport" content="width=device-width"><img id="density" alt="Gallery" src="fallback.svg" srcset="density-small.svg 1x, density-large.svg 2x">' +
  '<img id="width" src="fallback.svg" srcset="width-small.svg 200w, width-large.svg 400w" sizes="(min-width: 600px) 400px, 200px">' +
  '<img id="only" srcset="only-large.svg 2x">' +
  '<img id="auto" src="fallback.svg" srcset="auto-small.svg 200w, auto-large.svg 400w" style="width:180px" width="180" height="20" loading="lazy" sizes="auto">' +
  '<picture><source media="(min-width: 600px)" srcset="art-large.svg"><img id="art" src="art-small.svg"></picture>';

test("editable responsive images retain native selection in nested archive pages and standalone HTML @export-browser", async ({ browser, page }) => {
  const bundled = await build({ stdin: { contents: `
    import { readHtmlZip } from "./lib/html-zip";
    import { convertHtmlToSite } from "./lib/html-to-site";
    import { ZipBuilder } from "./lib/zip";
    window.convertGallery = async (markup, images) => {
      const zip = new ZipBuilder().file("index.html", markup);
      for (const [name, source] of Object.entries(images)) zip.file(name + ".svg", source);
      const imported = await readHtmlZip(await zip.toBytes());
      return convertHtmlToSite(imported.html, { assets: imported.assets }).doc;
    };`, resolveDir: resolve("."), loader: "ts" },
    bundle: true, format: "iife", platform: "browser", write: false });
  await page.route("https://editor.test/**", route => route.fulfill({ contentType: "text/html", body: "" }));
  await page.goto("https://editor.test/");
  await page.addScriptTag({ content: bundled.outputFiles[0].text });
  const doc: SiteDoc = await page.evaluate(async input => (window as any).convertGallery(input.markup, input.images), { markup, images });
  const gallery = doc.pages[doc.pageOrder[0]];
  expect(Object.values(doc.nodes).find(n => n.attrId === "density")?.type).toBe("image");
  gallery.slug = "photos/gallery";
  doc.pages.home = { ...gallery, id: "home", slug: "", children: [] };
  doc.pageOrder.unshift("home");
  for (const framework of ["html", "single-html"] as const) {
    const single = framework === "single-html";
    const out = await prepareExportProject(doc, { framework, scope: single ? "page" : "project", pageId: gallery.id, language: "javascript", style: "css" });
    for (const [width, dpr] of [[420, 1], [420, 2], [820, 1]]) {
      const origin = "https://gallery.test";
      const base = "/published/portfolio/";
      const view = await browser.newPage({ viewport: { width, height: 600 }, deviceScaleFactor: dpr });
      try {
        const unexpected: string[] = [];
        const inline = markup.replace(/([a-z-]+)\.svg/g, (_, name: string) =>
          "data:image/svg+xml;base64," + Buffer.from(images[name]).toString("base64"));
        await view.route("**/*", route => {
          const url = new URL(route.request().url());
          const file = url.pathname.slice(base.length);
          if (url.origin === origin && url.pathname === "/original/index.html") {
            return route.fulfill({ contentType: "text/html", body: single ? inline : markup });
          }
          if (url.origin === origin && url.pathname.startsWith("/original/") && url.pathname.endsWith(".svg")) {
            const name = url.pathname.slice("/original/".length, -4);
            if (Object.hasOwn(images, name)) return route.fulfill({ contentType: "image/svg+xml", body: images[name] });
          }
          if (url.origin === origin && url.pathname.startsWith(base)) {
            if (Object.hasOwn(out.files, file)) return route.fulfill({ contentType: file.endsWith(".css") ? "text/css" : file.endsWith(".js") ? "text/javascript" : "text/html", body: out.files[file] });
            if (Object.hasOwn(out.binaries, file)) return route.fulfill({ contentType: "image/svg+xml", body: Buffer.from(out.binaries[file], "base64") });
          }
          unexpected.push(url.href);
          return route.abort();
        });
        // Use the browser's own choice from the original HTML at this viewport and pixel density.
        // The reference and the archive use separate URLs, so they do not share a decoded network image.
        await view.goto(origin + "/original/index.html");
        const originals = view.locator("img");
        // WebKit can abort decode() while layout switches a lazy image to its sized candidate.
        await expect.poll(() => originals.evaluateAll(elements =>
          Promise.all(elements.map(el => (el as HTMLImageElement).decode())).then(() => true, () => false))).toBe(true);
        const reference = await originals.evaluateAll(elements =>
          Object.fromEntries(elements.map(el => [el.id, (el as HTMLImageElement).currentSrc])));
        expect(Object.keys(reference)).toEqual(["density", "width", "only", "auto", "art"]);
        await view.goto(origin + base + (single ? "index.html" : "photos/gallery/index.html"));
        await expect(view.locator("#auto")).toHaveCSS("width", "180px");
        await expect(view.locator("#auto")).toHaveAttribute("sizes", "auto");
        await expect(view.locator("#auto")).toHaveAttribute("loading", "lazy");
        for (const [id, source] of Object.entries(reference)) {
          const selector = "#" + id;
          const expected = single ? source : origin + base + "assets/" + new URL(source).pathname.slice("/original/".length);
          await expect(view.locator(selector), framework + " " + width + "px @" + dpr + "x").toHaveJSProperty("currentSrc", expected);
          expect(await view.locator(selector).evaluate(el => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
        }
        expect(unexpected).toEqual([]);
      } finally { await view.close(); }
    }
  }
});
