import { expect, test } from "@playwright/test";
import { createInitialDoc } from "../lib/presets";
import { DOC_STORAGE_KEY, emptyDest, siteKey } from "../lib/site";
import { storageKey } from "../lib/storage-keys";
import { homeSiteStorageBundle } from "../tests/helpers/home-site-storage";

const listKey = storageKey("sites-v1");
const sourceDocKey = siteKey(DOC_STORAGE_KEY, "source");
let bundle: string;
test.beforeAll(async () => { bundle = await homeSiteStorageBundle(); });

for (const failure of ["quota", "list"] as const) {
  test(`local duplication keeps its dialog and original content after ${failure} failure, then retries`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    // All requests are intercepted; these tests do not touch saved sites or external services.
    await page.route("http://tsumu-home.test/**", (route) => {
      if (new URL(route.request().url()).pathname === "/api/sites") {
        return route.fulfill({ status: 503, json: {} });
      }
      return route.fulfill({ contentType: "text/html", body: '<html><body><div id="app"></div></body></html>' });
    });
    await page.goto("http://tsumu-home.test/");
    const doc = createInitialDoc();
    doc.siteName = "Original public title";
    doc.pages.about = { ...doc.pages[doc.pageOrder[0]], id: "about", name: "About", title: "About", slug: "about", children: [] };
    doc.pageOrder.push("about");
    doc.customHeadHtml = `<style>/* ${"x".repeat(100_000)} */</style>`;
    const raw = JSON.stringify(doc);
    await page.evaluate(({ listKey, sourceDocKey, source, raw }) => {
      localStorage.setItem("tsumu-lang", "ja");
      localStorage.setItem(listKey, JSON.stringify([source]));
      localStorage.setItem(sourceDocKey, raw);
    }, { listKey, sourceDocKey, source: { ...emptyDest(), id: "source", name: "Original", createdAt: 1, updatedAt: 2 }, raw });
    await page.addScriptTag({ content: bundle });
    await expect(page.locator(".home-card")).toHaveCount(1);
    await page.getByRole("button", { name: "サイトの操作" }).click();
    await page.getByRole("menuitem", { name: "複製", exact: true }).click();
    const dialog = page.locator(".home-dialog");
    await dialog.locator("input").first().fill("Duplicate");

    await page.evaluate(({ failure, listKey, rawLength }) => {
      const state = window as any;
      const size = () => Object.keys(localStorage).reduce((n, key) => n + key.length + localStorage.getItem(key)!.length, 0);
      state.homeStorageLimit = failure === "quota" ? size() + rawLength / 2 : Infinity;
      state.homeFailList = failure === "list";
      const write = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        const old = this.getItem(key);
        const bytes = size() - (old === null ? 0 : key.length + old.length) + key.length + value.length;
        if ((state.homeFailList && key === listKey) || bytes > state.homeStorageLimit) {
          throw new DOMException("Storage full", "QuotaExceededError");
        }
        write.call(this, key, value);
      };
    }, { failure, listKey, rawLength: raw.length });
    await dialog.getByRole("button", { name: "複製", exact: true }).click();
    await expect(dialog.locator(".home-dialog-error")).toContainText("サイトを複製できませんでした");
    await expect(dialog.getByRole("button", { name: "複製", exact: true })).toBeEnabled();
    await expect(dialog.locator("input").first()).toHaveValue("Duplicate");
    await expect(page.locator(".home-card")).toHaveCount(1);
    expect(await page.evaluate(({ listKey, sourceDocKey }) => ({
      ids: JSON.parse(localStorage.getItem(listKey)!).map((s: any) => s.id),
      docKeys: Object.keys(localStorage).filter((key) => key.startsWith("tsumu-doc-v1:")),
      source: localStorage.getItem(sourceDocKey),
    }), { listKey, sourceDocKey })).toEqual({ ids: ["source"], docKeys: [sourceDocKey], source: raw });

    await page.evaluate(() => { (window as any).homeStorageLimit = Infinity; (window as any).homeFailList = false; });
    await dialog.getByRole("button", { name: "複製", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator(".home-card")).toHaveCount(2);
    expect(await page.evaluate(({ listKey, docKey }) => {
      const sites = JSON.parse(localStorage.getItem(listKey)!);
      return localStorage.getItem(`${docKey}:${sites[0].id}`);
    }, { listKey, docKey: DOC_STORAGE_KEY })).toBe(raw);
    expect(errors).toEqual([]);
  });
}
