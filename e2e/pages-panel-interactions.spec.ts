import { expect, test } from "@playwright/test";
import { pageFolderFixture } from "../tests/helpers/page-folder-merge";

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
