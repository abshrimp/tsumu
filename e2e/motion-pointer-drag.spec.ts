import { expect, test, type Page } from "@playwright/test";
import { motionEditorBundle } from "../tests/helpers/motion-editor-browser";

const bundle = motionEditorBundle();
test.use({ hasTouch: true });

test.beforeEach(async ({ page }) => {
  await page.setContent('<div id="app"></div>');
  await page.addStyleTag({ path: "app/globals.css" });
  await page.addScriptTag({ content: await bundle });
  await expect(page.locator(".kfe-modal")).toBeVisible();
  await page.locator(".kfe-modal").evaluate((element) =>
    Promise.all(element.getAnimations().map((animation) => animation.finished)));
});

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

// This uses browser-generated touch pointercancel, not just a synthetic event.
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
  // Unrelated pointer events must neither move/finish the edit nor split its history.
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
