import { expect, test, type Page } from "@playwright/test";
import { inspectorNumberBundle, numberFieldBundle } from "../tests/helpers/number-field";

async function openSite(page: Page) {
  await page.addInitScript(() => localStorage.setItem("tsumu-help-seen-v1", "1"));
  const response = await page.request.post("/api/sites", { data: { name: "Numeric keyboard controls" } });
  expect(response.ok()).toBeTruthy();
  const { site } = await response.json();
  await page.goto(`/sites/${site.id}`);
  await expect(page.locator('[data-tutorial="canvas-width"] input')).toBeVisible();
}

test("Repeated breakpoint arrow-key input stays in sync with width at both limits", async ({ page }) => {
  await openSite(page);
  const input = page.locator('[data-tutorial="canvas-width"] input');
  const frame = page.locator(".canvas-frame");
  await input.fill("800");
  await page.keyboard.press("Enter");
  await input.focus();
  for (const value of [801, 802]) {
    await page.keyboard.press("ArrowUp");
    await expect(input).toHaveValue(String(value));
    await expect(input).toBeFocused();
    await expect(frame).toHaveCSS("width", `${value}px`);
  }
  await page.keyboard.press("Shift+ArrowDown");
  await expect(input).toHaveValue("792");
  await expect(input).toBeFocused();
  // Breakpoint widths are rounded to integers; show the committed value without losing focus.
  await input.fill("800.5");
  await page.keyboard.press("ArrowUp");
  await expect(input).toHaveValue("802");
  await expect(input).toBeFocused();
  await expect(frame).toHaveCSS("width", "802px");

  for (const [limit, key, nextKey, next] of [
    [3000, "ArrowUp", "ArrowDown", 2999],
    [240, "ArrowDown", "ArrowUp", 241],
  ] as const) {
    await input.fill(String(limit));
    await page.keyboard.press("Enter");
    await input.focus();
    await page.keyboard.press(key);
    await expect(input).toHaveValue(String(limit));
    await expect(input).toBeFocused();
    await expect(frame).toHaveCSS("width", `${limit}px`);
    await page.keyboard.press(nextKey);
    await expect(input).toHaveValue(String(next));
    await expect(input).toBeFocused();
    await expect(frame).toHaveCSS("width", `${next}px`);
  }
});

test("Numeric style inputs follow Undo, Redo, and node/breakpoint target changes", async ({ page }) => {
  await openSite(page);
  const layers = page.locator('[data-tutorial="layers-panel"]');
  const heading = layers.locator(".layer-name").filter({ hasText: "見出しをここに" });
  await expect(heading).toHaveCount(1);
  await heading.click();
  await page.locator('[data-tutorial="right-tab-style"]').click();
  const font = page.locator('[data-tutorial="style-typography"] .grp')
    .filter({ has: page.locator(".grp-label", { hasText: /^サイズ$/ }) }).locator("input");
  await font.fill("40");
  await page.keyboard.press("Enter");
  await font.focus();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await expect(font).toHaveValue("42");
  await expect(font).toBeFocused();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "元に戻す", exact: true }).click();
  await expect(font).toHaveValue("41");
  await page.getByRole("button", { name: "やり直す", exact: true }).click();
  await expect(font).toHaveValue("42");
  // A normal canvas click commits the pending input before switching its edit target.
  await font.fill("43");
  await page.locator('[data-tutorial="canvas"]').getByText("はじめる", { exact: true }).click();
  await expect(font).not.toHaveValue("43");
  await heading.click();
  await expect(font).toHaveValue("43");
  await font.fill("42");
  await page.keyboard.press("Enter");
  await page.locator('[data-tutorial="breakpoint-sm"]').click();
  await font.fill("80");
  await page.keyboard.press("Enter");
  await page.locator('[data-tutorial="breakpoint-base"]').click();
  await expect(font).toHaveValue("42");
  await page.locator('[data-tutorial="breakpoint-sm"]').click();
  await expect(font).toHaveValue("80");
});

test.describe("Numeric field commits and external updates", () => {
  let bundle: string;
  test.beforeAll(async () => { bundle = await numberFieldBundle(); });
  test.beforeEach(async ({ page }) => {
    await page.setContent('<html><body><div id="app"></div></body></html>');
    await page.addScriptTag({ content: bundle });
    await expect(page.locator("input")).toHaveValue("100");
  });

  test("Committed values remain visible after Enter, blur, clearing, and unit conversions", async ({ page }) => {
    const input = page.locator("input");
    const stored = page.locator("#stored");
    await input.fill("0012.50");
    await page.keyboard.press("Enter");
    await expect(input).toHaveValue("12.5");
    await expect(stored).toHaveText("12.5px");
    await expect(input).not.toBeFocused();
    await input.fill("");
    await page.keyboard.press("Enter");
    await expect(input).toHaveValue("100");
    await expect(stored).toHaveText("100px");
    // Restore the display after clearing even if the stored value remains unchanged.
    await input.fill("");
    await page.locator("#outside").click();
    await expect(input).toHaveValue("100");
    await input.fill("200");
    await page.locator("#outside").click();
    await expect(stored).toHaveText("200px");
    await page.locator(".field-unit").click();
    await expect(input).toHaveValue("12.5");
    await expect(stored).toHaveText("12.5rem");
    await input.focus();
    await page.keyboard.press("ArrowUp");
    await expect(input).toHaveValue("13.5");
    await expect(stored).toHaveText("13.5rem");
    await expect(input).toBeFocused();
  });

  test("External changes preserve draft text, and IME arrow/Enter keys do not edit numbers", async ({ page }) => {
    const input = page.locator("input");
    const stored = page.locator("#stored");
    await input.focus();
    await page.evaluate(() => (window as any).setNumberFieldValue("600px"));
    await expect(input).toHaveValue("600");
    await input.fill("42");
    await page.evaluate(() => (window as any).setNumberFieldValue("700px"));
    await expect(input).toHaveValue("42");
    await expect(input).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(stored).toHaveText("42px");
    await input.fill("12");
    for (const composing of [{ isComposing: true }, { keyCode: 229 }]) {
      await input.dispatchEvent("keydown", { key: "ArrowUp", ...composing });
      await input.dispatchEvent("keydown", { key: "Enter", ...composing });
      await expect(input).toHaveValue("12");
      await expect(input).toBeFocused();
      await expect(stored).toHaveText("42px");
    }
    await page.keyboard.press("Enter");
    await expect(stored).toHaveText("12px");
  });
});


test.describe("Numeric field target changes", () => {
  let bundle: string;
  test.beforeAll(async () => { bundle = await inspectorNumberBundle(); });
  for (const target of ["node", "same-value-node", "breakpoint", "state", "selection"] as const) {
    test(`Changing ${target} before blur never commits an unfinished number to a different target`, async ({ page }) => {
      await page.setContent('<html><body><div id="app"></div></body></html>');
      await page.addScriptTag({ content: bundle });
      const font = page.locator('[data-tutorial="style-typography"] .grp')
        .filter({ has: page.locator(".grp-label", { hasText: /^サイズ$/ }) }).locator("input");
      await expect(font).toHaveValue("40");
      if (target === "same-value-node") {
        await page.evaluate(() => (window as any).numericInspector.getState().setStyleProps("b", { fontSize: "40px" }));
      }
      const before = await page.evaluate(() => (window as any).numericInspector.getState().doc.nodes);
      await font.fill("77");
      await font.evaluate((input) => { (window as any).oldNumericInput = input; });
      // Keep the draft tied to its target even when the state changes without pointerdown/blur.
      await page.evaluate((target) => {
        const state = (window as any).numericInspector.getState();
        if (target === "node" || target === "same-value-node") state.select("b");
        else if (target === "breakpoint") state.setBreakpoint("sm");
        else if (target === "state") state.setStyleState("hover");
        else state.selectMany(["a", "b"], "a");
      }, target);
      const shown = target === "node" || target === "breakpoint" ? "20" : target === "state" ? "30" : "40";
      await expect(font).toHaveValue(shown);
      expect(await page.evaluate(() => (window as any).oldNumericInput.isConnected)).toBe(false);
      await font.focus();
      await page.keyboard.press("Enter");
      expect(await page.evaluate(() => (window as any).numericInspector.getState().doc.nodes)).toEqual(before);
      // After switching targets, continuous numeric input still works in the same field.
      await font.focus();
      await page.keyboard.press("ArrowUp");
      await expect(font).toHaveValue(String(Number(shown) + 1));
      await expect(font).toBeFocused();
      await page.keyboard.press("ArrowUp");
      await expect(font).toHaveValue(String(Number(shown) + 2));
      await expect(font).toBeFocused();
    });
  }
});
