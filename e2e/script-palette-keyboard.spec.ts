import { expect, test, type Page } from "@playwright/test";
import { scriptKeyboardBundle } from "../tests/helpers/script-keyboard";

let bundle: string;
test.beforeAll(async () => { bundle = await scriptKeyboardBundle(); });
const snapshot = (page: Page) => page.evaluate(() => {
  const { doc, past, future } = (window as any).scriptKeyboardEditor.getState();
  return { doc, past, future };
});

for (const locale of ["ja-JP", "en-US"]) test.describe(locale, () => {
  test.use({ locale });
  const labels = locale === "ja-JP"
    ? { title: "スクリプト", search: "操作を探す", clear: "検索をクリア", empty: "一致する操作がありません" }
    : { title: "Scripts", search: "Find an action", clear: "Clear search", empty: "No matching actions" };
  test.beforeEach(async ({ page }) => {
    // 言語の読み込みはクッキーを書くため、about:blank ではなく、横取りしたオリジンを使う。
    // アプリのサーバーも、外部へのリクエストも必要ない。
    await page.route("http://script-keyboard.test/", (route) => route.fulfill({
      contentType: "text/html", body: '<html><body><div id="app"></div></body></html>',
    }));
    await page.goto("http://script-keyboard.test/");
    await page.addScriptTag({ content: bundle });
    await expect(page.getByRole("dialog", { name: labels.title, exact: true })).toBeVisible();
  });

  for (const selected of [false, true]) test(`search Escape preserves focus, editor and selection (${selected})`, async ({ page }) => {
    const block = page.locator('.se-ws [data-sel-key="step:open"]');
    if (selected) await block.locator(".se-ico").first().click();
    const search = page.getByRole("searchbox", { name: labels.search });
    const cards = page.locator(".se-pal-item");
    const count = await cards.count();
    expect(count).toBeGreaterThan(0);
    const before = await snapshot(page);
    await search.fill("unmatched987654");
    await expect(page.getByRole("status")).toHaveText(labels.empty);
    await expect(page.getByRole("button", { name: labels.clear })).toBeVisible();
    await search.press("Escape");
    await expect(search).toHaveValue("");
    await expect(search).toBeFocused();
    await expect(cards).toHaveCount(count);
    await expect(page.getByRole("button", { name: labels.clear })).toHaveCount(0);
    if (selected) await expect(block).toHaveClass(/is-selected/);
    expect(await snapshot(page)).toEqual(before);
    // Escape を続けて押しても、フォーカスのある検索の欄が受け取る（欄が空でも同じ）。
    await search.press("Escape");
    await expect(search).toBeFocused();
    if (selected) await expect(block).toHaveClass(/is-selected/);
    // 画面の側の処理でも、閉じる前に選択を解除する。
    await search.blur();
    if (selected) {
      await page.keyboard.press("Escape");
      await expect(block).not.toHaveClass(/is-selected/);
    }
    await page.keyboard.press("Escape");
    await expect(page.locator(".se-backdrop")).toHaveCount(0);
    expect(await snapshot(page)).toEqual(before);
  });

  for (const composition of [{ isComposing: true }, { keyCode: 229 }]) test(`IME owns Escape: ${JSON.stringify(composition)}`, async ({ page }) => {
    const search = page.getByRole("searchbox", { name: labels.search });
    await search.fill("変換中");
    const before = await snapshot(page);
    // 作った変換中のフラグで振り分けを試す。OS の候補の画面は再現しない。
    const prevented = await search.evaluate((element, init) => {
      const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true, ...init });
      element.dispatchEvent(event);
      return event.defaultPrevented;
    }, composition);
    expect(prevented).toBe(false);
    await expect(search).toHaveValue("変換中");
    await expect(search).toBeFocused();
    expect(await snapshot(page)).toEqual(before);
    await search.press("Escape");
    await expect(search).toHaveValue("");
    await expect(search).toBeFocused();
  });
});
