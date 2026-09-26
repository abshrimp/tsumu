import { expect, test, type Page } from "@playwright/test";
import { scriptKeyboardBundle } from "../tests/helpers/script-keyboard";

let bundle: string;
test.beforeAll(async () => { bundle = await scriptKeyboardBundle(); });
test.beforeEach(async ({ page }) => {
  await page.goto("/robots.txt");
  await page.setContent('<html><body><div id="app"></div></body></html>');
  await page.addScriptTag({ content: bundle });
  await expect(page.getByRole("dialog", { name: "スクリプト", exact: true })).toBeVisible();
});

async function pageScripts(page: Page) {
  return page.evaluate(() => (window as any).scriptKeyboardEditor.getState().doc.pages.p.pageScripts);
}

for (const kind of ["script", "step"] as const) {
  test(`Duplicate ${kind}: undo clears stale selection, and redo restores one edit`, async ({ page }) => {
    const before = await pageScripts(page);
    // スクリプトは左の一覧の「…」から、動作はカードの「…」から複製する
    const more = kind === "script"
      ? page.locator('.se-side-item:has([data-script-id="script"]) .se-side-more')
      : page.locator('.se-card[data-step-id="open"] .se-card-more');
    await more.click();
    await page.locator(".se-menu button", { hasText: "複製" }).click();
    const after = await pageScripts(page);
    if (kind === "script") {
      expect(after).toHaveLength(before.length + 1);
    } else {
      expect(after[0].steps).toHaveLength(before[0].steps.length + 1);
    }
    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(() => pageScripts(page)).toEqual(before);
    // 選択は、元に戻して消えた複製の ID を指していた。Delete がそれを、
    // 関係の無い文書の編集に変えてはいけない。
    await expect(page.locator(".se-flow .is-selected")).toHaveCount(0);
    // 開いていた複製が消えても、きっかけを選ぶ画面には戻らず、元のスクリプトを開く
    await expect(page.locator(".se-when")).toBeVisible();
    await page.keyboard.press("Delete");
    await expect.poll(() => pageScripts(page)).toEqual(before);
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect.poll(() => pageScripts(page)).toEqual(after);
  });
}
