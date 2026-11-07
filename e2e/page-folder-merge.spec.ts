import { test, expect, type Page } from "@playwright/test";
import { pageFolderBundle, pageFolderFixture } from "../tests/helpers/page-folder-merge";

test.describe("page-folder-merge", () => {
let bundle: string;
const errors = new WeakMap<Page, string[]>();
test.beforeAll(async () => { bundle = await pageFolderBundle(); });
test.beforeEach(async ({ page }) => {
  errors.set(page, []);
  page.on("pageerror", (error) => errors.get(page)!.push(error.message));
  await page.route("http://page-folders.test/", (route) => route.fulfill({ contentType: "text/html", body: '<html><body><div id="app"></div></body></html>' }));
  await page.goto("http://page-folders.test/");
  await page.addScriptTag({ content: bundle });
  await expect(page.locator(".folder-name")).toHaveText(["First", "Second", "Third"]);
});
test.afterEach(async ({ page }) => { expect(errors.get(page)).toEqual([]); });

const folder = (page: Page, name: string) => page.locator(".page-folder").filter({ has: page.locator(".folder-name").filter({ hasText: new RegExp(`^${name}$`) }) });
async function rename(page: Page, from: string, to: string) {
  await folder(page, from).locator(".folder-row").hover();
  await folder(page, from).locator('[data-tip="名前を変更"]').click();
  await page.locator(".folder-rename").fill(to);
  await page.locator(".folder-rename").press("Enter");
  await expect(page.locator(".folder-rename")).toHaveCount(0);
}
async function history(page: Page, action: "undo" | "redo", count = 1) {
  await page.evaluate(({ action, count }) => {
    for (let i = 0; i < count; i++) (window as any).folderEditor.getState()[action]();
  }, { action, count });
}

for (const receiveAfterUndo of [false, true]) {
  test(`Receiving a different folder rename ${receiveAfterUndo ? "after Undo" : "while editing"} preserves it in history`, async ({ page }) => {
    await rename(page, "First", "Local name");
    if (receiveAfterUndo) await history(page, "undo");
    await page.evaluate(() => {
      const remote = structuredClone((window as any).folderBase);
      remote.pageFolders[1].name = "Remote name";
      (window as any).receiveFolderDoc(remote);
    });
    await expect(page.locator(".folder-name")).toHaveText([receiveAfterUndo ? "First" : "Local name", "Remote name", "Third"]);
    if (!receiveAfterUndo) await history(page, "undo");
    await expect(folder(page, "Remote name").locator(".page-label")).toContainText(["Remote name", "Q"]);
    await history(page, "redo");
    await expect(page.locator(".folder-name")).toHaveText(["Local name", "Remote name", "Third"]);
  });
}

test("Concurrent folder creation and page moves survive Undo of creation and movement", async ({ page }) => {
  await folder(page, "First").locator(".folder-pages .page-row").click({ modifiers: ["Control"] });
  await page.getByRole("button", { name: "フォルダへ移動", exact: true }).click();
  await page.getByRole("button", { name: "新しいフォルダ", exact: true }).click();
  await page.locator(".folder-rename").fill("Local folder");
  await page.locator(".folder-rename").press("Enter");
  await expect(folder(page, "Local folder").locator(".folder-pages .page-row")).toContainText("P");
  await page.evaluate(() => {
    const remote = structuredClone((window as any).folderBase);
    remote.pageFolders.push({ id: "remote", name: "Remote folder" });
    remote.pages.q.folderId = "remote";
    (window as any).receiveFolderDoc(remote);
  });
  await expect(folder(page, "Remote folder").locator(".folder-pages .page-row")).toContainText("Q");
  await expect(folder(page, "Local folder").locator(".folder-pages .page-row")).toContainText("P");
  await history(page, "undo", 3);
  await expect(page.locator(".folder-name")).toHaveText(["First", "Second", "Third", "Remote folder"]);
  await expect(folder(page, "First").locator(".folder-pages .page-row")).toContainText("P");
  await expect(folder(page, "Remote folder").locator(".folder-pages .page-row")).toContainText("Q");
  await history(page, "redo", 3);
  await expect(folder(page, "Local folder").locator(".folder-pages .page-row")).toContainText("P");
  await expect(folder(page, "Remote folder").locator(".folder-pages .page-row")).toContainText("Q");
});

test("Dragging a folder to reorder it preserves a concurrent rename of another folder", async ({ page }) => {
  await folder(page, "Third").locator(".folder-row").dragTo(folder(page, "First").locator(".folder-row"), { targetPosition: { x: 60, y: 2 } });
  await expect(page.locator(".folder-name")).toHaveText(["Third", "First", "Second"]);
  await page.evaluate(() => {
    const remote = structuredClone((window as any).folderBase);
    remote.pageFolders[1].name = "Remote name";
    (window as any).receiveFolderDoc(remote);
  });
  await expect(page.locator(".folder-name")).toHaveText(["Third", "First", "Remote name"]);
  await history(page, "undo");
  await expect(page.locator(".folder-name")).toHaveText(["First", "Remote name", "Third"]);
  await history(page, "redo");
  await expect(page.locator(".folder-name")).toHaveText(["Third", "First", "Remote name"]);
});

test("Undo/Redo of folder deletion does not undo a remote rename of a different folder", async ({ page }) => {
  await folder(page, "First").locator(".folder-row").hover();
  await folder(page, "First").locator('[data-tip="フォルダを削除（中のページはフォルダの外へ出ます）"]').click();
  await page.evaluate(() => {
    const remote = structuredClone((window as any).folderBase);
    remote.pageFolders[1].name = "Remote name";
    (window as any).receiveFolderDoc(remote);
  });
  await expect(page.locator(".folder-name")).toHaveText(["Remote name", "Third"]);
  await history(page, "undo");
  await expect(folder(page, "First").locator(".folder-pages .page-row")).toContainText("P");
  await expect(page.locator(".folder-name")).toHaveText(["First", "Remote name", "Third"]);
  await history(page, "redo");
  await expect(page.locator(".folder-name")).toHaveText(["Remote name", "Third"]);
  expect(await page.evaluate(() => (window as any).folderEditor.getState().doc.pages.p.folderId)).toBeUndefined();
});
});

test.describe("page-folder-collaboration", () => {
async function renameFolder(page: Page, from: string, to: string) {
  const folder = page.locator(".page-folder").filter({ has: page.locator(".folder-name").filter({ hasText: new RegExp(`^${from}$`) }) });
  await folder.locator(".folder-row").hover();
  await folder.locator('[data-tip="名前を変更"]').click();
  await page.locator(".folder-rename").fill(to);
  await page.locator(".folder-rename").press("Enter");
  await expect(page.locator(".folder-rename")).toHaveCount(0);
}
const saved = (page: Page) => expect(page.locator('[data-tutorial="save-status"]')).toContainText("サーバー保存済み");

// 実際の Next.js のエディタと保存の API を通して、409 の後の再試行と、もう一方の利用者への配信を試す。
test("Two users renaming different folders resolve save conflicts and preserve remote names after Undo/Redo", async ({ browser, request, baseURL }) => {
  const created = await request.post("/api/sites", { data: { name: "Concurrent page folders" } });
  expect(created.ok()).toBeTruthy();
  const { site } = await created.json();
  const endpoint = `/api/doc?site=${site.id}`;
  expect((await request.put(endpoint, { data: pageFolderFixture() })).ok()).toBeTruthy();
  const contexts = await Promise.all([0, 1].map(() => browser.newContext({ baseURL, locale: "ja-JP" })));
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const errors: string[] = [];
  try {
    const [a, b] = await Promise.all(contexts.map((context) => context.newPage()));
    for (const page of [a, b]) {
      page.on("pageerror", (error) => errors.push(error.message));
      await page.addInitScript(() => localStorage.setItem("tsumu-help-seen-v1", "1"));
      await page.goto(`/sites/${site.id}`);
      await saved(page);
      await page.locator('[data-tutorial="left-tab-pages"]').click();
      await expect(page.locator(".folder-name")).toHaveText(["First", "Second", "Third"]);
    }

    let held = false;
    // next start での HTTP の保存（通常は PATCH）を、サーバーに届く前に1回だけ止める。
    await a.route("**/api/doc?**", async (route) => {
      if (!held && ["PATCH", "PUT"].includes(route.request().method())) {
        held = true;
        await gate;
      }
      await route.continue();
    });
    await renameFolder(a, "First", "Local name");
    await expect.poll(() => held).toBe(true);
    await renameFolder(b, "Second", "Remote name");
    await saved(b);
    await expect.poll(async () => (await (await request.get(endpoint)).json()).doc.pageFolders.map((f: { name: string }) => f.name)).toEqual(["First", "Remote name", "Third"]);
    const conflict = a.waitForResponse((response) => response.url().includes("/api/doc?") && response.status() === 409);
    release();
    await conflict;
    await expect(a.locator(".folder-name")).toHaveText(["Local name", "Remote name", "Third"]);
    await saved(a);
    await expect(b.locator(".folder-name")).toHaveText(["Local name", "Remote name", "Third"]);
    await expect.poll(async () => (await (await request.get(endpoint)).json()).doc.pageFolders.map((f: { name: string }) => f.name)).toEqual(["Local name", "Remote name", "Third"]);

    await a.keyboard.press("ControlOrMeta+z");
    await expect(a.locator(".folder-name")).toHaveText(["First", "Remote name", "Third"]);
    await saved(a);
    await expect(b.locator(".folder-name")).toHaveText(["First", "Remote name", "Third"]);
    await expect.poll(async () => (await (await request.get(endpoint)).json()).doc.pageFolders.map((f: { name: string }) => f.name)).toEqual(["First", "Remote name", "Third"]);
    await a.keyboard.press("ControlOrMeta+Shift+z");
    await expect(a.locator(".folder-name")).toHaveText(["Local name", "Remote name", "Third"]);
    await saved(a);
    await expect(b.locator(".folder-name")).toHaveText(["Local name", "Remote name", "Third"]);
    await expect.poll(async () => (await (await request.get(endpoint)).json()).doc.pageFolders.map((f: { name: string }) => f.name)).toEqual(["Local name", "Remote name", "Third"]);
    expect(errors).toEqual([]);
  } finally {
    release();
    await Promise.all(contexts.map((context) => context.close()));
  }
});
});

test.describe("pages-panel-interactions", () => {
test("Pages panel initially selects the active page and supports inline renaming", async ({ page, request }) => {
  const created = await request.post("/api/sites", { data: { name: "Page panel controls" } });
  expect(created.ok()).toBeTruthy();
  const { site } = await created.json();
  expect((await request.put(`/api/doc?site=${site.id}`, { data: pageFolderFixture() })).ok()).toBeTruthy();
  await page.addInitScript(() => localStorage.setItem("tsumu-help-seen-v1", "1"));
  await page.goto(`/sites/${site.id}`);
  await page.locator('[data-tutorial="left-tab-pages"]').click();
  await expect(page.locator(".folder-name")).toHaveText(["First", "Second", "Third"]);

  await page.locator(".pages-toolbar:not(.is-bulk) .icon-btn").first().click();
  await expect(page.locator(".page-row.is-picked")).toHaveCount(1);
  await expect(page.locator(".page-row.is-picked input.page-pick")).toBeChecked();
  await page.locator(".pages-toolbar.is-bulk .icon-btn").first().click();

  const row = page.locator('[data-page-id="p"]');
  await row.hover();
  await row.locator('[aria-label="ページ名を変更"]').click();
  await row.locator("input.folder-rename").fill("Renamed page");
  await row.locator("input.folder-rename").press("Enter");
  await expect(row.locator(".page-label")).toContainText("Renamed page");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(row.locator(".page-label")).toContainText("P");

});


test("Folder rows drag between loose pages without up/down buttons", async ({ page, request }) => {
  const fixture = pageFolderFixture();
  delete fixture.pages.p.folderId;
  delete fixture.pages.q.folderId;
  const created = await request.post("/api/sites", { data: { name: "Interleaved page folders" } });
  expect(created.ok()).toBeTruthy();
  const { site } = await created.json();
  expect((await request.put(`/api/doc?site=${site.id}`, { data: fixture })).ok()).toBeTruthy();
  await page.addInitScript(() => localStorage.setItem("tsumu-help-seen-v1", "1"));
  await page.goto(`/sites/${site.id}`);
  await page.locator('[data-tutorial="left-tab-pages"]').click();
  await expect(page.locator(".folder-name")).toHaveText(["First", "Second", "Third"]);

  const order = () => page.locator(".pages-tab .panel-body > div > :is(.page-row, .page-folder)").evaluateAll((elements) =>
    elements.map((element) => element.classList.contains("page-folder")
      ? `folder:${element.querySelector(".folder-name")?.textContent?.trim()}`
      : `page:${element.getAttribute("data-page-id")}`)
  );
  expect(await order()).toEqual(["page:p", "page:q", "folder:First", "folder:Second", "folder:Third"]);
  await expect(page.locator(".folder-row button[aria-label='上へ'], .folder-row button[aria-label='下へ']")).toHaveCount(0);

  const first = page.locator(".page-folder").filter({ has: page.locator(".folder-name").filter({ hasText: /^First$/ }) })
    .locator(".folder-row");
  const q = page.locator('[data-page-id="q"]');
  const rect = await q.boundingBox();
  expect(rect).not.toBeNull();
  await first.dragTo(q, { targetPosition: { x: 20, y: Math.min(5, rect!.height / 4) } });
  await expect.poll(order).toEqual(["page:p", "folder:First", "page:q", "folder:Second", "folder:Third"]);

  const p = page.locator('[data-page-id="p"]');
  const pRect = await p.boundingBox();
  expect(pRect).not.toBeNull();
  await first.dragTo(p, { targetPosition: { x: 20, y: 3 } });
  await expect.poll(order).toEqual(["folder:First", "page:p", "page:q", "folder:Second", "folder:Third"]);
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(order).toEqual(["page:p", "folder:First", "page:q", "folder:Second", "folder:Third"]);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect.poll(order).toEqual(["folder:First", "page:p", "page:q", "folder:Second", "folder:Third"]);
});
});
