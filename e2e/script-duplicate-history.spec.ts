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


test("copied script actions survive text-copy attempts and remain pasteable in another tab", async ({ page, context }) => {
  const card = page.locator('.se-card[data-step-id="open"]');
  await card.click({ position: { x: 5, y: 4 } });
  await expect(card).toHaveClass(/is-selected/);
  const raw = await page.evaluate(() => {
    const data = new DataTransfer();
    const event = new ClipboardEvent("copy", { bubbles: true, cancelable: true, clipboardData: data });
    window.dispatchEvent(event);
    if (!event.defaultPrevented) throw new Error("Action copy not handled");
    return data.getData("text/plain");
  });
  expect(raw).toMatch(/^Tsumu script actions v2\n/);

  // 入力欄のコピーイベントでメモリ上の控えが消えても、OSのコピーは残り得る。
  await page.evaluate(() => {
    const input = document.createElement("input");
    document.body.append(input);
    input.focus();
    input.dispatchEvent(new ClipboardEvent("copy", {
      bubbles: true, cancelable: true, clipboardData: new DataTransfer(),
    }));
    input.remove();
  });
  const pastedAfterInput = await page.evaluate((text) => {
    const data = new DataTransfer();
    data.setData("text/plain", text);
    const event = new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  }, raw);
  expect(pastedAfterInput).toBe(true);
  await expect(page.locator('.se-card[data-step-kind="open-page"]')).toHaveCount(2);

  // もう1つのタブにはモジュール内のコピー控えがない。保存済みのコピーとの照合で復元する。
  const other = await context.newPage();
  try {
    await other.goto("/robots.txt");
    await other.setContent('<html><body><div id="app"></div></body></html>');
    await other.addScriptTag({ content: bundle });
    await expect(other.getByRole("dialog", { name: "スクリプト", exact: true })).toBeVisible();
    await other.evaluate((text) => {
      (window as any).__scriptClipboardText = text;
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { readText: async () => (window as any).__scriptClipboardText },
      });
    }, raw);

    // ツールバーの貼り付けも非同期 Clipboard API から現在の内容を読む。
    await other.locator('.se-header [aria-label="貼り付け"]').click();
    await expect(other.locator('.se-card[data-step-kind="open-page"]')).toHaveCount(2);

    // OS側でほかの文字列をコピーしたら、古いブロックを誤貼り付けしない。
    await other.evaluate(() => { (window as any).__scriptClipboardText = "ordinary text"; });
    await other.locator('.se-header [aria-label="貼り付け"]').click();
    await expect(other.locator('.se-card[data-step-kind="open-page"]')).toHaveCount(2);

    await other.evaluate((text) => { (window as any).__scriptClipboardText = text; }, raw);
    const pastedInOtherTab = await other.evaluate((text) => {
      const data = new DataTransfer();
      data.setData("text/plain", text);
      const event = new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    }, raw);
    expect(pastedInOtherTab).toBe(true);
    await expect(other.locator('.se-card[data-step-kind="open-page"]')).toHaveCount(3);
  } finally {
    await other.close();
  }
});
