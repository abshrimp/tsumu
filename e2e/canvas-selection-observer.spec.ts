import { expect, test } from "@playwright/test";
import { canvasMoveBundle } from "../tests/helpers/canvas-move";

test("selected overlay follows a flow-layout shift without an idle frame polling loop", async ({ page }) => {
  const bundle = await canvasMoveBundle();
  await page.setContent('<html><body><div id="app"></div></body></html>');
  await page.addScriptTag({ content: bundle });
  await expect(page.locator('.cv-root [data-node="c"]')).toBeVisible();

  await page.evaluate(() => (window as any).canvasMoveEditor.getState().select("c"));
  const overlay = page.locator(".sel-overlay");
  await expect(overlay).toBeVisible();
  const original = await overlay.boundingBox();
  expect(original).not.toBeNull();

  // 前の兄弟を変えると、"c" 自身は変えずに "c" が動く。
  await page.evaluate(() =>
    (window as any).canvasMoveEditor.getState().setStyleProps("a", { height: "250px" })
  );
  await expect.poll(async () => (await overlay.boundingBox())?.y ?? 0)
    .toBeGreaterThan(original!.y + 80);

  // 大きさを直接変えた場合も、ResizeObserver が選択の表示を正確に保つ。
  await page.evaluate(() =>
    (window as any).canvasMoveEditor.getState().setStyleProps("c", { height: "210px" })
  );
  await expect.poll(async () => (await overlay.boundingBox())?.height ?? 0)
    .toBeGreaterThan(original!.height + 80);
});
