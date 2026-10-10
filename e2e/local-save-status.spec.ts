import { expect, test, type Page } from "@playwright/test";
import { createInitialDoc } from "../lib/presets";
import { loadLocale } from "../lib/i18n";
import { browserDoc, setBrowserDoc } from "./helpers/browser-doc";

// Node.js 側で作るプリセットは、ブラウザと同じ言語を使わなければならない。
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
    json: { auth: false, role: "editor", db: false, assets: false, user: null },
  }));
  await page.route("**/api/doc?*", route => route.fulfill({ status: 503, json: {} }));
}

async function removeHero(page: Page) {
  await page.locator('[data-tutorial="layers-panel"]').getByText(/^(ヒーロー|Hero)$/).click();
  await page.keyboard.press("Delete");
  await expect(canvas(page).getByText(/見出しをここに|Your headline here/)).toHaveCount(0);
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
  expect(Object.values(JSON.parse(saved!).nodes).some((n: any) => (n.name === "ヒーロー" || n.name === "Hero"))).toBe(false);
  await page.reload();
  await expect(canvas(page).getByText(/見出しをここに|Your headline here/)).toHaveCount(0);
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
    return value && Object.values(JSON.parse(value).nodes).some((n: any) => (n.name === "ヒーロー" || n.name === "Hero"));
  }).toBe(false);
  await page.reload();
  await expect(canvas(page).getByText(/見出しをここに|Your headline here/)).toHaveCount(0);
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
    await other.locator('[data-tutorial="layers-panel"]').getByText(/^(ナビバー|Navbar)$/).click();
    await other.keyboard.press("Delete");
    await expect(status(other)).toContainText("このブラウザに保存できません");
    const stored = JSON.parse((await browserDoc(page, id))!);
    expect(Object.values(stored.nodes).some((n: any) => (n.name === "ヒーロー" || n.name === "Hero"))).toBe(false);
    expect(Object.values(stored.nodes).some((n: any) => (n.name === "ナビバー" || n.name === "Navbar"))).toBe(true);
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


test("opening a browser-only site does not change its latest edit timestamp", async ({ page }) => {
  const id = await newSite(page);
  await page.goto("/");
  const doc = createInitialDoc();
  const raw = JSON.stringify(doc);
  const oldTime = Date.now() - 2 * 86_400_000;
  await setBrowserDoc(page, id, raw);
  await page.evaluate(({ id, oldTime }) => {
    localStorage.setItem("tsumu-sites-v1", JSON.stringify([{
      id, name: "Browser document", createdAt: oldTime - 60_000,
      updatedAt: oldTime, savedAt: oldTime,
      repo: null, branch: "main", previewBranch: "preview",
      siteUrl: null, previewUrl: null,
    }]));
  }, { id, oldTime });
  await localOnly(page);
  await page.goto(`/sites/${id}`);
  await expect(status(page)).toContainText("このブラウザにのみ保存");
  // Wait past the initial autosave debounce. The timestamp must not change
  // merely because the same IndexedDB document was opened.
  await page.waitForTimeout(900);
  expect(await browserDoc(page, id)).toBe(raw);
  const editedAt = () => page.evaluate((id) => {
    const list = JSON.parse(localStorage.getItem("tsumu-sites-v1") ?? "[]");
    const site = list.find((entry: { id: string }) => entry.id === id);
    return { updatedAt: site?.updatedAt, savedAt: site?.savedAt };
  }, id);
  await expect.poll(editedAt).toEqual({ updatedAt: oldTime, savedAt: oldTime });
  await removeHero(page);
  await expect.poll(async () => (await editedAt()).savedAt).toBeGreaterThan(oldTime);
  const record = await editedAt();
  expect(record.updatedAt).toBe(record.savedAt);
});

test("loading a newer server document only refreshes the browser cache, not local editedAt", async ({ page }) => {
  const id = await newSite(page);
  const doc = createInitialDoc();
  doc.siteName = "Server revision";
  expect((await page.request.put(`/api/doc?site=${id}`, { data: doc })).ok()).toBeTruthy();
  await page.goto("/");
  const cached = createInitialDoc();
  cached.siteName = "Older cached revision";
  await setBrowserDoc(page, id, JSON.stringify(cached));
  const oldTime = Date.now() - 2 * 86_400_000;
  await page.evaluate(({ id, oldTime }) => {
    localStorage.setItem("tsumu-sites-v1", JSON.stringify([{
      id, name: "Cloud document", createdAt: oldTime - 60_000,
      updatedAt: oldTime, savedAt: oldTime,
      repo: null, branch: "main", previewBranch: "preview",
      siteUrl: null, previewUrl: null,
    }]));
    localStorage.setItem("tsumu-help-seen-v1", "1");
  }, { id, oldTime });
  await page.goto(`/sites/${id}`);
  await expect(status(page)).toContainText("サーバー保存済み");
  await expect.poll(async () => (await browserDoc(page, id)) === JSON.stringify(doc)).toBe(true);
  await page.waitForTimeout(800);
  const saved = await page.evaluate((id) => {
    const list = JSON.parse(localStorage.getItem("tsumu-sites-v1") ?? "[]");
    const site = list.find((entry: { id: string }) => entry.id === id);
    return { updatedAt: site?.updatedAt, savedAt: site?.savedAt };
  }, id);
  expect(saved).toEqual({ updatedAt: oldTime, savedAt: oldTime });
});
