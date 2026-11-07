import { test, expect } from "@playwright/test";
import { ZipBuilder } from "../lib/zip";
import { htmlImportBundle } from "../tests/helpers/html-import";
import { build } from "../tests/helpers/bundle";
import { resolve as resolve_2 } from "node:path";
import { generateExportProject } from "../lib/export-formats";
import { type SiteDoc } from "../lib/types";

test.describe("html-import-lifecycle", () => {
let bundle: string;
test.beforeAll(async () => { bundle = await htmlImportBundle(); });
test.beforeEach(async ({ page }) => {
  await page.route("**/api/**", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user: null, path: "assets/import.css" }) }));
  await page.goto("/robots.txt");
  await page.setContent('<div id="app"></div>');
  await page.evaluate(() => {
    const read = FileReader.prototype.readAsText;
    (window as any).htmlReads = [];
    FileReader.prototype.readAsText = function (file, encoding) {
      (window as any).htmlReads.push(() => read.call(this, file, encoding));
    };
  });
  await page.addScriptTag({ content: bundle });
  await expect(page.locator('textarea[rows="14"]')).toBeVisible();
});

test("empty HTML files preserve the existing source, ZIP association and undo history", async ({ page }) => {
  await page.evaluate(() => (window as any).htmlEditor.getState().updatePage("p", {
    htmlZip: { path: "site/index.html", assetIds: [] },
  }));
  const snapshot = () => page.evaluate(() => {
    const state = (window as any).htmlEditor.getState();
    return { page: state.doc.pages.p, past: state.past.length, future: state.future.length };
  });
  const before = await snapshot();
  for (const contents of ["", "  \n\t"]) {
    await page.locator('input[accept=".html,.htm,text/html"]').setInputFiles({
      name: "empty.html", mimeType: "text/html", buffer: Buffer.from(contents),
    });
    await page.evaluate(() => (window as any).htmlReads.shift()());
    await expect(page.getByRole("status")).toContainText("ファイルが空です");
    expect(await snapshot()).toEqual(before);
  }
});

for (const zip of [false, true]) for (const interruption of ["edit", "kind", "undo", "page", "unmount", "success", "gesture"]) {
  test(`Slow ${zip ? "ZIP" : "HTML"} import handles ${interruption}`, async ({ page }) => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let uploading = false;
    if (zip) await page.route("**/api/assets", async route => {
      uploading = true; await gate;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ path: "assets/import.css" }) });
    });
    await page.evaluate(() => (window as any).htmlEditor.getState().updatePage("p", { title: "Undo this" }));
    if (zip) {
      const archive = new ZipBuilder();
      archive.file("index.html", '<html><head><link rel="stylesheet" href="style.css"></head><body>Imported</body></html>');
      archive.file("style.css", "p{color:red}");
      await page.locator('input[accept=".zip,application/zip"]').setInputFiles({ name: "site.zip", mimeType: "application/zip", buffer: Buffer.from(await archive.toBytes()) });
      await expect.poll(() => uploading).toBe(true);
    } else {
      await page.locator('input[accept=".html,.htm,text/html"]').setInputFiles({ name: "index.html", mimeType: "text/html", buffer: Buffer.from("<p>Imported</p>") });
      await expect.poll(() => page.evaluate(() => (window as any).htmlReads.length)).toBe(1);
    }
    if (interruption === "edit") { await page.locator('textarea[rows="14"]').fill("<p>Newer edit</p>"); await page.locator('textarea[rows="14"]').blur(); }
    if (interruption === "kind") await page.getByRole("button", { name: "通常", exact: true }).click();
    if (interruption === "undo") await page.evaluate(() => (window as any).htmlEditor.getState().undo());
    if (interruption === "page") await page.evaluate(() => (window as any).htmlEditor.getState().setActivePage("q"));
    if (interruption === "unmount") await page.evaluate(() => (window as any).unmountHtmlEditor());
    if (interruption === "gesture") {
      await page.locator(".color-swatch").first().click();
      await page.locator('.color-pop input[type="range"]').evaluate(input => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "80");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      expect(await page.evaluate(() => (window as any).htmlEditor.getState().gestureActive)).toBe(true);
    }
    const before = await page.evaluate(() => { const s = (window as any).htmlEditor.getState(); return { doc: s.doc, past: s.past.length, future: s.future.length }; });
    if (zip) release(); else await page.evaluate(() => (window as any).htmlReads[0]());
    if (interruption === "gesture") {
      await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 25)));
      expect(await page.evaluate(() => (window as any).htmlEditor.getState().doc.pages.p.rawHtml)).toBe("<p>Original</p>");
      await page.locator('.color-pop input[type="range"]').dispatchEvent("pointerup");
    }
    if (zip) await expect.poll(() => page.evaluate(() => Object.keys((window as any).htmlEditor.getState().doc.assets).length)).toBe(1);
    else if (interruption === "success" || interruption === "gesture") {
      await expect.poll(() => page.evaluate(() => (window as any).htmlEditor.getState().doc.pages.p.rawHtml)).toContain("Imported");
    } else {
      await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 25)));
    }
    const after = await page.evaluate(() => { const s = (window as any).htmlEditor.getState(); return { doc: s.doc, past: s.past.length, future: s.future.length }; });
    if (interruption === "success" || interruption === "gesture") {
      expect(after.doc.pages.p.rawHtml).toContain("Imported");
      await page.evaluate(() => (window as any).htmlEditor.getState().undo());
      expect(await page.evaluate(() => (window as any).htmlEditor.getState().doc)).toEqual(before.doc);
      await page.evaluate(() => (window as any).htmlEditor.getState().redo());
      expect(await page.evaluate(() => (window as any).htmlEditor.getState().doc)).toEqual(after.doc);
    } else {
      expect({ ...after.doc, assets: before.doc.assets }).toEqual(before.doc);
      expect(after.past).toBe(before.past); expect(after.future).toBe(before.future);
      if (interruption === "page") await expect(page.getByRole("status")).toHaveCount(0);
    }
  });
}
});

test.describe("html-import-code-boundaries", () => {
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

let bundle: string;
test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `
      import { ZipBuilder } from "./lib/zip";
      import { readHtmlZip } from "./lib/html-zip";
      import { convertHtmlToSite } from "./lib/html-to-site";
      window.importFixture = async (source, archive) => {
        if (!archive) return convertHtmlToSite(source).doc;
        const zip = new ZipBuilder().file("site/index.html", source);
        const imported = await readHtmlZip(await zip.toBytes());
        return convertHtmlToSite(imported.html, { assets: imported.assets }).doc;
      };`,
      resolveDir: resolve_2("."), loader: "ts", sourcefile: "html-import-code-boundaries-fixture.ts",
    },
    bundle: true, write: false, format: "iife", platform: "browser",
  });
  bundle = result.outputFiles[0].text;
});

for (const archive of [false, true]) {
  test(`${archive ? "ZIP" : "HTML"} import preserves inert code contexts and intentional published scripts`, async ({ page, context }) => {
    await page.addScriptTag({ content: bundle });
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
    // 生成したスタイルシートを含め、公開したプロジェクトを通して動かす。
    // index.html だけを読み込み、他のリソースを中断すると、書き出した CSS がすべて隠れてしまう。
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
});
