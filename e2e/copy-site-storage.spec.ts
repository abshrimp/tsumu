import { expect, test } from "@playwright/test";
import { createInitialDoc } from "../lib/presets";
import { DOC_STORAGE_KEY, emptyDest, siteKey } from "../lib/site";
import { storageKey } from "../lib/storage-keys";
import { copySiteStorageBundle } from "../tests/helpers/copy-site-storage";

let bundle: string;
test.beforeAll(async () => { bundle = await copySiteStorageBundle(); });
for (const failure of ["read", "json", "shape"] as const) {
  test(`copy dialog preserves an unreadable ${failure} destination and allows retry`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    // ネットワーク・保存先はすべて使い捨ての合成データ。
    await page.route("http://tsumu-copy.test/**", (route) => {
      if (new URL(route.request().url()).pathname === "/api/sites") return route.fulfill({ status: 503, json: {} });
      return route.fulfill({ contentType: "text/html", body: '<html><body><div id="app"></div></body></html>' });
    });
    await page.goto("http://tsumu-copy.test/sites/source");
    const doc = createInitialDoc();
    doc.siteName = "Keep this title";
    doc.customHeadHtml = "<!-- Destination content -->";
    const good = JSON.stringify(doc);
    const bad = failure === "json" ? '{"siteName":"recoverable"' : failure === "shape" ? JSON.stringify({ ...doc, pageOrder: [] }) : good;
    const key = siteKey(DOC_STORAGE_KEY, "destination");
    await page.evaluate(({ key, listKey, site, bad, failure }) => {
      localStorage.setItem("tsumu-lang", "ja");
      localStorage.setItem(listKey, JSON.stringify([site]));
      localStorage.setItem(key, bad);
      const state = window as any;
      state.failCopyRead = failure === "read";
      state.originalGetItem = Storage.prototype.getItem;
      Storage.prototype.getItem = function (k) {
        if (state.failCopyRead && k === key) throw new Error("Read unavailable");
        return state.originalGetItem.call(this, k);
      };
    }, { key, listKey: storageKey("sites-v1"), site: { ...emptyDest(), id: "destination", name: "Destination", createdAt: 1, updatedAt: 1 }, bad, failure });
    await page.addScriptTag({ content: bundle });
    const button = page.locator(".copy-site-item");
    await expect(button).toHaveText("Destination");
    await button.click();
    await expect(page.locator(".copy-site-error")).toContainText("コピー先の編集データを読み込めませんでした");
    await expect(page.locator(".copy-site-done")).toHaveCount(0);
    await expect(button).toBeEnabled();
    expect(await page.evaluate((key) => (window as any).originalGetItem.call(localStorage, key), key)).toBe(bad);
    await page.evaluate(({ key, good }) => { (window as any).failCopyRead = false; localStorage.setItem(key, good); }, { key, good });
    await button.click();
    await expect(page.locator(".copy-site-done")).toContainText("Destination");
    const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), key);
    expect(saved.siteName).toBe(doc.siteName);
    expect(saved.customHeadHtml).toBe(doc.customHeadHtml);
    expect(saved.pageOrder.length).toBeGreaterThan(doc.pageOrder.length);
    for (const id of doc.pageOrder) expect(saved.pages[id]).toEqual(doc.pages[id]);
    expect(errors).toEqual([]);
  });
}
