import { expect, test, type Page } from "@playwright/test";
import { easingEditorBundle } from "../tests/helpers/motion-editor-browser";
const bundle = easingEditorBundle("cubic-bezier(0.25, 0.25, 0.75, 0.75)");
test.beforeEach(async ({ page }) => {
  await page.setContent('<div id="app"></div>');
  await page.addStyleTag({ path: "app/globals.css" });
  await page.evaluate(() => {
    const listeners = new Set<EventListenerOrEventListenerObject>();
    (window as any).__moves = listeners;
    const add = window.addEventListener.bind(window), remove = window.removeEventListener.bind(window);
    window.addEventListener = ((type: string, fn: any, opts: any) => { if (type === "pointermove") listeners.add(fn); add(type, fn, opts); }) as any;
    window.removeEventListener = ((type: string, fn: any, opts: any) => { if (type === "pointermove") listeners.delete(fn); remove(type, fn, opts); }) as any;
  });
  await page.addScriptTag({ content: await bundle });
  await expect(page.locator(".ee-modal")).toBeVisible();
  await page.locator(".ee-modal").evaluate(el => Promise.all(el.getAnimations().map(a => a.finished)));
});
async function start(page: Page) {
  const r = (await page.locator(".ee-handle").first().boundingBox())!;
  const x = r.x + r.width / 2, y = r.y + r.height / 2;
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x + 20, y - 10);
  return { x, y };
}
const value = (page: Page) => page.locator(".ee-graph").getAttribute("aria-label");
test("easing drag ignores unrelated pointers and stops on blur", async ({ page }) => {
  const point = await start(page), moved = await value(page);
  await page.evaluate(() => {
    window.dispatchEvent(new PointerEvent("pointermove", { pointerId: 999, buttons: 1, clientX: 0, clientY: 0 }));
    window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 999, buttons: 0 }));
  });
  expect(await value(page)).toBe(moved);
  await expect(page.locator(".ee-handle.is-active")).toHaveCount(1);
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await page.mouse.move(point.x + 60, point.y + 30);
  expect(await value(page)).toBe(moved);
  await expect(page.locator(".ee-handle.is-active")).toHaveCount(0);
  await page.mouse.up();
});
test("closing an easing modal during drag removes all its pointer listeners", async ({ page }) => {
  await start(page);
  await page.keyboard.press("Escape");
  await expect(page.locator(".ee-modal")).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__moves.size)).toBe(0);
  await page.mouse.up();
  await page.locator("#reopen").click();
  await expect(page.locator(".ee-modal")).toBeVisible();
  expect(await page.evaluate(() => (window as any).__moves.size)).toBe(1);
});
test("undo during an easing drag leaves subsequent edits independently undoable", async ({ page }) => {
  const initial = await value(page), point = await start(page);
  expect(await value(page)).not.toBe(initial);
  await page.keyboard.press("Control+z");
  expect(await value(page)).toBe(initial);
  await page.mouse.move(point.x + 35, point.y - 15);
  expect(await value(page)).not.toBe(initial);
  await page.mouse.up();
  await page.getByRole("button", { name: "元に戻す", exact: true }).click();
  expect(await value(page)).toBe(initial);
});
