import { expect, test } from "@playwright/test";
import { createInitialDoc } from "../lib/presets";
import { emptyDest } from "../lib/site";
import { copySiteStorageBundle } from "../tests/helpers/copy-site-storage";
import { browserDoc, setBrowserDoc } from "./helpers/browser-doc";

let bundle: string;
test.beforeAll(async () => { bundle = await copySiteStorageBundle(); });

for (const failure of ["read", "json", "shape", "breakpoints"] as const) {
  test(`copy dialog preserves an unreadable ${failure} IndexedDB document and allows retry`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("http://tsumu-copy.test/**", route => {
      if (new URL(route.request().url()).pathname === "/api/sites") return route.fulfill({ status: 503, json: {} });
      return route.fulfill({ contentType: "text/html", body: '<html><body><div id="app"></div></body></html>' });
    });
    await page.goto("http://tsumu-copy.test/sites/source");
    const doc = createInitialDoc();
    doc.siteName = "Keep this title";
    doc.customHeadHtml = "<!-- Destination content -->";
    const good = JSON.stringify(doc);
    const bad = failure === "breakpoints"
      ? JSON.stringify({ ...doc, breakpoints: [{ id: "custom", label: "Custom", maxWidth: 800 }] })
      : failure === "json" ? '{"siteName":"recoverable"'
      : failure === "shape" ? JSON.stringify({ ...doc, pageOrder: [] }) : good;
    await page.evaluate(site => {
      localStorage.setItem("tsumu-lang", "ja");
      localStorage.setItem("tsumu-sites-v1", JSON.stringify([site]));
    }, { ...emptyDest(), id: "destination", name: "Destination", createdAt: 1, updatedAt: 1 });
    await setBrowserDoc(page, "destination", bad);
    if (failure === "read") {
      await page.evaluate(() => {
        const state = window as any;
        state.failCopyRead = true;
        const get = IDBObjectStore.prototype.get;
        IDBObjectStore.prototype.get = function(key) {
          if (this.name === "documents" && key === "destination" && state.failCopyRead) {
            throw new DOMException("Read unavailable", "UnknownError");
          }
          return get.call(this, key);
        };
      });
    }
    await page.addScriptTag({ content: bundle });
    const button = page.locator(".copy-site-item");
    await expect(button.locator(".copy-site-name")).toHaveText("Destination");
    await button.click();
    await expect(page.locator(".copy-site-error")).toContainText(
      failure === "breakpoints" ? "画面幅設定が一致しない" : "コピー先の編集データを読み込めませんでした"
    );
    await expect(page.locator(".copy-site-done")).toHaveCount(0);
    expect(await browserDoc(page, "destination").catch(() => bad)).toBe(bad);
    if (failure === "read") await page.evaluate(() => { (window as any).failCopyRead = false; });
    await setBrowserDoc(page, "destination", good);
    await button.click();
    await expect(page.locator(".copy-site-done")).toContainText("Destination");
    const saved = JSON.parse((await browserDoc(page, "destination"))!);
    expect(saved.siteName).toBe(doc.siteName);
    expect(saved.customHeadHtml).toBe(doc.customHeadHtml);
    expect(saved.pageOrder.length).toBeGreaterThan(doc.pageOrder.length);
    expect(errors).toEqual([]);
  });
}
