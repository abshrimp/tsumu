import { expect, test, type Page } from "@playwright/test";
import { pageFolderFixture } from "../tests/helpers/page-folder-merge";

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
