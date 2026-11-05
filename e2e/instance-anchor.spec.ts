import { expect, test } from "@playwright/test";
import { scriptsFile } from "../lib/script-runtime";
import { anchorFixture, renderAnchorExport } from "../tests/helpers/instance-anchor";

// 書き出した実DOMで、アンカーと表示スクリプトが同じコンポーネントを指すことを確認する。
test("公開した使用箇所のアンカーと表示切替がマスターのレイアウトを保つ", async ({ page }) => {
  const doc = anchorFixture();
  const { html, css } = renderAnchorExport(doc);
  await page.setContent(html);
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: scriptsFile(doc) });
  await expect(page.locator("#first-card")).toHaveCount(1);
  await expect(page.locator("#second-card")).toHaveCount(1);
  await expect(page.locator("#first-card")).toBeHidden();
  await page.locator("#show").click();
  await expect(page.locator("#first-card")).toBeVisible();
  await expect(page.locator("#first-card")).toHaveCSS("display", "flex");
  await expect(page.locator("#second-card")).toBeHidden();
  await page.locator("#jump").click();
  await expect.poll(() => page.evaluate(() => location.hash)).toBe("#first-card");
  await expect(page.locator("div")).toHaveCount(2);
});
