import { expect, test } from "@playwright/test";
import { scriptsFile } from "../lib/script-runtime";
import { anchorFixture, renderAnchorExport } from "../tests/helpers/instance-anchor";

// 書き出した DOM を使い、アンカーへの移動と表示を切り替えるスクリプトが、同じコンポーネントを対象にすることを確かめる。
test("Published instance anchors and visibility toggles preserve the master's layout", async ({ page }) => {
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
