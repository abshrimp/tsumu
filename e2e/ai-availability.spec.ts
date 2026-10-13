import { expect, test } from "@playwright/test";

test("AI availability is checked once per editor load, not on focus", async ({ page }) => {
  const created = await page.request.post("/api/sites", { data: { name: "AI availability" } });
  expect(created.ok()).toBeTruthy();
  const { site } = await created.json() as { site: { id: string } };

  let checks = 0;
  await page.route("**/api/ai", (route) => {
    if (route.request().method() !== "GET") return route.continue();
    checks++;
    return route.fulfill({ json: { enabled: false, provider: null, model: null } });
  });

  await page.goto(`/sites/${site.id}`);
  await expect(page.locator('[data-tutorial="canvas"]')).toBeVisible();
  await expect.poll(() => checks).toBe(1);

  // Returning to this tab or window must not request the same configuration again.
  await page.evaluate(() => {
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("focus"));
  });
  await page.waitForTimeout(200);
  expect(checks).toBe(1);

  // A full reload starts a new editor session and checks the setting again.
  await page.reload();
  await expect(page.locator('[data-tutorial="canvas"]')).toBeVisible();
  await expect.poll(() => checks).toBe(2);
});
