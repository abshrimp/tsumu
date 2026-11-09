import { expect, test } from "@playwright/test";
import { createInitialDoc } from "../lib/presets";
import { emptyDest } from "../lib/site";
import { homeSiteStorageBundle } from "../tests/helpers/home-site-storage";
import { browserDoc, browserDocIds, setBrowserDoc } from "./helpers/browser-doc";

const listKey = "tsumu-sites-v1";
const source = { ...emptyDest(), id: "source", name: "Original", createdAt: 1, updatedAt: 2 };
let bundle: string;
test.beforeAll(async () => { bundle = await homeSiteStorageBundle(); });

async function prepare(page: import("@playwright/test").Page, large = false) {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("http://tsumu-home.test/**", route => {
    if (new URL(route.request().url()).pathname === "/api/sites") return route.fulfill({ status: 503, json: {} });
    return route.fulfill({ contentType: "text/html", body: '<html><body><div id="app"></div></body></html>' });
  });
  await page.goto("http://tsumu-home.test/");
  const doc = createInitialDoc();
  doc.siteName = "Original public title";
  if (large) {
    doc.assets["large-binary"] = {
      id: "large-binary", name: "large.png", width: 1, height: 1,
      mimeType: "image/png", dataUrl: "data:image/png;base64," + "A".repeat(6 * 1024 * 1024),
    };
  }
  const raw = JSON.stringify(doc);
  await page.evaluate(({ site, listKey }) => {
    localStorage.setItem("tsumu-lang", "ja");
    localStorage.setItem(listKey, JSON.stringify([site]));
  }, { site: source, listKey });
  await setBrowserDoc(page, source.id, raw);
  await page.addScriptTag({ content: bundle });
  await expect(page.locator(".home-card")).toHaveCount(1);
  return { errors, raw };
}

async function openDuplicate(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "サイトの操作" }).click();
  await page.getByRole("menuitem", { name: "複製", exact: true }).click();
  const dialog = page.locator(".home-dialog");
  await dialog.locator("input").first().fill("Duplicate");
  return dialog;
}

test("a large IndexedDB document can be duplicated without localStorage quota errors", async ({ page }) => {
  const { errors, raw } = await prepare(page, true);
  expect(raw.length).toBeGreaterThan(5 * 1024 * 1024);
  const dialog = await openDuplicate(page);
  await dialog.getByRole("button", { name: "複製", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".home-card")).toHaveCount(2);
  const sites = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!) as { id: string }[], listKey);
  expect(await browserDoc(page, sites[0].id)).toBe(raw);
  expect(await browserDoc(page, source.id)).toBe(raw);
  expect(await browserDocIds(page)).toHaveLength(2);
  expect(errors).toEqual([]);
});

test("a failed site-index write rolls back the copied document and can be retried", async ({ page }) => {
  const { errors, raw } = await prepare(page);
  const dialog = await openDuplicate(page);
  await page.evaluate(key => {
    const state = window as any;
    state.failListWrite = true;
    const write = Storage.prototype.setItem;
    Storage.prototype.setItem = function(k, value) {
      if (k === key && state.failListWrite) throw new DOMException("Storage full", "QuotaExceededError");
      return write.call(this, k, value);
    };
  }, listKey);
  await dialog.getByRole("button", { name: "複製", exact: true }).click();
  await expect(dialog.locator(".home-dialog-error")).toContainText("サイトを複製できませんでした");
  expect(await browserDocIds(page)).toEqual([source.id]);
  expect(await browserDoc(page, source.id)).toBe(raw);
  await page.evaluate(() => { (window as any).failListWrite = false; });
  await dialog.getByRole("button", { name: "複製", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".home-card")).toHaveCount(2);
  expect(await browserDocIds(page)).toHaveLength(2);
  expect(errors).toEqual([]);
});
