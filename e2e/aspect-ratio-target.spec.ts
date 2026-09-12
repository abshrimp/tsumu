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

test("Removing the edited breakpoint remotely does not commit an unfinished aspect ratio to the desktop breakpoint", async ({ page }) => {
  await draft(page);
  // 編集中のブレークポイントが共同編集で消えたときは、pointerdown や blur が無くても base のブレークポイントに切り替わる。
  await page.evaluate(() => (window as any).removeRemoteBreakpoint());
  expect(await page.evaluate(() => (window as any).ratioEditor.getState().breakpoint)).toBe("base");
  await expectDiscarded(page, await doc(page), await history(page));
  await expect(renderedRatio(page)).toHaveCSS("aspect-ratio", "16 / 9");
  // 中断された編集の後も、新しい入力と、その「元に戻す」の履歴が使える。
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
  test(`Changing the ${target} does not carry uncommitted text to an aspect ratio with the same value`, async ({ page }) => {
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

test("Unrelated remote edits preserve an input on the same target, which can still commit via Enter, blur, or clearing", async ({ page }) => {
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
  // 右クリックで、受け継いだ値に戻す操作も引き続き使える。
  await page.locator('.grp-label').filter({ hasText: /^縦横比$/ }).click({ button: "right" });
  await expect(ratio(page)).toHaveValue("16 / 9");
  await expect(renderedRatio(page)).toHaveCSS("aspect-ratio", "16 / 9");
  expect((await doc(page)).nodes.b.name).toBe("Remote name");
});
