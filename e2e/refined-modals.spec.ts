import { expect, test } from "@playwright/test";

test("home settings and site creation keep actions visible on narrow screens", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 620 });
  await page.goto("/");

  await page.locator(".home-top-actions button").filter({ hasText: /設定|Settings/ }).click();
  const settings = page.locator(".app-settings-modal");
  await expect(settings).toBeVisible();
  await expect(settings.locator(".modal-refined-header")).toBeVisible();
  await expect(settings.locator(".modal-refined-actions")).toBeVisible();
  await expect(settings.locator(".modal-refined-body")).toHaveCSS("overflow-y", "auto");
  expect(await settings.evaluate(element => {
    const box = element.getBoundingClientRect();
    return box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight;
  })).toBe(true);
  await settings.locator(".modal-refined-actions button").click();

  await page.locator(".home-head-actions .btn-primary").click();
  const form = page.locator("form.home-dialog");
  await expect(form.locator(".modal-refined-header")).toBeVisible();
  await expect(form.locator(".modal-refined-body")).toHaveCSS("overflow-y", "auto");
  await expect(form.locator(".modal-refined-actions button[type=submit]")).toBeVisible();
  const destination = form.locator("details.home-dest");
  if (await destination.count()) {
    await destination.locator("summary").click();
    await form.locator(".modal-refined-body").evaluate(element => { element.scrollTop = element.scrollHeight; });
    await expect(form.locator(".modal-refined-actions button[type=submit]")).toBeInViewport();
  }
  expect(await form.evaluate(element => {
    const box = element.getBoundingClientRect();
    return box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight;
  })).toBe(true);
});

test("dialog scroll regions do not overflow horizontally on narrow screens", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 480 });
  await page.goto("/");
  await page.locator(".home-head-actions .btn-primary").click();
  const form = page.locator("form.home-dialog");
  await expect(form).toBeVisible();
  expect(await form.evaluate(element => {
    const body = element.querySelector<HTMLElement>(".modal-refined-body")!;
    return body.scrollWidth <= body.clientWidth + 1;
  })).toBe(true);
});
