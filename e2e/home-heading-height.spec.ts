import { expect, test } from "@playwright/test";

test("home heading keeps the same height in Japanese and English", async ({ page }) => {
  await page.goto("/");
  const heights: number[] = [];
  for (const [lang, heading] of [["ja", "サイト"], ["en", "Site"]] as const) {
    await page.evaluate((value) => localStorage.setItem("tsumu-lang", value), lang);
    await page.reload();
    const title = page.locator(".home-head h1");
    await expect(title).toHaveText(heading);
    heights.push(await title.evaluate((element) => element.getBoundingClientRect().height));
  }

  expect(heights[0]).toBeCloseTo(heights[1], 1);
});
