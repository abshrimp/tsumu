import { expect, test } from "@playwright/test";

test("MCP connection has its own editor menu dialog, not a Settings section", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("tsumu-help-seen-v1", "1"));
  const response = await page.request.post("/api/sites", { data: { name: "MCP menu" } });
  expect(response.ok()).toBeTruthy();
  const { site } = await response.json();

  await page.goto(`/sites/${site.id}`);
  await expect(page.locator('[data-tutorial="menu"] > button')).toBeVisible();
  await page.locator('[data-tutorial="menu"] > button').click();
  const menuItems = page.locator(".dd-menu .dd-item");
  await expect(menuItems.filter({ hasText: "MCP接続" })).toBeVisible();
  await menuItems.filter({ hasText: "MCP接続" }).click();

  await expect(page.locator(".modal-backdrop .modal > h2")).toHaveText("MCP接続");
  await expect(page.locator(".modal-backdrop .settings-sec h3")).toHaveText("AIと接続");
  await expect(page.getByRole("button", { name: "接続を開始" })).toBeVisible();
  await page.locator(".modal-backdrop .modal-actions button").click();
  await expect(page.locator(".modal-backdrop")).toHaveCount(0);

  await page.locator('[data-tutorial="menu"] > button').click();
  await page.locator(".dd-menu .dd-item").filter({ hasText: "設定" }).click();
  await expect(page.locator(".modal-backdrop .modal > h2")).toHaveText("設定");
  await expect(page.locator(".modal-backdrop").getByRole("heading", { name: "AIと接続" })).toHaveCount(0);
});
