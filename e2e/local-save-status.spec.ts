import { expect, test, type Page } from "@playwright/test";
import { createInitialDoc } from "../lib/presets";
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
