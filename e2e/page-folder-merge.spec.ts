import { expect, test, type Page } from "@playwright/test";
import { pageFolderBundle } from "../tests/helpers/page-folder-merge";

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
  test(`別フォルダの改名を${receiveAfterUndo ? "Undo後" : "編集中"}に受信しても履歴に残す`, async ({ page }) => {
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

test("同時に作ったフォルダと移動したページを、作成・移動のUndo後も残す", async ({ page }) => {
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

test("フォルダのドラッグ並べ替えと別フォルダの改名を両方残す", async ({ page }) => {
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

test("フォルダ削除のUndoとRedoは他のフォルダの改名を取り消さない", async ({ page }) => {
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
