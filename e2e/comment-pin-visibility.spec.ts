import { expect, test } from "@playwright/test";

test("comment pins can be hidden with the panel toggle or while holding Alt", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("tsumu-help-seen-v1", "1"));
  const created = await page.request.post("/api/sites", { data: { name: "Comment pin visibility" } });
  expect(created.ok()).toBeTruthy(); const { site } = await created.json();
  await page.goto(`/sites/${site.id}`); await expect(page.getByText("サーバー保存済み")).toBeVisible();
  const { doc } = await (await page.request.get(`/api/doc?site=${site.id}`)).json();
  expect((await page.request.post(`/api/comments?site=${site.id}`, { data: {
    action: "create", id: `pin_${site.id}`, pageId: doc.pageOrder[0], nodeId: null, x: .5, y: .5, bp: "base", body: "Pinned discussion",
  } })).ok()).toBeTruthy();
  await page.getByRole("button", { name: "コメント", exact: true }).click();
  const pins = page.locator(".cm-pin:not(.is-draft)");
  await expect(pins).toHaveCount(1);

  const hide = page.getByRole("button", { name: "ピンを隠す", exact: true });
  await hide.click();
  await expect(pins).toHaveCount(0);
  const show = page.getByRole("button", { name: "ピンを表示", exact: true });
  await expect(show).toHaveAttribute("aria-pressed", "true");
  // 一覧もスレッドも隠れない。
  await expect(page.locator(".cm-item")).toHaveCount(1);
  await show.click();
  await expect(pins).toHaveCount(1);

  await page.keyboard.down("Alt");
  await expect(pins).toHaveCount(0);
  await page.keyboard.up("Alt");
  await expect(pins).toHaveCount(1);
});
