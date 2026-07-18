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

test("画面幅の矢印キーを続けて押せて、上限・下限でも表示値と幅が一致する", async ({ page }) => {
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
  // 画面幅は整数に丸められる。フォーカスを保ったまま、その確定値を表示する。
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

test("数値スタイルの表示が元に戻す・やり直す・要素と画面幅の切り替えに追従する", async ({ page }) => {
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
  // キャンバスの通常クリックは、書き込み先を変える前に入力を確定する。
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

test.describe("数値欄の確定と外部更新", () => {
  let bundle: string;
  test.beforeAll(async () => { bundle = await numberFieldBundle(); });
  test.beforeEach(async ({ page }) => {
    await page.setContent('<html><body><div id="app"></div></body></html>');
    await page.addScriptTag({ content: bundle });
    await expect(page.locator("input")).toHaveValue("100");
  });

  test("Enter・blur・空欄・単位の換算後も確定値を表示する", async ({ page }) => {
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
    // 空欄の取り消しで保存値が変わらなくても表示を戻す。
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

  test("外部更新で入力中の文字を消さず、IME の矢印・Enterを数値操作に使わない", async ({ page }) => {
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


test.describe("数値欄の編集先の切り替え", () => {
  let bundle: string;
  test.beforeAll(async () => { bundle = await inspectorNumberBundle(); });
  for (const target of ["node", "same-value-node", "breakpoint", "state", "selection"] as const) {
    test(`blur 前に ${target} が変わっても未確定の数値を別の編集先へ書き込まない`, async ({ page }) => {
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
      // 通常の pointerdown/blur を通らない状態更新でも、入力の寿命を編集先に合わせる。
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
      // 切り替え後も、数値の連続入力は同じ欄で続けられる。
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
