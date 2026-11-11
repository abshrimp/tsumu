import { expect, test, type Page } from "@playwright/test";
import { createInitialDoc } from "../lib/presets";
import { loadLocale } from "../lib/i18n";
import { browserDoc, setBrowserDoc } from "./helpers/browser-doc";

// Presets created on the Node side must use the same locale as the browser.
test.beforeAll(async () => { await loadLocale(); });

const status = (page: Page) => page.locator('[data-tutorial="save-status"]');
const canvas = (page: Page) => page.locator('[data-tutorial="canvas"]');

async function newSite(page: Page): Promise<string> {
  const response = await page.request.post("/api/sites", { data: { name: "Browser save test" } });
  expect(response.ok()).toBeTruthy();
  const { site } = await response.json();
  return site.id as string;
}

async function localOnly(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("tsumu-help-seen-v1", "1");
    localStorage.setItem("tsumu-lang", "ja");
  });
  await page.route("**/api/status", route => route.fulfill({
    json: { auth: false, db: false, assets: false, user: null },
  }));
  await page.route("**/api/doc?*", route => route.fulfill({ status: 503, json: {} }));
}

async function removeHero(page: Page) {
  await page.locator('[data-tutorial="layers-panel"]').getByText("ヒーロー", { exact: true }).click();
  await page.keyboard.press("Delete");
  await expect(canvas(page).getByText("見出しをここに", { exact: false })).toHaveCount(0);
}

test("browser-only autosave stores changes in IndexedDB and restores them after reload", async ({ page }) => {
  const id = await newSite(page);
  await localOnly(page);
  await page.goto(`/sites/${id}`);
  await expect(status(page)).toContainText("このブラウザにのみ保存");
  await removeHero(page);
  await expect.poll(async () => JSON.parse((await browserDoc(page, id))!).pageOrder.length).toBeGreaterThan(0);
  await expect(status(page)).toContainText("このブラウザにのみ保存");
  const saved = await browserDoc(page, id);
  expect(Object.values(JSON.parse(saved!).nodes).some((n: any) => n.name === "ヒーロー")).toBe(false);
  await page.reload();
  await expect(canvas(page).getByText("見出しをここに", { exact: false })).toHaveCount(0);
  await expect(status(page)).toContainText("このブラウザにのみ保存");
});

test("a document larger than localStorage's quota saves and survives editing and reload", async ({ page }) => {
  const id = await newSite(page);
  await localOnly(page);
  await page.goto("/");
  const doc = createInitialDoc();
  doc.assets["large-binary"] = {
    id: "large-binary", name: "large.png", width: 1, height: 1,
    mimeType: "image/png", dataUrl: "data:image/png;base64," + "A".repeat(6 * 1024 * 1024),
  };
  const raw = JSON.stringify(doc);
  expect(raw.length).toBeGreaterThan(5 * 1024 * 1024);
  await setBrowserDoc(page, id, raw);
  await page.goto(`/sites/${id}`);
  await expect(status(page)).toContainText("このブラウザにのみ保存");
  await removeHero(page);
  await expect.poll(async () => {
    const value = await browserDoc(page, id);
    return value && JSON.parse(value).assets["large-binary"]?.dataUrl?.length;
  }).toBeGreaterThan(6 * 1024 * 1024);
  await expect.poll(async () => {
    const value = await browserDoc(page, id);
    return value && Object.values(JSON.parse(value).nodes).some((n: any) => n.name === "ヒーロー");
  }).toBe(false);
  await page.reload();
  await expect(canvas(page).getByText("見出しをここに", { exact: false })).toHaveCount(0);
  await expect(status(page)).toContainText("このブラウザにのみ保存");
});

test("an IndexedDB write failure is never shown as saved and can be retried", async ({ page }) => {
  const id = await newSite(page);
  await localOnly(page);
  await page.addInitScript(() => {
    const state = window as any;
    state.blockBrowserDoc = true;
    state.failedDocSaves = 0;
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(value, key) {
      if (this.name === "documents" && state.blockBrowserDoc) {
        state.failedDocSaves++;
        throw new DOMException("Storage full", "QuotaExceededError");
      }
      return put.call(this, value, key);
    };
  });
  await page.goto(`/sites/${id}`);
  await expect(status(page)).toContainText("このブラウザに保存できません");
  expect(await browserDoc(page, id)).toBeNull();
  expect(await page.evaluate(() => (window as any).failedDocSaves)).toBeGreaterThan(0);
  await page.evaluate(() => { (window as any).blockBrowserDoc = false; });
  await status(page).click();
  await expect(status(page)).toContainText("このブラウザにのみ保存");
  expect(JSON.parse((await browserDoc(page, id))!).pageOrder.length).toBeGreaterThan(0);
});

test("a stale tab cannot overwrite the newer document", async ({ page, context }) => {
  const id = await newSite(page);
  await localOnly(page);
  const other = await context.newPage();
  await other.addInitScript(() => {
    localStorage.setItem("tsumu-help-seen-v1", "1");
    localStorage.setItem("tsumu-lang", "ja");
  });
  await other.route("**/api/doc?*", route => route.fulfill({ status: 503, json: {} }));
  try {
    await page.goto(`/sites/${id}`);
    await expect(status(page)).toContainText("このブラウザにのみ保存");
    await other.goto(`/sites/${id}`);
    await expect(status(other)).toContainText("このブラウザにのみ保存");
    await removeHero(page);
    await expect(status(page)).toContainText("このブラウザにのみ保存");
    await other.locator('[data-tutorial="layers-panel"]').getByText("ナビバー", { exact: true }).click();
    await other.keyboard.press("Delete");
    await expect(status(other)).toContainText("このブラウザに保存できません");
    const stored = JSON.parse((await browserDoc(page, id))!);
    expect(Object.values(stored.nodes).some((n: any) => n.name === "ヒーロー")).toBe(false);
    expect(Object.values(stored.nodes).some((n: any) => n.name === "ナビバー")).toBe(true);
  } finally {
    await other.close();
  }
});

test("a deleted site cannot be silently recreated by its open editor", async ({ page: home, context }) => {
  await localOnly(home);
  await home.route("**/api/sites", route => route.fulfill({ status: 503, json: {} }));
  await home.goto("/");
  const id = "deleted-browser-site";
  const site = { id, name: "Local site", createdAt: 1, updatedAt: 1,
    repo: null, branch: "main", previewBranch: "preview", siteUrl: null, previewUrl: null };
  const doc = createInitialDoc();
  await home.evaluate(site => localStorage.setItem("tsumu-sites-v1", JSON.stringify([site])), site);
  await setBrowserDoc(home, id, JSON.stringify(doc));
  await home.reload();
  const editor = await context.newPage();
  await editor.route("**/api/sites/*", route => route.fulfill({ status: 503, json: {} }));
  await editor.route("**/api/doc?*", route => route.fulfill({ status: 503, json: {} }));
  await editor.goto(`/sites/${id}`);
  try {
    await expect(status(editor)).toContainText("このブラウザにのみ保存");
    await home.getByRole("button", { name: "サイトの操作" }).click();
    await home.getByRole("menuitem", { name: "削除", exact: true }).click();
    await home.locator(".dialog-input").fill(site.name);
    await home.getByRole("dialog").getByRole("button", { name: "削除", exact: true }).click();
    await expect(status(editor)).toContainText("このブラウザの保存先は削除済み");
    expect(await browserDoc(home, id)).toBeNull();
  } finally {
    await editor.close();
  }
});
