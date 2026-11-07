import { expect, test, type Page } from "@playwright/test";
import { makeText } from "../lib/presets";
import type { SiteDoc } from "../lib/types";

async function openSite(page: Page) {
  await page.addInitScript(() => localStorage.setItem("tsumu-help-seen-v1", "1"));
  const response = await page.request.post("/api/sites", { data: { name: "Text editing integrity" } });
  expect(response.ok()).toBeTruthy();
  const { site } = await response.json();
  const doc: SiteDoc = {
    siteName: "Text editing integrity", assets: {}, pageOrder: ["home"],
    pages: { home: { id: "home", name: "Home", title: "Home", description: "", slug: "", children: ["text"] } },
    nodes: { text: { ...makeText("Before"), id: "text" } },
  };
  expect((await page.request.put(`/api/doc?site=${site.id}`, { data: doc })).ok()).toBeTruthy();
  await page.goto(`/sites/${site.id}`);
  await expect(page.locator('[data-node="text"]')).toBeVisible();
  await expect(page.locator('[data-tutorial="save-status"]')).toContainText("サーバー保存済み");
  return site.id as string;
}

const textNode = (page: Page) => page.locator('[data-node="text"]');
const editing = (page: Page) => page.locator('[data-node="text"][data-rich-edit="true"]');
async function savedText(page: Page, siteId: string, content: string) {
  await expect.poll(async () => {
    const saved = await (await page.request.get(`/api/doc?site=${siteId}`)).json();
    return saved.doc.nodes.text.text.content;
  }).toBe(content);
  await expect.poll(() => page.evaluate((siteId) => {
    const doc = JSON.parse(localStorage.getItem(`tsumu-doc-v1:${siteId}`) ?? "null");
    return doc?.nodes.text.text.content;
  }, siteId)).toBe(content);
}

async function roundTrip(page: Page, siteId: string, content: string) {
  await savedText(page, siteId, content);
  for (let repeat = 0; repeat < 3; repeat++) {
    await textNode(page).dblclick();
    await expect(editing(page)).toBeFocused();
    expect(await editing(page).textContent()).toBe(content);
    await page.keyboard.press("Escape");
    await expect(editing(page)).toHaveCount(0);
    expect(await textNode(page).textContent()).toBe(content);
  }
  await savedText(page, siteId, content);
  await page.getByRole("button", { name: "元に戻す", exact: true }).click();
  await expect.poll(() => textNode(page).textContent()).toBe("Before");
  await page.getByRole("button", { name: "やり直す", exact: true }).click();
  await expect.poll(() => textNode(page).textContent()).toBe(content);
  await savedText(page, siteId, content);
  await page.reload();
  await expect.poll(() => textNode(page).textContent()).toBe(content);
}

test("Enterで入れた末尾の改行を編集終了・無変更の再編集・保存後も残す", async ({ page }) => {
  const siteId = await openSite(page);
  await textNode(page).dblclick();
  await editing(page).fill("First line");
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Second line");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  const content = "First line\nSecond line\n\n";
  expect(await editing(page).textContent()).toBe(content);
  await expect(editing(page).locator("br[data-end]")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await roundTrip(page, siteId, content);
});

test("キャンバスの文章編集で、変数候補は候補内操作では残り外側操作で閉じる", async ({ page }) => {
  await openSite(page);
  await textNode(page).dblclick();
  await expect(editing(page)).toBeFocused();
  await editing(page).press("Control+/");
  const menu = page.locator(".var-comp");
  await expect(menu).toBeVisible();

  await menu.locator(".var-comp-list").evaluate((list) => {
    list.scrollTop += 10;
    list.dispatchEvent(new Event("scroll"));
  });
  await expect(menu).toBeVisible();
  await page.locator(".canvas-area").click({ position: { x: 8, y: 8 } });
  await expect(menu).toHaveCount(0);

  await expect(editing(page)).toBeVisible();
  await editing(page).focus();
  await editing(page).press("Control+/");
  await expect(menu).toBeVisible();
  await editing(page).press("Escape");
  await expect(menu).toHaveCount(0);
});

test("変数チップと末尾改行を含む貼り付けを編集内Undo・Redoと保存で壊さない", async ({ page }) => {
  const siteId = await openSite(page);
  await textNode(page).dblclick();
  const content = "<&>\nHello {profile.name}\n\n";
  await editing(page).evaluate((el, text) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", text);
    el.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
  }, content);
  expect(await editing(page).textContent()).toBe(content);
  await expect(editing(page).locator(".cv-tok")).toHaveText("{profile.name}");
  await page.keyboard.press("ControlOrMeta+z");
  expect(await editing(page).textContent()).toBe("Before");
  await page.keyboard.press("ControlOrMeta+Shift+z");
  expect(await editing(page).textContent()).toBe(content);
  await page.keyboard.press("Escape");
  await roundTrip(page, siteId, content);
});
