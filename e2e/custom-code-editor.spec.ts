import { expect, test } from "@playwright/test";

test("site head and body code can be edited together, and cancelling discards edits", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("tsumu-help-seen-v1", "1"));
  const response = await page.request.post("/api/sites", { data: { name: "Custom code editor" } });
  expect(response.ok()).toBeTruthy();
  const { site } = (await response.json()) as { site: { id: string } };
  await page.goto("/sites/" + site.id);
  await page.locator('[data-tutorial="left-tab-site"]').click();
  const section = page.locator('[data-tutorial="site-code"]');
  await section.getByRole("button", { name: "コードエディタで編集" }).click();
  const dialog = page.getByRole("dialog", { name: /コードエディタ/ });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("textbox", { name: "head内コード" }).fill('<meta name="test" content="head">');
  await dialog.getByRole("button", { name: "body末尾コード" }).click();
  await dialog.getByRole("textbox", { name: "body末尾コード" }).fill('<script>window.value = 42;</script>');
  await dialog.getByRole("button", { name: "適用" }).click();
  await expect(dialog).toHaveCount(0);
  await section.locator(".sec-title").click();
  await expect(page.locator("#site-head-code")).toHaveValue('<meta name="test" content="head">');
  await expect(page.locator("#site-body-code")).toHaveValue('<script>window.value = 42;</script>');
  await section.getByRole("button", { name: "コードエディタで編集" }).click();
  await dialog.getByRole("textbox", { name: "head内コード" }).fill("discard");
  await dialog.getByRole("button", { name: "キャンセル" }).click();
  await expect(page.locator("#site-head-code")).toHaveValue('<meta name="test" content="head">');
});

test("HTML page code can be edited in a larger modal", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("tsumu-help-seen-v1", "1"));
  const response = await page.request.post("/api/sites", { data: { name: "HTML page editor" } });
  expect(response.ok()).toBeTruthy();
  const { site } = (await response.json()) as { site: { id: string } };
  await page.goto("/sites/" + site.id);
  const section = page.locator('[data-tutorial="page-code"]');
  await section.locator(".sec-title").click();
  await section.locator(".seg").getByRole("button", { name: "HTML", exact: true }).click();
  const confirm = page.getByRole("button", { name: "切り替え", exact: true });
  if (await confirm.isVisible()) await confirm.click();
  await section.getByRole("button", { name: "コードエディタで編集" }).click();
  const dialog = page.getByRole("dialog", { name: /コードエディタ/ });
  const html = '<!doctype html>\n<html><body><p>custom</p></body></html>';
  await dialog.getByRole("textbox", { name: "HTMLコード" }).fill(html);
  await dialog.getByRole("button", { name: "適用" }).click();
  await expect(page.locator('[id$="-rawhtml"]')).toHaveValue(html);
});
