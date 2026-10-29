import { readEditorCss } from "../tests/helpers/editor-css";
import { expect, test, type Page } from "@playwright/test";
import { easingEditorBundle, motionEditorBundle } from "../tests/helpers/motion-editor-browser";

const css = readEditorCss();

async function timeline(page: Page) {
  const rect = (await page.locator(".kfe-lane").boundingBox())!;
  return { x: (percent: number) => rect.x + rect.width * percent / 100, y: rect.y + rect.height / 2 };
}

async function beginMarker(page: Page, from: number) {
  const point = await timeline(page);
  const marker = page.locator(`.kfe-marker[aria-label="${from}%"]`);
  const rect = (await marker.boundingBox())!;
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await page.mouse.down();
  return point;
}

test.describe("keyframe pointer drag", () => {
  let bundle: string;
  test.beforeAll(async () => { bundle = await motionEditorBundle(); });
  test.use({ hasTouch: true });

  test.beforeEach(async ({ page }) => {
    await page.setContent('<div id="app"></div>');
    await page.addStyleTag({ content: css });
    await page.addScriptTag({ content: bundle });
    await expect(page.locator(".kfe-modal")).toBeVisible();
    await page.locator(".kfe-modal").evaluate((element) =>
      Promise.all(element.getAnimations().map((animation) => animation.finished)));
  });

  // 作ったイベントだけでなく、ブラウザが生成したタッチの pointercancel を使う。
  test("cancelled touch marker stops, ignores a second pointer, and keeps separate undo steps", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const touch = await page.context().newCDPSession(page);
    const point = await timeline(page);
    const sendTouch = async (type: "touchStart" | "touchMove" | "touchEnd" | "touchCancel", offset = 0) => {
      await touch.send("Input.dispatchTouchEvent", {
        type,
        touchPoints: type === "touchEnd" || type === "touchCancel" ? [] : [{ x: point.x(offset), y: point.y, id: 7 }],
      });
    };
    await sendTouch("touchStart", 0);
    await sendTouch("touchMove", 10);
    await expect(page.locator('.kfe-marker[aria-label="10%"]')).toHaveCount(1);
    // 関係の無いポインターのイベントで、編集を動かしたり終えたりしてはならず、その履歴を分けてもならない。
    await page.locator('.kfe-marker[aria-label="50%"]')
      .dispatchEvent("pointerdown", { pointerId: 999, pointerType: "touch", button: 0, buttons: 1 });
    await page.locator(".kfe-lane").dispatchEvent("pointerdown", {
      pointerId: 999, pointerType: "touch", button: 0, buttons: 1, clientX: point.x(75),
    });
    await expect(page.locator(".kfe-marker")).toHaveCount(3);
    await page.evaluate(() => {
      window.dispatchEvent(new PointerEvent("pointermove", { pointerId: 999, clientX: 0, buttons: 1 }));
      window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 999, buttons: 0 }));
    });
    await sendTouch("touchMove", 20);
    await sendTouch("touchCancel");
    await page.mouse.move(point.x(35), point.y);
    await expect(page.locator('.kfe-marker[aria-label="20%"]')).toHaveCount(1);
    const undo = page.getByRole("button", { name: "元に戻す", exact: true });
    const redo = page.getByRole("button", { name: "やり直す", exact: true });
    await undo.click();
    await expect(page.locator('.kfe-marker[aria-label="0%"]')).toHaveCount(1);
    await redo.click();
    await expect(page.locator('.kfe-marker[aria-label="20%"]')).toHaveCount(1);

    await sendTouch("touchStart", 20);
    await sendTouch("touchMove", 25);
    await sendTouch("touchMove", 30);
    await sendTouch("touchEnd");
    await expect(page.locator('.kfe-marker[aria-label="30%"]')).toHaveCount(1);
    await undo.click();
    await expect(page.locator('.kfe-marker[aria-label="20%"]')).toHaveCount(1);
    await redo.click();
    await expect(page.locator('.kfe-marker[aria-label="30%"]')).toHaveCount(1);
    await page.getByRole("button", { name: "適用", exact: true }).click();
    await expect(page.locator(".kfe-modal")).toHaveCount(0);
    await expect(page.locator("#saved")).toContainText("30%");
    await page.locator("#reopen").click();
    await expect(page.locator('.kfe-marker[aria-label="30%"]')).toHaveCount(1);
    expect(errors).toEqual([]);
  });

  test("a prior unrelated pointer cannot take ownership of the marker undo history", async ({ page }) => {
    await page.locator(".kfe-stage").dispatchEvent("pointerdown", {
      pointerId: 7, pointerType: "touch", isPrimary: true, button: 0, buttons: 1,
    });
    const point = await beginMarker(page, 0);
    await page.mouse.move(point.x(10), point.y);
    await expect(page.locator('.kfe-marker[aria-label="10%"]')).toHaveCount(1);
    await page.evaluate(() => {
      window.dispatchEvent(new PointerEvent("pointermove", { pointerId: 7, clientX: 0, buttons: 1 }));
      window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 7, buttons: 0 }));
    });
    await page.mouse.move(point.x(20), point.y);
    await page.mouse.up();
    await expect(page.locator('.kfe-marker[aria-label="20%"]')).toHaveCount(1);
    await page.getByRole("button", { name: "元に戻す", exact: true }).click();
    await expect(page.locator('.kfe-marker[aria-label="0%"]')).toHaveCount(1);
    await expect(page.getByRole("button", { name: "元に戻す", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "やり直す", exact: true }).click();
    await expect(page.locator('.kfe-marker[aria-label="20%"]')).toHaveCount(1);
  });

  for (const kind of ["marker", "ruler"] as const) {
    test(`${kind} cancellation and capture loss stop further editing`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      for (const termination of ["pointercancel", "lostpointercapture"] as const) {
        const point = await timeline(page);
        const target = kind === "marker" ? page.locator(".kfe-lane") : page.locator(".kfe-ruler");
        if (kind === "marker") await beginMarker(page, termination === "pointercancel" ? 0 : 20);
        else {
          const rect = (await target.boundingBox())!;
          await page.mouse.move(point.x(10), rect.y + rect.height / 2);
          await page.mouse.down();
        }
        await page.mouse.move(point.x(20), point.y);
        if (termination === "pointercancel") {
          await target.dispatchEvent("pointercancel", { pointerId: 1, pointerType: "mouse", button: 0, buttons: 0 });
        } else {
          await target.evaluate((element) => element.releasePointerCapture(1));
        }
        await page.mouse.move(point.x(40), point.y);
        await page.mouse.up();
        if (kind === "marker") await expect(page.locator('.kfe-marker[aria-label="20%"]')).toHaveCount(1);
        else await expect(page.locator(".me-time")).toHaveText("0.20s / 1.00s");
      }
      expect(errors).toEqual([]);
    });

    test(`closing during ${kind} removes listeners and discards modal edits`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const original = await page.locator("#saved").textContent();
      const point = await timeline(page);
      if (kind === "marker") await beginMarker(page, 0);
      else {
        const rect = (await page.locator(".kfe-ruler").boundingBox())!;
        await page.mouse.move(point.x(10), rect.y + rect.height / 2);
        await page.mouse.down();
      }
      await page.mouse.move(point.x(20), point.y);
      await page.keyboard.press("Escape");
      await expect(page.locator(".kfe-modal")).toHaveCount(0);
      await page.mouse.move(point.x(40), point.y);
      await page.mouse.up();
      await expect(page.locator("#saved")).toHaveText(original!);
      await page.locator("#reopen").click();
      await expect(page.locator('.kfe-marker[aria-label="0%"]')).toHaveCount(1);
      await page.getByRole("button", { name: "キャンセル", exact: true }).click();
      await expect(page.locator("#saved")).toHaveText(original!);
      expect(errors).toEqual([]);
    });

    test(`switching to CSS during ${kind} detaches timeline listeners`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const point = await timeline(page);
      if (kind === "marker") await beginMarker(page, 0);
      else {
        const rect = (await page.locator(".kfe-ruler").boundingBox())!;
        await page.mouse.move(point.x(10), rect.y + rect.height / 2);
        await page.mouse.down();
      }
      await page.mouse.move(point.x(20), point.y);
      await page.locator('[data-tip="CSSで編集"]').evaluate((element: HTMLElement) => element.click());
      await expect(page.locator(".kfe-lane")).toHaveCount(0);
      await page.mouse.move(point.x(40), point.y);
      await page.mouse.up();
      await page.locator('[data-tip="CSSで編集"]').click();
      await expect(page.locator(".kfe-lane")).toBeVisible();
      expect(errors).toEqual([]);
    });
  }
});

test("opening and applying keyframes preserves CSS declarations, nearby stops, and overflowing raw values", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setContent('<div id="app"></div>');
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: await motionEditorBundle() });
  await expect(page.locator(".kfe-modal")).toBeVisible();

  const cases = [
    { name: "unsupported constructor transform", declarations: "transform: constructor(2);", property: "transform", expected: "none" },
    { name: "small opacity values", declarations: "opacity: 0.0001;", property: "opacity", expected: "0.0001" },
    { name: "escaped property aliases", declarations: String.raw`\6f pacity: 0.2; opacity: 0.8;`, property: "opacity", expected: "0.8" },
    { name: "case-sensitive custom properties", declarations: "--fadeLevel: 0.25; opacity: var(--fadeLevel);", property: "opacity", expected: "0.25" },
    { name: "opacity fallback order", declarations: "opacity: var(--fadeLevel, 0.2); opacity: 0.8;", property: "opacity", expected: "0.8" },
    { name: "transform fallback order", declarations: "transform: translate3d(4px, 5px, 6px); transform: translateX(12px);", property: "transform", expected: "matrix(1, 0, 0, 1, 12, 0)" },
  ];
  for (const item of cases) {
    const source = `from { ${item.declarations} } to { ${item.declarations} }`;
    await page.evaluate((next) => (window as any).__resetMotion(next), source);
    const value = () => page.locator("#motion-probe").evaluate((element, property) => getComputedStyle(element).getPropertyValue(property), item.property);
    await expect.poll(value, item.name).toBe(item.expected);
    await expect(page.locator(".kfe-modal")).toBeVisible();
    // 実際のエディタは、開いたときに CSS を読み、「適用」で画面の状態を直列化する。
    await page.getByRole("button", { name: "適用", exact: true }).click();
    await expect(page.locator(".kfe-modal")).toHaveCount(0);
    await expect.poll(value, item.name).toBe(item.expected);
    await page.locator("#reopen").click();
    // CSS のモードに行って戻っても、宣言が溜まったり、並びが変わったりしてはならない。
    await page.locator('[data-tip="CSSで編集"]').click();
    await page.locator('[data-tip="CSSで編集"]').click();
    await expect(page.locator(".kfe-lane")).toBeVisible();
    await page.getByRole("button", { name: "適用", exact: true }).click();
    await expect.poll(value, item.name).toBe(item.expected);
  }

  await page.evaluate((next) => (window as any).__resetMotion(next),
    "from { transform: translateX(0px); } 49.9999% { transform: translateX(100px); } 50% { transform: translateX(0px); } to { transform: translateX(100px); }");
  const position = () => page.locator("#motion-probe").evaluate((element) => {
    const animation = element.getAnimations()[0];
    if (!animation) return null;
    animation.currentTime = 25000;
    return new DOMMatrix(getComputedStyle(element).transform).m41;
  });
  await expect.poll(position).toBeCloseTo(50, 2);
  for (let pass = 0; pass < 2; pass++) {
    await expect(page.locator(".kfe-modal")).toBeVisible();
    await page.getByRole("button", { name: "適用", exact: true }).click();
    await expect(page.locator(".kfe-modal")).toHaveCount(0);
    await expect(page.locator("#saved")).toContainText("49.9999%");
    await expect.poll(position).toBeCloseTo(50, 2);
    if (pass === 0) await page.locator("#reopen").click();
  }

  await page.evaluate((next) => (window as any).__resetMotion(next),
    "from { opacity: 1e309; transform: translateX(1e309px); } to { transform: rotate(1e308turn); }");
  for (let pass = 0; pass < 2; pass++) {
    await expect(page.locator(".kfe-modal")).toBeVisible();
    await page.getByRole("button", { name: "適用", exact: true }).click();
    await expect(page.locator(".kfe-modal")).toHaveCount(0);
    await expect(page.locator("#saved")).toContainText("opacity: 1e309;");
    await expect(page.locator("#saved")).toContainText("translateX(1e309px)");
    await expect(page.locator("#saved")).toContainText("rotate(1e308turn)");
    await expect(page.locator("#saved")).not.toContainText("Infinity");
    if (pass === 0) await page.locator("#reopen").click();
  }
  expect(errors).toEqual([]);
});

test.describe("easing pointer drag", () => {
  let bundle: string;
  test.beforeAll(async () => { bundle = await easingEditorBundle("cubic-bezier(0.25, 0.25, 0.75, 0.75)"); });
  test.beforeEach(async ({ page }) => {
    await page.setContent('<div id="app"></div>');
    await page.addStyleTag({ content: css });
    await page.evaluate(() => {
      const listeners = new Set<EventListenerOrEventListenerObject>();
      (window as any).__moves = listeners;
      const add = window.addEventListener.bind(window), remove = window.removeEventListener.bind(window);
      window.addEventListener = ((type: string, fn: any, opts: any) => { if (type === "pointermove") listeners.add(fn); add(type, fn, opts); }) as any;
      window.removeEventListener = ((type: string, fn: any, opts: any) => { if (type === "pointermove") listeners.delete(fn); remove(type, fn, opts); }) as any;
    });
    await page.addScriptTag({ content: bundle });
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
});

test("opening and applying easing preserves high-precision CSS and raw fallback values", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.setContent('<div id="app"></div>');
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: await easingEditorBundle("ease") });
  await expect(page.locator(".ee-modal")).toBeVisible();
  const computed = () => page.locator("#easing-probe").evaluate(el => getComputedStyle(el).transitionTimingFunction);

  for (const source of [
    "cubic-bezier(0.123456, 0.000001, 0.876543, 1.234567)",
    "cubic-bezier(1e-8, -2e-7, 0.9, 1.000001)",
    "steps(2.0)",
  ]) {
    await page.evaluate((next) => (window as any).__resetEasing(next), source);
    await expect(page.locator(".ee-modal")).toBeVisible();
    const before = await computed();
    for (let pass = 0; pass < 2; pass++) {
      await page.getByRole("button", { name: "適用", exact: true }).click();
      await expect(page.locator(".ee-modal")).toHaveCount(0);
      await expect.poll(computed).toBe(before);
      if (source === "steps(2.0)") await expect(page.locator("#saved")).toHaveText(source);
      if (pass === 0) await page.locator("#reopen").click();
    }
  }

  for (const rawValue of ["constructor", "__proto__", "steps(3, jump-end, ignored)"]) {
    await page.evaluate(() => (window as any).__resetEasing("ease"));
    const input = page.locator(".ee-modal input.mono");
    await input.fill(rawValue);
    await input.press("Tab");
    await expect(page.getByText("グラフでは表せない値ですが、この値のまま使えます。", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "適用", exact: true }).click();
    await expect(page.locator("#saved")).toHaveText(rawValue);
    await page.locator("#reopen").click();
    await expect(input).toHaveValue(rawValue);
    await input.fill("ease-out");
    await input.press("Tab");
    await page.getByRole("button", { name: "適用", exact: true }).click();
    await expect(page.locator("#saved")).toHaveText("ease-out");
  }
  expect(errors).toEqual([]);
});
