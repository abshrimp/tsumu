import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 1360, height: 900 } });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("tsumu-help-seen-v1", "1"));
  const response = await page.request.post("/api/sites", { data: { name: "Panel resize pointer test" } });
  expect(response.ok()).toBeTruthy();
  const { site } = await response.json();
  await page.goto(`/sites/${site.id}`);
  await expect(page.locator(".panel-resizer")).toHaveCount(2);
  await expect(page.locator(".canvas-area")).toBeVisible();
});

test("right panel resize ignores another pointer and cleans up after cancellation", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const width = () => page.locator(".panel-r").evaluate((el) => Math.round(el.getBoundingClientRect().width));
  const handle = page.locator(".panel-resizer").last();
  const rect = (await handle.boundingBox())!;
  const x = rect.x + rect.width / 2, y = rect.y + 80;
  const initial = await width();
  await page.mouse.move(x, y);
  await page.mouse.down();
  await expect(page.locator("body.is-resizing-panel")).toHaveCount(1);

  await page.evaluate(() => {
    window.dispatchEvent(new PointerEvent("pointermove", { pointerId: 999, clientX: 1, buttons: 1 }));
    window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 999, clientX: 1, buttons: 0 }));
  });
  expect(await width()).toBe(initial);
  await expect(page.locator("body.is-resizing-panel")).toHaveCount(1);

  await page.mouse.move(x - 50, y);
  await expect.poll(width).toBeGreaterThanOrEqual(initial + 45);
  const resized = await width();

  await handle.dispatchEvent("pointercancel", { pointerId: 1, pointerType: "mouse", button: 0, buttons: 0, bubbles: true });
  await expect(page.locator("body.is-resizing-panel")).toHaveCount(0);
  await page.mouse.move(x - 100, y);
  expect(await width()).toBe(resized);
  await page.mouse.up();

  // 次のドラッグも動かなければならない。古いリスナーがそれを奪うことはない。
  const updatedRect = (await handle.boundingBox())!;
  const x2 = updatedRect.x + updatedRect.width / 2;
  await page.mouse.move(x2, y);
  await page.mouse.down();
  await page.mouse.move(x2 + 25, y);
  await page.mouse.up();
  await expect(page.locator("body.is-resizing-panel")).toHaveCount(0);
  await expect.poll(width).toBeLessThanOrEqual(resized - 20);
  expect(errors).toEqual([]);
});

test("changing from desktop to tablet width keeps both panel controls usable", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const viewport of [1360, 1024, 900]) {
    await page.setViewportSize({ width: viewport, height: 900 });
    await expect(page.locator(".canvas-area")).toBeVisible();
    await expect(page.locator(".panel-resizer")).toHaveCount(2);
    const panels = await page.locator(".panel-l, .panel-r").all();
    expect(panels).toHaveLength(2);
    for (const panel of panels) {
      const bounds = await panel.boundingBox();
      expect(bounds?.width).toBeGreaterThan(0);
    }
  }
  expect(errors).toEqual([]);
});
