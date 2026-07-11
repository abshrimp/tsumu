import { expect, test, type Page } from "@playwright/test";
import { transformOriginBundle } from "../tests/helpers/transform-origin";

let bundle: string;
test.beforeAll(async () => { bundle = await transformOriginBundle(); });
test.beforeEach(async ({ page }) => {
  await page.setContent('<html><body><div id="app"></div></body></html>');
  await page.addScriptTag({ content: bundle });
  await expect(page.locator('.origin-grid [data-tip="左上"]')).toHaveAttribute("aria-checked", "true");
});

const node = (page: Page, id = "a") => page.locator(`.cv-root [data-node="${id}"]`);
const center = (page: Page) => page.locator('.origin-grid [data-tip="中央"]');
const reset = (page: Page) => page.locator(".grp-label").filter({ hasText: /^基準点$/ }).click({ button: "right" });

for (const [bp, state, inherited, resetValue] of [
  ["sm", "default", "0px 0px", "0px 0px"],
  ["base", "hover", "0px 100px", "0px 0px"],
  ["base", "active", "0px 0px", "0px 0px"],
  ["base", "focus", "0px 0px", "0px 0px"],
  ["sm", "hover", "0px 100px", "0px 100px"],
] as const) {
  test(`${bp}/${state} の中央を選べて、リセット・元に戻す・やり直すで継承先を保つ`, async ({ page }) => {
    await page.evaluate(({ bp, state }) => {
      const s = (window as any).originEditor.getState();
      s.setBreakpoint(bp); s.setStyleState(state);
    }, { bp, state });
    await expect(node(page)).toHaveCSS("transform-origin", inherited);
    const before = await page.evaluate(() => (window as any).originEditor.getState().doc);
    await center(page).click();
    await expect(center(page)).toHaveAttribute("aria-checked", "true");
    await expect(node(page)).toHaveCSS("transform-origin", "100px 50px");
    expect(await page.evaluate(({ bp, state }) => (window as any).originEditor.getState().doc.nodes.a.styles[bp][state].transformOrigin, { bp, state })).toBe("center");
    const changed = await page.evaluate(() => (window as any).originEditor.getState().doc);
    await page.evaluate(() => (window as any).originEditor.getState().undo());
    await expect(node(page)).toHaveCSS("transform-origin", inherited);
    expect(await page.evaluate(() => (window as any).originEditor.getState().doc)).toEqual(before);
    await page.evaluate(() => (window as any).originEditor.getState().redo());
    await expect(node(page)).toHaveCSS("transform-origin", "100px 50px");
    expect(await page.evaluate(() => (window as any).originEditor.getState().doc)).toEqual(changed);
    // 同じセルの再選択は解除ではなく、同じ基準点を保つ。
    const history = await page.evaluate(() => (window as any).originEditor.getState().past.length);
    await center(page).click();
    await expect(node(page)).toHaveCSS("transform-origin", "100px 50px");
    expect(await page.evaluate(() => (window as any).originEditor.getState().past.length)).toBe(history);
    await reset(page);
    await expect(node(page)).toHaveCSS("transform-origin", resetValue);
    expect(await page.evaluate(({ bp, state }) => (window as any).originEditor.getState().doc.nodes.a.styles[bp][state].transformOrigin, { bp, state })).toBeUndefined();
    await page.evaluate(() => (window as any).originEditor.getState().undo());
    await expect(node(page)).toHaveCSS("transform-origin", "100px 50px");
    await page.evaluate(() => (window as any).originEditor.getState().redo());
    await expect(node(page)).toHaveCSS("transform-origin", resetValue);
  });
}

test("中央を複数選択に適用し、解除後はそれぞれの大きい画面の基準点を受け継ぐ", async ({ page }) => {
  await page.evaluate(() => {
    const s = (window as any).originEditor.getState();
    s.setBreakpoint("sm"); s.selectMany(["a", "b"], "a");
  });
  const before = await page.evaluate(() => (window as any).originEditor.getState().doc);
  await center(page).click();
  for (const id of ["a", "b"]) await expect(node(page, id)).toHaveCSS("transform-origin", "100px 50px");
  await page.evaluate(() => (window as any).originEditor.getState().undo());
  expect(await page.evaluate(() => (window as any).originEditor.getState().doc)).toEqual(before);
  await page.evaluate(() => (window as any).originEditor.getState().redo());
  await reset(page);
  await expect(node(page)).toHaveCSS("transform-origin", "0px 0px");
  await expect(node(page, "b")).toHaveCSS("transform-origin", "200px 100px");
  // 別のページへ移った後の操作は、前の複数選択に残らない。
  await page.evaluate(() => {
    const s = (window as any).originEditor.getState(); s.setActivePage("q"); s.select("c");
  });
  await center(page).click();
  await expect(node(page, "c")).toHaveCSS("transform-origin", "100px 50px");
  expect(await page.evaluate(() => {
    const { nodes } = (window as any).originEditor.getState().doc;
    return [nodes.a.styles.sm.default.transformOrigin, nodes.b.styles.sm.default.transformOrigin];
  })).toEqual([undefined, undefined]);
});

test("通常時の中央も選べて、他の基準点と右クリックリセットを妨げない", async ({ page }) => {
  await center(page).click();
  await expect(node(page)).toHaveCSS("transform-origin", "100px 50px");
  await page.locator('.origin-grid [data-tip="右下"]').click();
  await expect(node(page)).toHaveCSS("transform-origin", "200px 100px");
  await reset(page);
  await expect(node(page)).toHaveCSS("transform-origin", "100px 50px");
  expect(await page.evaluate(() => (window as any).originEditor.getState().doc.nodes.a.styles.base.default.transformOrigin)).toBeUndefined();
});
