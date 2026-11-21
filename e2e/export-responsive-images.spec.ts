import { expect, test } from "@playwright/test";
import { resolve } from "node:path";
import { prepareExportProject } from "../lib/export-formats";
import type { SiteDoc } from "../lib/types";
import { build } from "../tests/helpers/bundle";

const svg = (width: number) => '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="20"><rect width="100%" height="20"/></svg>';
const markup = '<meta name="viewport" content="width=device-width"><img id="density" alt="Gallery" src="fallback.svg" srcset="small.svg 1x, large.svg 2x">' +
  '<img id="width" src="fallback.svg" srcset="small.svg 200w, large.svg 400w" sizes="(min-width: 600px) 400px, 200px">' +
  '<img id="only" srcset="large.svg 2x">' +
  '<img id="auto" src="fallback.svg" srcset="small.svg 200w, large.svg 400w" style="width:180px" width="180" height="20" loading="lazy" sizes="auto">' +
  '<picture><source media="(min-width: 600px)" srcset="large.svg"><img id="art" src="small.svg"></picture>';

test("editable responsive images retain native selection in nested archive pages and standalone HTML", async ({ browser, page }) => {
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
  const images = { fallback: svg(100), small: svg(200), large: svg(400) };
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
        const inline = markup.replace(/(fallback|small|large)\.svg/g, (_, name: keyof typeof images) =>
          "data:image/svg+xml;base64," + Buffer.from(images[name]).toString("base64"));
        await view.route("**/*", route => {
          const url = new URL(route.request().url());
          const file = url.pathname.slice(base.length);
          if (single && file === "reference.html") return route.fulfill({ contentType: "text/html", body: inline });
          if (url.origin === origin && url.pathname.startsWith(base)) {
            if (Object.hasOwn(out.files, file)) return route.fulfill({ contentType: file.endsWith(".css") ? "text/css" : file.endsWith(".js") ? "text/javascript" : "text/html", body: out.files[file] });
            if (Object.hasOwn(out.binaries, file)) return route.fulfill({ contentType: "image/svg+xml", body: Buffer.from(out.binaries[file], "base64") });
          }
          unexpected.push(url.href);
          return route.abort();
        });
        // Browsers may prefer a higher-resolution candidate when all bytes are already inline.
        // Compare the standalone export with the same authored markup and embedded images.
        let reference: Record<string, string> = {};
        if (single) {
          await view.goto(origin + base + "reference.html");
          await view.locator("img").evaluateAll(els => Promise.all(els.map(el => (el as HTMLImageElement).decode())));
          reference = await view.locator("img").evaluateAll(els => Object.fromEntries(els.map(el => [el.id, (el as HTMLImageElement).currentSrc])));
        }
        await view.goto(origin + base + (single ? "index.html" : "photos/gallery/index.html"));
        for (const [selector, name] of [["#density", dpr === 2 ? "large" : "small"], ["#width", dpr === 2 || width >= 600 ? "large" : "small"], ["#only", "large"], ["#auto", dpr === 2 ? "large" : "small"], ["#art", width >= 600 ? "large" : "small"]] as const) {
          const expected = single ? reference[selector.slice(1)] : origin + base + "assets/" + name + ".svg";
          await expect(view.locator(selector), framework + " " + width + "px @" + dpr + "x").toHaveJSProperty("currentSrc", expected);
          expect(await view.locator(selector).evaluate(el => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
        }
        expect(unexpected).toEqual([]);
      } finally { await view.close(); }
    }
  }
});
