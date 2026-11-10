import { expect, test } from "@playwright/test";
import { dialogFocusBundle } from "../tests/helpers/dialog-focus";

let bundle: string;
test.beforeAll(async () => { bundle = await dialogFocusBundle(); });
test.beforeEach(async ({ page }) => {
  // loadLocale writes a language cookie; about:blank has an opaque origin.
  // Use the running test server's plain-text endpoint before injecting the fixture.
  await page.goto("/robots.txt");
  await page.setContent('<div id="app"></div>');
  await page.addScriptTag({ content: bundle });
  await expect(page.locator("#confirm")).toBeVisible();
});

for (const locale of ["ja-JP", "en-US"]) test.describe(locale, () => {
  test.use({ locale });
  const cancelName = locale === "ja-JP" ? "キャンセル" : "Cancel";
  const promptName = locale === "ja-JP" ? "入力してください" : "Enter a value";

  test("keyboard confirmation stays modal and restores its trigger", async ({ page }) => {
    await page.keyboard.press("Tab");
    await expect(page.locator("#confirm")).toBeFocused();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog");
    const cancel = dialog.getByRole("button", { name: cancelName, exact: true });
    const ok = dialog.getByRole("button", { name: "OK", exact: true });
    await expect(cancel).toBeFocused();
    await page.keyboard.press("Shift+Tab"); await expect(ok).toBeFocused();
    await page.keyboard.press("Tab"); await expect(cancel).toBeFocused();
    await page.keyboard.press("Tab"); await expect(ok).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(page.locator("#confirm")).toBeFocused();
    await expect(page.locator("#results")).toHaveText("[false]");
    await expect(page.getByRole("textbox", { name: "Background name" })).toHaveValue("unchanged");
  });

  test("prompt is named, skips disabled OK, and preserves IME input", async ({ page }) => {
    await page.locator("#prompt").focus(); await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog");
    const input = dialog.getByRole("textbox", { name: promptName, exact: true });
    const cancel = dialog.getByRole("button", { name: cancelName, exact: true });
    const ok = dialog.getByRole("button", { name: "OK", exact: true });
    await expect(input).toBeFocused(); await expect(input).toHaveAccessibleDescription("Type DELETE");
    await expect(ok).toBeDisabled();
    await page.keyboard.press("Shift+Tab"); await expect(cancel).toBeFocused();
    await page.keyboard.press("Tab"); await expect(input).toBeFocused();
    await input.dispatchEvent("compositionstart"); await input.fill("日本語");
    for (const init of [{ isComposing: true }, { keyCode: 229 }]) {
      for (const key of ["Enter", "Escape"]) await input.dispatchEvent("keydown", { key, ...init });
      await expect(input).toBeFocused(); await expect(input).toHaveValue("日本語");
      await expect(page.locator("#results")).toHaveText("[]");
    }
    await input.dispatchEvent("compositionend", { data: "日本語" });
    await input.fill("DELETE"); await expect(ok).toBeEnabled();
    await page.keyboard.press("Shift+Tab"); await expect(ok).toBeFocused();
    await page.keyboard.press("Tab"); await expect(input).toBeFocused();
    await page.keyboard.press("Enter"); await expect(dialog).toHaveCount(0);
    await expect(page.locator("#prompt")).toBeFocused();
    await expect(page.locator("#results")).toHaveText('["DELETE"]');
  });

  test("queued dialogs keep focus through the transition and return it after the last closes", async ({ page }) => {
    await page.locator("#queue").focus(); await page.keyboard.press("Enter");
    await page.getByRole("dialog").getByRole("button", { name: cancelName, exact: true }).click();
    const alert = page.getByRole("alertdialog");
    const ok = alert.getByRole("button", { name: "OK", exact: true });
    await expect(ok).toBeFocused();
    for (const key of ["Tab", "Shift+Tab", "Tab"]) {
      await page.keyboard.press(key); await expect(ok).toBeFocused();
    }
    await page.keyboard.press("Enter"); await expect(alert).toHaveCount(0);
    await expect(page.locator("#queue")).toBeFocused();
    await expect(page.locator("#results")).toHaveText('[false,"second"]');
  });
});

test.describe("touch", () => {
  test.use({ hasTouch: true });
  test("touch can acknowledge an alert without trapping later keyboard navigation", async ({ page }) => {
    await page.locator("#alert").tap();
    const alert = page.getByRole("alertdialog");
    await alert.getByRole("button", { name: "OK", exact: true }).tap();
    await expect(alert).toHaveCount(0);
    await expect(page.locator("#results")).toHaveText('["acknowledged"]');
    await page.locator("#confirm").focus(); await page.keyboard.press("Tab");
    await expect(page.locator("#prompt")).toBeFocused();
  });
});
