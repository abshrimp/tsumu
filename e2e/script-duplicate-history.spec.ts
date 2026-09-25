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
    const target = page.locator(kind === "script"
      ? '.se-ws [data-sel-key="script:script"]'
      : '.se-ws [data-sel-key="step:open"]');
    const before = await pageScripts(page);
    await target.click({ button: "right" });
    await page.locator(".se-menu button").first().click();
    const after = await pageScripts(page);
    if (kind === "script") {
      expect(after).toHaveLength(before.length + 1);
    } else {
      expect(after[0].steps).toHaveLength(before[0].steps.length + 1);
    }
    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(() => pageScripts(page)).toEqual(before);
    // The selection points at the now-removed cloned ID. Delete must not
    // turn this stale UI selection into an unrelated document edit.
    await expect(page.locator(".se-ws .is-selected")).toHaveCount(0);
    await page.keyboard.press("Delete");
    await expect.poll(() => pageScripts(page)).toEqual(before);
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect.poll(() => pageScripts(page)).toEqual(after);
  });
}
