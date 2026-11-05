import { expect, test, type Page } from "@playwright/test";
import { aspectRatioBundle } from "../tests/helpers/aspect-ratio";

let bundle: string;
test.beforeAll(async () => { bundle = await aspectRatioBundle(); });
test.beforeEach(async ({ page }) => {
  await page.setContent('<html><body><div id="app"></div></body></html>');
  await page.addScriptTag({ content: bundle });
  await page.locator('[data-tip="最小・最大サイズと縦横比"]').click();
  await expect(ratio(page)).toHaveValue("16 / 9");
});

const ratio = (page: Page) => page.locator('input[placeholder="例: 16 / 9"]');
const doc = (page: Page) => page.evaluate(() => (window as any).ratioEditor.getState().doc);
const history = (page: Page) => page.evaluate(() => (window as any).ratioEditor.getState().past.length);
const renderedRatio = (page: Page) => page.locator('.cv-root [data-node="a"]');

async function draft(page: Page) {
  await ratio(page).fill("4 / 3");
  await ratio(page).evaluate((input) => { (window as any).previousRatioInput = input; });
}

async function expectDiscarded(page: Page, before: unknown, past: number) {
  await expect(ratio(page)).toHaveValue("16 / 9");
  expect(await page.evaluate(() => (window as any).previousRatioInput.isConnected)).toBe(false);
  await ratio(page).focus();
  await page.keyboard.press("Enter");
  expect(await doc(page)).toEqual(before);
  expect(await history(page)).toBe(past);
}

test("共同編集で編集中の画面幅が消えても、未確定の縦横比をパソコン幅へ書き込まない", async ({ page }) => {
  await draft(page);
  // 共同編集の受信経路では pointerdown/blur を通らず、無くなった幅を base へ切り替える。
  await page.evaluate(() => (window as any).removeRemoteBreakpoint());
  expect(await page.evaluate(() => (window as any).ratioEditor.getState().breakpoint)).toBe("base");
  await expectDiscarded(page, await doc(page), await history(page));
  await expect(renderedRatio(page)).toHaveCSS("aspect-ratio", "16 / 9");
  // 中断後も新しい入力とその履歴は正常に使える。
  const before = await doc(page);
  await ratio(page).fill("3 / 2");
  await page.keyboard.press("Enter");
  await expect(renderedRatio(page)).toHaveCSS("aspect-ratio", "3 / 2");
  const changed = await doc(page);
  await page.evaluate(() => (window as any).ratioEditor.getState().undo());
  expect(await doc(page)).toEqual(before);
  await expect(ratio(page)).toHaveValue("16 / 9");
  await page.evaluate(() => (window as any).ratioEditor.getState().redo());
  expect(await doc(page)).toEqual(changed);
  await expect(ratio(page)).toHaveValue("3 / 2");
});

for (const target of ["node", "breakpoint", "state", "selection", "page"] as const) {
  test(`${target} の変更で、同じ値の縦横比に未確定の文字を持ち越さない`, async ({ page }) => {
    const before = await doc(page);
    const past = await history(page);
    await draft(page);
    await page.evaluate((target) => {
      const s = (window as any).ratioEditor.getState();
      if (target === "node") s.select("b");
      else if (target === "breakpoint") s.setBreakpoint("base");
      else if (target === "state") s.setStyleState("hover");
      else if (target === "selection") s.selectMany(["a", "b"], "a");
      else { s.setActivePage("q"); s.select("c"); }
    }, target);
    if (target === "page") {
      await expect(page.locator('.cv-root [data-node="c"]')).toBeVisible();
      if (!(await ratio(page).count())) await page.locator('[data-tip="最小・最大サイズと縦横比"]').click();
    }
    await expectDiscarded(page, before, past);
  });
}

test("同じ編集先では無関係な共同編集を受けても入力を保ち、Enter・blur・空欄を確定できる", async ({ page }) => {
  await draft(page);
  await page.evaluate(() => {
    const s = (window as any).ratioEditor.getState();
    const remote = structuredClone(s.doc); remote.nodes.b.name = "Remote name";
    s.applyRemoteDoc(remote);
  });
  await expect(ratio(page)).toHaveValue("4 / 3");
  await expect(ratio(page)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(renderedRatio(page)).toHaveCSS("aspect-ratio", "4 / 3");
  await ratio(page).fill("3 / 2");
  await page.locator('.state-bar .grp-label').click();
  await expect(renderedRatio(page)).toHaveCSS("aspect-ratio", "3 / 2");
  await ratio(page).fill("");
  await page.keyboard.press("Enter");
  await expect(renderedRatio(page)).toHaveCSS("aspect-ratio", "auto");
  // 右クリックによる継承へのリセットもそのまま使える。
  await page.locator('.grp-label').filter({ hasText: /^縦横比$/ }).click({ button: "right" });
  await expect(ratio(page)).toHaveValue("16 / 9");
  await expect(renderedRatio(page)).toHaveCSS("aspect-ratio", "16 / 9");
  expect((await doc(page)).nodes.b.name).toBe("Remote name");
});
