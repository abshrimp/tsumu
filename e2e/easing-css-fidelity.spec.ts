import { expect, test } from "@playwright/test";
import { easingEditorBundle } from "../tests/helpers/motion-editor-browser";

for (const source of [
  "cubic-bezier(0.123456, 0.000001, 0.876543, 1.234567)",
  "cubic-bezier(1e-8, -2e-7, 0.9, 1.000001)",
  "steps(2.0)",
]) test(`opening and applying easing preserves CSS: ${source}`, async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.setContent('<div id="app"></div>');
  await page.addStyleTag({ path: "app/globals.css" });
  await page.addScriptTag({ content: await easingEditorBundle(source) });
  const computed = () => page.locator("#easing-probe").evaluate(el => getComputedStyle(el).transitionTimingFunction);
  await expect(page.locator(".ee-modal")).toBeVisible();
  const before = await computed();
  for (let pass = 0; pass < 2; pass++) {
    await page.getByRole("button", { name: "適用", exact: true }).click();
    await expect(page.locator(".ee-modal")).toHaveCount(0);
    await expect.poll(computed).toBe(before);
    if (source === "steps(2.0)") await expect(page.locator("#saved")).toHaveText(source);
    if (pass === 0) await page.locator("#reopen").click();
  }
  expect(errors).toEqual([]);
});
