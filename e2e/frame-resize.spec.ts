import { expect, test, type Page } from "@playwright/test";
import { frameResizeBundle } from "../tests/helpers/frame-resize-browser";

const bundle = frameResizeBundle();
test.use({ hasTouch: true });

test.beforeEach(async ({ page }) => {
  await page.setContent('<div id="app"></div>');
  await page.addStyleTag({ path: "app/globals.css" });
  await page.addStyleTag({ content: "#app { display: flex; height: 700px; } .canvas-area { flex: none; width: 1056px; }" });
  await page.addScriptTag({ content: await bundle });
  await expect(page.locator(".frame-handle.is-right")).toBeVisible();
});

const state = (page: Page) => page.evaluate(() => (window as any).frameResize.state());
const active = (page: Page) => page.locator("body.is-resizing-frame");
const handle = (page: Page, side: "left" | "right" = "right") => page.locator(`.frame-handle.is-${side}`);

async function coordinates(page: Page, side: "left" | "right" = "right") {
  const area = await page.locator(".canvas-area").evaluate((element) => ({
    left: element.getBoundingClientRect().left, width: element.clientWidth,
  }));
  const rect = (await handle(page, side).boundingBox())!;
  return {
    start: rect.x + rect.width / 2,
    y: rect.y + 80,
    x: (width: number) => area.left + area.width / 2 + (side === "left" ? -1 : 1) * width / 2,
  };
}

async function begin(page: Page, side: "left" | "right" = "right") {
  const point = await coordinates(page, side);
  await page.mouse.move(point.start, point.y);
  await page.mouse.down();
  await expect(active(page)).toHaveCount(1);
  return point;
}

async function unchangedDocument(page: Page) {
  expect(await state(page)).toMatchObject({ past: 0, future: 0, sameDocument: true });
}

for (const side of ["left", "right"] as const) {
  test(`${side} handle preserves snapping, Alt free sizing, reset, and document history`, async ({ page }) => {
    let point = await begin(page, side);
    await page.mouse.move(point.x(772), point.y);
    await expect.poll(async () => (await state(page)).width).toBe(767);
    await page.mouse.up();
    expect(await state(page)).toMatchObject({ width: null, breakpoint: "md" });
    await expect(active(page)).toHaveCount(0);

    point = await begin(page, side);
    await page.keyboard.down("Alt");
    await page.mouse.move(point.x(772), point.y);
    await page.mouse.up();
    await page.keyboard.up("Alt");
    expect(await state(page)).toMatchObject({ width: 772, breakpoint: "lg" });
    await handle(page, side).dblclick();
    expect(await state(page)).toMatchObject({ width: null, breakpoint: "lg" });
    await expect(page.locator(".canvas-frame")).toHaveCSS("width", "1024px");
    await unchangedDocument(page);
  });
}

test("real multitouch preserves the first resize and touch cancellation stops it", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const touch = await page.context().newCDPSession(page);
  const right = await coordinates(page);
  const left = await coordinates(page, "left");
  const finger = (id: number, x: number) => ({ id, x, y: right.y });
  const send = (type: "touchStart" | "touchMove" | "touchEnd" | "touchCancel", touchPoints: ReturnType<typeof finger>[]) =>
    touch.send("Input.dispatchTouchEvent", { type, touchPoints });
  await send("touchStart", [finger(7, right.start)]);
  await send("touchMove", [finger(7, right.x(700))]);
  await expect.poll(async () => (await state(page)).width).toBe(700);
  // Start the second pointer on the opposite handle; its movement and release must not steal the first pointer.
  const second = (await coordinates(page, "left")).start;
  await send("touchStart", [finger(7, right.x(700)), finger(8, second)]);
  await send("touchMove", [finger(7, right.x(700)), finger(8, left.x(800))]);
  await expect.poll(async () => (await state(page)).width).toBe(700);
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
    await handle(page, "left").dispatchEvent(type, { pointerId: 999, pointerType: "touch", buttons: 0 });
    await expect(active(page)).toHaveCount(1);
  }
  await send("touchMove", [finger(7, right.x(710)), finger(8, left.x(800))]);
  await expect.poll(async () => (await state(page)).width).toBe(710);
  await send("touchCancel", []);
  await expect(active(page)).toHaveCount(0);
  await page.mouse.move(right.x(800), right.y);
  expect((await state(page)).width).toBe(710);

  const next = await coordinates(page);
  await send("touchStart", [finger(9, next.start)]);
  await send("touchMove", [finger(9, next.x(720))]);
  await send("touchEnd", []);
  await expect.poll(async () => (await state(page)).width).toBe(720);
  await expect(active(page)).toHaveCount(0);
  await unchangedDocument(page);
  expect(errors).toEqual([]);
});

for (const interruption of ["pointercancel", "lostpointercapture", "blur", "released outside"] as const) {
  test(`${interruption} clears resize state, ignores late moves, and permits the next drag`, async ({ page }) => {
    const point = await begin(page);
    await page.mouse.move(point.x(700), point.y);
    await expect.poll(async () => (await state(page)).width).toBe(700);
    if (interruption === "lostpointercapture") {
      await handle(page).evaluate((element) => element.releasePointerCapture(1));
      // The browser releases pointer capture before dispatching the next pointer event.
      await page.mouse.move(point.x(800), point.y);
    } else if (interruption === "blur") {
      await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    } else {
      await handle(page).dispatchEvent(interruption === "pointercancel" ? "pointercancel" : "pointermove", {
        pointerId: 1, pointerType: "mouse", button: 0, buttons: 0, clientX: point.x(750),
      });
    }
    await expect(active(page)).toHaveCount(0);
    await expect(page.locator(".canvas-stage.is-dragging")).toHaveCount(0);
    await handle(page).dispatchEvent("pointermove", { pointerId: 1, buttons: 1, clientX: point.x(800) });
    await page.mouse.up();
    expect((await state(page)).width).toBe(700);
    const next = await begin(page);
    await page.mouse.move(next.x(720), next.y);
    await page.mouse.up();
    expect((await state(page)).width).toBe(720);
    await unchangedDocument(page);
  });
}

test("unmounting a FrameStage resets Canvas fit scale and global resize styles", async ({ page }) => {
  await page.evaluate(() => (window as any).frameResize.zoom(0));
  const point = await begin(page);
  await page.mouse.move(point.x(700), point.y);
  await expect.poll(async () => (await state(page)).width).toBe(700);
  // Navigating from a normal page to a redirect swaps FrameStage while retaining Canvas.
  await page.evaluate(() => (window as any).frameResize.page("q"));
  await expect(active(page)).toHaveCount(0);
  await page.evaluate(() => (window as any).frameResize.width(1500));
  await expect.poll(() => page.locator(".canvas-frame").evaluate((element) => Number((element as HTMLElement).style.zoom)))
    .toBeCloseTo(1000 / 1500, 5);
  await page.mouse.up();
  await page.evaluate(() => { (window as any).frameResize.width(600); (window as any).frameResize.page("p"); });
  await begin(page);
  await page.evaluate(() => (window as any).frameResize.unmount());
  await expect(active(page)).toHaveCount(0);
  await page.mouse.up();
  await unchangedDocument(page);
});

test("HTML pages only execute their HTML, CSS and scripts in preview mode", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.evaluate(() => (window as any).frameResize.page("h"));

  await expect(page.locator(".cv-placeholder")).toContainText("このページはHTMLモードです");
  await expect(page.locator(".rawhtml-frame")).toHaveCount(0);

  await page.evaluate(() => (window as any).frameResize.mode("preview"));
  const iframe = page.locator("iframe.rawhtml-frame");
  const content = page.frameLocator("iframe.rawhtml-frame");
  await expect(iframe).toHaveAttribute("sandbox", "allow-scripts allow-forms allow-popups");
  await expect(content.locator("#execution")).toHaveText("script ran");
  await expect(content.locator("body")).toHaveCSS("color", "rgb(10, 20, 30)");
  await content.locator("#run").click();
  await expect(content.locator("#execution")).toHaveText("clicked");

  await page.evaluate(() => (window as any).frameResize.mode("design"));
  await expect(page.locator(".rawhtml-frame")).toHaveCount(0);
  await expect(page.locator(".cv-placeholder")).toContainText("プレビューで動作を確認してください");

  await page.evaluate(() => (window as any).frameResize.mode("preview"));
  await expect(content.locator("#execution")).toHaveText("script ran");
  await unchangedDocument(page);
  expect(errors).toEqual([]);
});
