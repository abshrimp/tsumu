import { expect, test } from "@playwright/test";
import JSZip from "jszip";
import { htmlImportBundle } from "../tests/helpers/html-import";

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
      const archive = new JSZip();
      archive.file("index.html", '<html><head><link rel="stylesheet" href="style.css"></head><body>Imported</body></html>');
      archive.file("style.css", "p{color:red}");
      await page.locator('input[accept=".zip,application/zip"]').setInputFiles({ name: "site.zip", mimeType: "application/zip", buffer: await archive.generateAsync({ type: "nodebuffer" }) });
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
      await page.waitForTimeout(100);
      expect(await page.evaluate(() => (window as any).htmlEditor.getState().doc.pages.p.rawHtml)).toBe("<p>Original</p>");
      await page.locator('.color-pop input[type="range"]').dispatchEvent("pointerup");
    }
    if (zip) await expect.poll(() => page.evaluate(() => Object.keys((window as any).htmlEditor.getState().doc.assets).length)).toBe(1);
    else await page.waitForTimeout(100);
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
