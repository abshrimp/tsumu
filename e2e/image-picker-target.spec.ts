import { expect, test } from "@playwright/test";
import { imagePickerBundle } from "../tests/helpers/image-picker-browser";

test("a URL draft cannot move to another page with the same saved image", async ({ page }) => {
  await page.setContent('<div id="app"></div>');
  await page.addScriptTag({ content: await imagePickerBundle() });
  const input = page.locator(".img-pick-row input");
  await input.fill("/draft-a.png");
  // 共同編集やキーボードでの選択では、先に入力欄が blur しないまま、対象が変わることがある。
  await page.locator("#switch").evaluate((el: HTMLButtonElement) => el.click());
  await expect(page.locator("#target")).toHaveText("b");
  await expect(input).toHaveValue("/same.png");
  await input.fill("/chosen-b.png");
  await input.press("Tab");
  await expect(page.locator("#values")).toHaveText(JSON.stringify({a:{url:"/same.png"},b:{url:"/chosen-b.png"}}));
});
test("a filtered asset picker remains recoverable after assets disappear", async ({ page }) => {
  await page.setContent('<div id="app"></div>');
  await page.addScriptTag({ content: await imagePickerBundle() });
  const grid = page.locator("#grid");
  await grid.getByRole("searchbox").fill("not-found");
  await page.locator("#shrink").click();
  await expect(grid.getByRole("searchbox")).toBeVisible();
  await grid.getByRole("button", { name: "検索をクリア" }).click();
  await expect(grid.locator(".img-pick-cell")).toHaveCount(3);
});
