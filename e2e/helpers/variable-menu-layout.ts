import { expect, type Page } from "@playwright/test";

/** 実際の候補メニューを、出現時の拡大アニメーションが終わってから測る。 */
export async function expectVariableMenuLayout(page: Page, width: number, actions: 2 | 3) {
  const menu = page.locator(".var-comp");
  await expect(menu).toBeVisible();
  await menu.evaluate(async el => {
    await Promise.all(el.getAnimations({ subtree: true })
      .filter(animation => animation.effect?.getTiming().iterations !== Infinity)
      .map(animation => animation.finished.catch(() => {})));
  });
  const box = await menu.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(7.5);
  expect(box!.x + box!.width).toBeLessThanOrEqual(width - 7.5);
  const hints = menu.locator(".var-comp-foot > span");
  await expect(hints).toHaveCount(actions);
  await expect(hints.nth(0)).toContainText("選択");
  await expect(hints.nth(1)).toContainText("挿入");
  if (actions === 3) await expect(hints.nth(2)).toContainText("変数を探す");
  const bounds = await hints.evaluateAll(elements => elements.map(el => {
    const rect = el.getBoundingClientRect();
    return { center: rect.top + rect.height / 2, height: rect.height,
      clientWidth: el.clientWidth, scrollWidth: el.scrollWidth };
  }));
  for (const rect of bounds) {
    expect(rect.height).toBeLessThan(22);
    // 幅はどちらも変形前のレイアウト寸法、行は高さの違いを許容する中心線で比較する。
    expect(rect.scrollWidth).toBeLessThanOrEqual(rect.clientWidth);
    expect(Math.abs(rect.center - bounds[0].center)).toBeLessThan(1);
  }
  for (const locator of [menu, menu.locator(".var-comp-foot")]) {
    const size = await locator.evaluate(el => ({ client: el.clientWidth, scroll: el.scrollWidth }));
    expect(size.scroll).toBeLessThanOrEqual(size.client);
  }
  const explore = menu.locator(".var-comp-explore > span:not(.var-comp-sample)");
  await expect(explore).toHaveText("変数を探す…");
  expect((await explore.boundingBox())!.height).toBeLessThan(22);
}
