import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import { resolve } from "node:path";
import { generateExportProject } from "../lib/export-formats";
import type { SiteDoc } from "../lib/types";

const source = `<!doctype html><html><head>
  <script>window.importOrder = ["head"];</script>
</head><body>
  <noscript><section>
    <script>window.noscriptExecuted = true;</script>
    <style>body { --noscript-active: yes; }</style>
  </section></noscript>
  <math>
    <script>window.mathExecuted = true;</script>
    <style>body { --math-active: yes; }</style>
  </math>
  <svg xmlns="http://www.w3.org/2000/svg">
    <foreignObject><div xmlns="http://www.w3.org/1999/xhtml">
      <script>window.svgExecuted = true;</script>
      <style>body { --svg-active: yes; }</style>
    </div></foreignObject><rect width="10" height="10"/>
  </svg>
  <p id="visible">Visible content</p>
  <style>#visible { color: rgb(12, 34, 56); }</style>
  <script>window.importOrder.push("body");</script>
  <script type="module">window.importOrder.push("module");</script>
</body></html>`;

const bundle = build({
  stdin: {
    contents: `
      import JSZip from "jszip";
      import { readHtmlZip } from "./lib/html-zip";
      import { convertHtmlToSite } from "./lib/html-to-site";
      window.importFixture = async (source, archive) => {
        if (!archive) return convertHtmlToSite(source).doc;
        const zip = new JSZip().file("site/index.html", source);
        const imported = await readHtmlZip(await zip.generateAsync({ type: "uint8array" }));
        return convertHtmlToSite(imported.html, { assets: imported.assets }).doc;
      };`,
    resolveDir: resolve("."), loader: "ts", sourcefile: "html-import-code-boundaries-fixture.ts",
  },
  bundle: true, write: false, format: "iife", platform: "browser",
}).then(result => result.outputFiles[0].text);

for (const archive of [false, true]) {
  test(`${archive ? "ZIP" : "HTML"} import preserves inert code contexts and intentional published scripts`, async ({ page, context }) => {
    await page.addScriptTag({ content: await bundle });
    const doc: SiteDoc = await page.evaluate(async ({ source, archive }) =>
      (window as any).importFixture(source, archive), { source, archive });
    expect(await page.evaluate(() => [
      (window as any).importOrder, (window as any).noscriptExecuted,
      (window as any).mathExecuted, (window as any).svgExecuted,
    ])).toEqual([undefined, undefined, undefined, undefined]);
    const home = doc.pages[doc.pageOrder[0]];
    expect(home.customTopHtml || "").not.toMatch(/noscript-active|math-active|svg-active/);
    expect(home.customEndHtml || "").not.toMatch(/noscriptExecuted|mathExecuted|svgExecuted/);
    expect(Object.values(doc.nodes).some(node => node.code?.html?.includes("<noscript>"))).toBe(true);
    expect(Object.values(doc.nodes).some(node => node.code?.html?.includes("<math>"))).toBe(true);

    const published = await context.newPage();
    const { files } = generateExportProject(doc, "html");
    const origin = "http://tsumu-import.test";
    // Exercise the published project, including its generated stylesheets.
    // Loading only index.html while aborting resources hides all exported CSS.
    await published.route("**/*", route => {
      const url = new URL(route.request().url());
      const path = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
      if (url.origin !== origin || !Object.hasOwn(files, path)) return route.abort();
      const contentType = path.endsWith(".css") ? "text/css"
        : path.endsWith(".js") ? "text/javascript" : "text/html";
      return route.fulfill({ contentType, body: files[path] });
    });
    await published.goto(origin);
    await expect.poll(() => published.evaluate(() => (window as any).importOrder))
      .toEqual(["head", "body", "module"]);
    expect(await published.evaluate(() => [
      (window as any).noscriptExecuted, (window as any).mathExecuted, (window as any).svgExecuted,
    ])).toEqual([undefined, undefined, undefined]);
    expect(await published.evaluate(() => {
      const style = getComputedStyle(document.body);
      return ["--noscript-active", "--math-active", "--svg-active"].map(name => style.getPropertyValue(name));
    })).toEqual(["", "", ""]);
    await expect(published.locator("#visible")).toHaveCSS("color", "rgb(12, 34, 56)");
    expect(await page.evaluate(() => (window as any).importOrder)).toBeUndefined();
    await published.close();
  });
}
