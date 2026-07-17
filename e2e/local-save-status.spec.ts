import { expect, test, type Page } from "@playwright/test";
import { createInitialDoc } from "../lib/presets";
import { emptyDest } from "../lib/site";
import JSZip from "jszip";
import type { SiteDoc } from "../lib/types";

const status = (page: Page) => page.locator('[data-tutorial="save-status"]');
const canvas = (page: Page) => page.locator('[data-tutorial="canvas"]');
const localSaved = "このブラウザにのみ保存";
const localFailed = "このブラウザに保存できません";
const bothFailed = "サーバーにもこのブラウザにも保存できません";
const localWarning = "ブラウザに保存できません。容量や設定を確認して、クリックで再試行してください。";

async function prepare(page: Page, { blocked = true, cached, remote }: {
  blocked?: boolean; cached?: SiteDoc; remote?: SiteDoc;
} = {}) {
  const result = await page.request.post("/api/sites", { data: { name: "Local save status test" } });
  expect(result.ok()).toBeTruthy();
  const { site } = await result.json();
  const id = site.id as string;
  if (remote) expect((await page.request.put(`/api/doc?site=${id}`, { data: remote })).ok()).toBeTruthy();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(({ id, blocked, cached }) => {
    localStorage.setItem("tsumu-help-seen-v1", "1");
    localStorage.setItem("tsumu-lang", "ja");
    if (cached) localStorage.setItem(`tsumu-doc-v1:${id}`, JSON.stringify(cached));
    const state = window as any;
    state.blockDocSave = blocked;
    state.failedDocSaves = 0;
    const write = Storage.prototype.setItem;
    // このテストが作ったサイトの本文だけを失敗させ、他の保存・サイトには影響させない。
    Storage.prototype.setItem = function (key, value) {
      if (key === `tsumu-doc-v1:${id}` && state.blockDocSave) {
        state.failedDocSaves++;
        throw new DOMException("Storage full", "QuotaExceededError");
      }
      write.call(this, key, value);
    };
  }, { id, blocked, cached });
  return { id, errors };
}

const stored = (page: Page, id: string) => page.evaluate((id) => localStorage.getItem(`tsumu-doc-v1:${id}`), id);
const blockWrites = (page: Page, blocked: boolean) => page.evaluate((blocked) => { (window as any).blockDocSave = blocked; }, blocked);
const failedWrites = (page: Page) => page.evaluate(() => (window as any).failedDocSaves as number);

async function failServer(page: Page, code: number) {
  await page.route("**/api/doc?*", (route) => route.fulfill({ status: code, json: {} }));
}

async function deleteHero(page: Page) {
  await page.locator('[data-tutorial="layers-panel"]').getByText("ヒーロー", { exact: true }).click();
  await page.keyboard.press("Delete");
  await expect(canvas(page).getByText("見出しをここに", { exact: false })).toHaveCount(0);
}

async function pauseClock(page: Page) {
  const time = new Date("2030-01-01T00:00:00Z");
  await page.clock.install({ time });
  await page.clock.pauseAt(new Date(time.getTime() + 1000));
}

for (const code of [503, 500]) {
  test(`${code}: a failed browser save is never reported as saved, and clicking retries it`, async ({ page }) => {
    const { id, errors } = await prepare(page);
    await failServer(page, code);
    await page.goto(`/sites/${id}`);
    const failed = code === 503 ? localFailed : bothFailed;
    await expect(status(page)).toHaveText(failed);
    expect(await stored(page, id)).toBeNull();
    await status(page).hover();
    await expect(page.getByRole("tooltip")).toContainText(localWarning);

    const attempts = await failedWrites(page);
    await status(page).click();
    await expect(status(page)).toHaveText(failed);
    expect(await failedWrites(page)).toBeGreaterThan(attempts);
    expect(await stored(page, id)).toBeNull();

    await blockWrites(page, false);
    await status(page).click();
    await expect(status(page)).toContainText(code === 503 ? localSaved : "サーバーに保存できません（このブラウザには保存済み）");
    expect(JSON.parse((await stored(page, id))!).pageOrder.length).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });
}

test("a failed edit does not reuse the previous saved label or overwrite the recoverable cache", async ({ page }) => {
  const { id, errors } = await prepare(page, { blocked: false });
  await failServer(page, 503);
  await page.goto(`/sites/${id}`);
  await expect(status(page)).toContainText(localSaved);
  const before = (await stored(page, id))!;
  await pauseClock(page);
  await blockWrites(page, true);
  await deleteHero(page);
  await expect(status(page)).toHaveText("このブラウザへ保存中…");
  expect(await stored(page, id)).toBe(before);
  await page.clock.runFor(600);
  await expect(status(page)).toHaveText(localFailed);
  expect(await stored(page, id)).toBe(before);

  await blockWrites(page, false);
  await status(page).click();
  await page.clock.runFor(2000);
  await expect(status(page)).toContainText(localSaved);
  const after = (await stored(page, id))!;
  expect(after).not.toBe(before);
  expect(Object.values(JSON.parse(after).nodes).some((n: any) => n.name === "ヒーロー")).toBe(false);
  expect(errors).toEqual([]);
});

test("a newer edit cancels the older local timer and only the latest document becomes saved", async ({ page }) => {
  const { id, errors } = await prepare(page, { blocked: false });
  await failServer(page, 503);
  await page.goto(`/sites/${id}`);
  await expect(status(page)).toContainText(localSaved);
  const before = (await stored(page, id))!;
  await pauseClock(page);
  await deleteHero(page);
  await expect(status(page)).toHaveText("このブラウザへ保存中…");
  await page.clock.runFor(300);
  await page.locator('[data-tutorial="layers-panel"]').getByText("ナビバー", { exact: true }).click();
  await page.keyboard.press("Delete");
  await expect(page.locator('[data-tutorial="layers-panel"]').getByText("ナビバー", { exact: true })).toHaveCount(0);
  await page.clock.runFor(250);
  await expect(status(page)).toHaveText("このブラウザへ保存中…");
  expect(await stored(page, id)).toBe(before);
  await page.clock.runFor(300);
  await expect(status(page)).toContainText(localSaved);
  const after = JSON.parse((await stored(page, id))!);
  expect(Object.values(after.nodes).some((n: any) => n.name === "ヒーロー" || n.name === "ナビバー")).toBe(false);
  expect(errors).toEqual([]);
});

test("a successful server save stays successful when the browser cache fails, and local retry does not reconnect", async ({ page }) => {
  const { id, errors } = await prepare(page, { remote: createInitialDoc() });
  let requests = 0;
  await page.route("**/api/doc?*", (route) => { requests++; return route.continue(); });
  await page.goto(`/sites/${id}`);
  await expect(status(page)).toContainText("サーバー保存済み");
  await expect.poll(() => failedWrites(page)).toBeGreaterThan(0);
  expect(await stored(page, id)).toBeNull();
  await status(page).hover();
  await expect(page.getByRole("tooltip")).toContainText(localWarning);
  await pauseClock(page);
  const before = requests;
  await blockWrites(page, false);
  await status(page).click();
  await expect.poll(() => stored(page, id)).not.toBeNull();
  await expect(status(page)).toContainText("サーバー保存済み");
  expect(requests).toBe(before);
  expect(errors).toEqual([]);
});

test("reconnecting after both saves fail can save to the server without hiding the local warning or remounting the canvas", async ({ page }) => {
  const { id, errors } = await prepare(page);
  await failServer(page, 503);
  await page.goto(`/sites/${id}`);
  await expect(status(page)).toHaveText(localFailed);
  await page.evaluate(() => { (window as any).saveStatusCanvas = document.querySelector('[data-tutorial="canvas"]'); });
  await deleteHero(page);
  await expect(status(page)).toHaveText(localFailed);
  await page.unroute("**/api/doc?*");
  await status(page).click();
  await expect(status(page)).toContainText("サーバー保存済み");
  expect(await stored(page, id)).toBeNull();
  await status(page).hover();
  await expect(page.getByRole("tooltip")).toContainText(localWarning);
  expect(await page.evaluate(() => (window as any).saveStatusCanvas === document.querySelector('[data-tutorial="canvas"]'))).toBe(true);
  const server = await (await page.request.get(`/api/doc?site=${id}`)).json();
  expect(server.exists).toBe(true);
  expect(Object.values(server.doc.nodes).some((n: any) => n.name === "ヒーロー")).toBe(false);
  expect(errors).toEqual([]);
});

const warnsOnUnload = (page: Page) => page.evaluate(() => {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
});

test("browser-only mode warns only until the current edit is saved locally", async ({ page }) => {
  const { id, errors } = await prepare(page, { blocked: false });
  await page.route("**/api/status", route => route.fulfill({
    json: { auth: false, db: false, assets: false, user: null },
  }));
  await failServer(page, 503);
  await page.goto(`/sites/${id}`);
  await expect(status(page)).toContainText(localSaved);
  expect(await warnsOnUnload(page)).toBe(false);

  await blockWrites(page, true);
  await deleteHero(page);
  expect(await warnsOnUnload(page)).toBe(true);
  await expect(status(page)).toHaveText(localFailed);
  expect(await warnsOnUnload(page)).toBe(true);

  await blockWrites(page, false);
  await status(page).click();
  await expect(status(page)).toContainText(localSaved);
  expect(await warnsOnUnload(page)).toBe(false);
  expect(errors).toEqual([]);
});

test("a configured server still warns for unsynced edits even when the browser copy is saved", async ({ page }) => {
  const { id, errors } = await prepare(page, { blocked: false });
  await page.route("**/api/status", route => route.fulfill({
    json: { auth: false, db: true, assets: false, user: null },
  }));
  await failServer(page, 503);
  await page.goto(`/sites/${id}`);
  await expect(status(page)).toContainText(localSaved);
  await deleteHero(page);
  await expect(status(page)).toContainText(localSaved);
  expect(await warnsOnUnload(page)).toBe(true);
  expect(errors).toEqual([]);
});

test("Home deletion invalidates an already saved local editor, preserving its draft, undo, copy and ZIP export", async ({ page: home, context }) => {
  const site = { ...emptyDest(), id: "local-autosave-deletion", name: "Local autosave deletion", createdAt: 1, updatedAt: 1 };
  const marker = `tsumu-site-deleted-v1:${site.id}`;
  await context.route("**/api/**", route => {
    const path = new URL(route.request().url()).pathname;
    if (/^\/api\/(sites(?:\/.*)?|doc|comments|collab\/.*)$/.test(path)) return route.fulfill({ status: 503, json: {} });
    return route.continue();
  });
  await context.addInitScript(() => {
    localStorage.setItem("tsumu-help-seen-v1", "1");
    localStorage.setItem("tsumu-lang", "ja");
  });
  await home.goto("/");
  const doc = createInitialDoc(); doc.siteName = site.name;
  await home.evaluate(({ site, doc }) => {
    localStorage.setItem("tsumu-sites-v1", JSON.stringify([site]));
    localStorage.setItem(`tsumu-doc-v1:${site.id}`, JSON.stringify(doc));
  }, { site, doc });
  await home.reload();
  await expect(home.locator(".home-card-name")).toHaveText(site.name);
  const editor = await context.newPage();
  const errors: string[] = [];
  editor.on("pageerror", error => errors.push(error.message));
  await editor.goto(`/sites/${site.id}`);
  await expect(status(editor)).toContainText(localSaved);
  expect(await warnsOnUnload(editor)).toBe(false);
  await editor.evaluate(() => { (window as any).savedCanvas = document.querySelector('[data-tutorial="canvas"]'); });
  // Unsubmitted text must not disappear when the surrounding site's saved status changes.
  await editor.getByRole("button", { name: "コメント", exact: true }).click();
  await editor.locator(".cm-catcher").click({ position: { x: 120, y: 120 } });
  const draft = editor.getByRole("region", { name: "コメントの詳細", exact: true }).getByPlaceholder("コメントを書く", { exact: true });
  await draft.fill("Keep this unsent draft");
  await home.getByRole("button", { name: "サイトの操作", exact: true }).click();
  await home.getByRole("menuitem", { name: "削除", exact: true }).click();
  await home.locator(".dialog-input").fill(site.name);
  await home.getByRole("dialog").getByRole("button", { name: "削除", exact: true }).click();
  await expect(home.locator(".home-card")).toHaveCount(0);
  // No new document edit or manual refresh: the real cross-tab storage event invalidates saved.
  await expect(status(editor)).toHaveText("このブラウザの保存先は削除済み");
  await expect(editor.locator(".local-save-notice")).toContainText("コピーするかZIPに書き出してください");
  await expect(draft).toHaveValue("Keep this unsent draft");
  expect(await warnsOnUnload(editor)).toBe(true);
  expect(await editor.evaluate(() => (window as any).savedCanvas === document.querySelector('[data-tutorial="canvas"]'))).toBe(true);
  await expect(editor).toHaveURL(new RegExp(`/sites/${site.id}$`));
  expect(await stored(editor, site.id)).toBeNull();
  await editor.getByRole("button", { name: "コメント", exact: true }).click();
  await pauseClock(editor);
  await deleteHero(editor);
  await editor.clock.runFor(600);
  await expect(status(editor)).toHaveText("このブラウザの保存先は削除済み");
  await editor.keyboard.press("ControlOrMeta+z");
  await expect(canvas(editor).getByText("見出しをここに", { exact: false }).first()).toBeVisible();
  await editor.keyboard.press("ControlOrMeta+Shift+z");
  await expect(canvas(editor).getByText("見出しをここに", { exact: false })).toHaveCount(0);
  await editor.keyboard.press("ControlOrMeta+z");
  await editor.locator('[data-tutorial="layers-panel"]').getByText("ヒーロー", { exact: true }).click();
  await editor.keyboard.press("ControlOrMeta+c");
  expect(await editor.evaluate(() => JSON.parse(localStorage.getItem("tsumu-clipboard-v1")!).nodes.some((node: any) => node.name === "ヒーロー"))).toBe(true);
  await editor.clock.runFor(600);
  expect(await stored(editor, site.id)).toBeNull();
  await editor.locator('[data-tutorial="menu"]').click();
  await editor.getByText("zipでエクスポート", { exact: true }).click();
  const downloading = editor.waitForEvent("download");
  await editor.getByRole("button", { name: "zipをダウンロード", exact: true }).click();
  const stream = await (await downloading).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  const zip = await JSZip.loadAsync(Buffer.concat(chunks));
  const pageFile = Object.keys(zip.files).find(name => name.endsWith("app/page.tsx"))!;
  expect(await zip.file(pageFile)!.async("string")).toContain("見出しをここに");
  expect(await stored(editor, site.id)).toBeNull();
  expect(await editor.evaluate(key => localStorage.getItem(key), marker)).toBe("1");
  expect(errors).toEqual([]);
});

test("deleting only the browser copy leaves an authoritative server site's saving and unload behavior intact", async ({ page, context }) => {
  const { id, errors } = await prepare(page, { blocked: false, remote: createInitialDoc() });
  await page.goto(`/sites/${id}`);
  await expect(status(page)).toContainText("サーバー保存済み");
  await expect.poll(() => stored(page, id)).not.toBeNull();
  const other = await context.newPage();
  await other.goto("/");
  // The server record remains valid. This marker concerns only this browser's old copy.
  await other.evaluate(id => {
    localStorage.setItem(`tsumu-site-deleted-v1:${id}`, "1");
    localStorage.removeItem(`tsumu-doc-v1:${id}`);
  }, id);
  await status(page).hover();
  await expect(page.getByRole("tooltip")).toContainText("このブラウザの保存先は削除されています");
  await expect(status(page)).toContainText("サーバー保存済み");
  await expect(page.locator(".local-save-notice")).toHaveCount(0);
  expect(await warnsOnUnload(page)).toBe(false);
  await deleteHero(page);
  await expect(status(page)).toContainText("サーバー保存済み");
  await expect.poll(async () => {
    const snapshot = await (await page.request.get(`/api/doc?site=${id}`)).json();
    return Object.values(snapshot.doc.nodes).some((node: any) => node.name === "ヒーロー");
  }).toBe(false);
  expect(await stored(page, id)).toBeNull();
  expect(await warnsOnUnload(page)).toBe(false);
  expect(await page.evaluate(id => localStorage.getItem(`tsumu-site-deleted-v1:${id}`), id)).toBe("1");
  expect(errors).toEqual([]);
});
