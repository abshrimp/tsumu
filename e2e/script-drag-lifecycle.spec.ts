import { expect, test, type Page } from "@playwright/test";
import { scriptDragBundle } from "../tests/helpers/script-drag";

let bundle: string;
test.beforeAll(async () => { bundle = await scriptDragBundle(); });
test.beforeEach(async ({ page }) => {
  await page.setContent('<html><body><div id="app"></div></body></html>');
  await page.addScriptTag({ content: bundle });
  await expect(page.getByRole("dialog", { name: "スクリプト", exact: true })).toBeVisible();
});
const snapshot = (page: Page) => page.evaluate(() => {
  const s = (window as any).scriptDragEditor.getState();
  return { doc: s.doc, past: s.past.length, future: s.future.length };
});
// A whole-script drag ghost contains absolutely positioned cards; inspect a card, not the zero-sized parent.
const visibleGhost = (page: Page) => page.locator(".se-ghost .se-stack").first();
const transient = (page: Page) => page.locator(".se-ghost, .se-marquee, .se-slot.is-active, .se-hat-slot.is-active");
const owner = (kind: string) => kind === "marquee" ? ".se-ws" : kind === "palette" ? '[data-tutorial="se-block-wait"]' :
  kind === "step" ? '.se-ws [data-sel-key="step:wait"]' : ".se-ws .se-hat";
async function point(page: Page) {
  const r = await page.locator(".se-ws").boundingBox();
  return { x: r!.x + r!.width - 70, y: r!.y + r!.height - 80 };
}
async function pointer(page: Page, type: string, { id = 1, buttons = 1, x, y }: { id?: number; buttons?: number; x?: number; y?: number } = {}) {
  const p = x === undefined || y === undefined ? await point(page) : { x, y };
  await page.evaluate(({ type, id, buttons, p }) => window.dispatchEvent(new PointerEvent(type, {
    bubbles: true, pointerId: id, pointerType: "touch", button: 0, buttons, clientX: p.x, clientY: p.y,
  })), { type, id, buttons, p });
}
async function start(page: Page, kind: string) {
  const target = page.locator(owner(kind));
  const rect = await target.boundingBox();
  const origin = kind === "marquee" ? await point(page) : { x: rect!.x + 6, y: rect!.y + 6 };
  await target.dispatchEvent("pointerdown", { pointerId: 1, pointerType: "touch", button: 0, buttons: 1, clientX: origin.x, clientY: origin.y });
  const p = await point(page);
  await pointer(page, "pointermove", { x: p.x - 50, y: p.y - 50 });
  await expect(kind === "marquee" ? page.locator(".se-marquee") : visibleGhost(page)).toBeVisible();
}

for (const kind of ["script", "step", "palette", "marquee"]) {
  for (const end of ["pointercancel", "blur", "released-outside", "escape"]) {
    test(`${kind}: ${end} leaves no stale gesture or accidental edit`, async ({ page }) => {
      await page.evaluate(() => {
        const s = (window as any).scriptDragEditor.getState(); s.updatePage("p", { title: "Undoable" }); s.undo();
      });
      const before = await snapshot(page);
      await start(page, kind);
      if (end === "pointercancel") await pointer(page, "pointercancel", { buttons: 0 });
      if (end === "blur") await page.evaluate(() => window.dispatchEvent(new Event("blur")));
      if (end === "released-outside") await pointer(page, "pointermove", { buttons: 0 });
      if (end === "escape") await page.keyboard.press("Escape");
      await expect(transient(page)).toHaveCount(0);
      await expect(page.getByRole("dialog", { name: "スクリプト", exact: true })).toBeVisible();
      await pointer(page, "pointermove", { buttons: 0 }); await pointer(page, "pointerup", { buttons: 0 });
      expect(await snapshot(page)).toEqual(before);
      await expect(page.getByRole("button", { name: "やり直す", exact: true })).toBeEnabled();
      if (kind !== "marquee") await expect(page.locator('.se-ws [data-sel-key="step:wait"]')).toBeVisible();
      await start(page, kind);
      await pointer(page, "pointerup", { buttons: 0 });
      await expect(transient(page)).toHaveCount(0);
      if (kind !== "marquee") {
        const after = await snapshot(page); expect(after.past).toBe(before.past + 1); expect(after.future).toBe(0);
        await page.keyboard.press("Control+z"); expect((await snapshot(page)).doc).toEqual(before.doc);
        await page.keyboard.press("Control+y"); expect((await snapshot(page)).doc).toEqual(after.doc);
      }
    });
  }
}

for (const action of ["undo", "redo", "page", "replace"]) test(`an active step drag cannot overwrite ${action}`, async ({ page }) => {
  await page.evaluate((action) => {
    const s = (window as any).scriptDragEditor.getState(); s.updatePage("p", { title: "Changed" }); if (action === "redo") s.undo();
  }, action);
  await start(page, "step");
  if (action === "undo" || action === "redo") {
    // A second finger or an accessibility button action must not complete the original drag while changing history.
    await page.getByRole("button", { name: action === "undo" ? "取り消す" : "やり直す", exact: true }).dispatchEvent("click");
  } else await page.evaluate((action) => {
    const s = (window as any).scriptDragEditor.getState();
    if (action === "page") s.setActivePage("q"); else s.replaceDoc(structuredClone(s.doc));
  }, action);
  await expect(transient(page)).toHaveCount(0);
  const before = await snapshot(page);
  await pointer(page, "pointermove"); await pointer(page, "pointerup", { buttons: 0 });
  expect(await snapshot(page)).toEqual(before);
  expect(before.doc.pages.p.pageScripts[0].steps[0].id).toBe("wait");
  if (action === "page") expect(before.doc.pages.q.pageScripts).toBeUndefined();
});

test("other pointers cannot replace, move, cancel, or finish the owner", async ({ page }) => {
  const before = await snapshot(page);
  await start(page, "script");
  const ghost = page.locator(".se-ghost");
  const position = await ghost.getAttribute("style");
  const p = await point(page);
  await page.locator(owner("palette")).dispatchEvent("pointerdown", { pointerId: 2, pointerType: "touch", button: 0, buttons: 1, clientX: p.x, clientY: p.y });
  await page.locator(".se-ws").dispatchEvent("pointerdown", { pointerId: 2, pointerType: "touch", button: 0, buttons: 1, clientX: p.x, clientY: p.y });
  for (const type of ["pointermove", "pointercancel", "pointerup"]) {
    await pointer(page, type, { id: 2, x: 100, y: 200, buttons: 0 });
    await expect(visibleGhost(page)).toBeVisible(); expect(await ghost.getAttribute("style")).toBe(position);
    expect(await snapshot(page)).toEqual(before);
  }
  await pointer(page, "pointermove"); await pointer(page, "pointerup", { buttons: 0 });
  await expect(transient(page)).toHaveCount(0);
  expect((await snapshot(page)).past).toBe(1);
});

test("closing during a drag and reopening leaves no late operation or listener", async ({ page }) => {
  const before = await snapshot(page);
  await start(page, "step");
  await page.getByRole("button", { name: "閉じる", exact: true }).dispatchEvent("click");
  await expect(page.locator(".se")).toHaveCount(0);
  await pointer(page, "pointermove", { x: 800, y: 400 }); await pointer(page, "pointerup", { x: 800, y: 400, buttons: 0 });
  await page.locator("#reopen-script").click();
  await expect(page.locator('.se-ws [data-sel-key="step:wait"]')).toBeVisible();
  await expect(transient(page)).toHaveCount(0); expect(await snapshot(page)).toEqual(before);
  await start(page, "script"); await pointer(page, "pointerup", { buttons: 0 });
  expect((await snapshot(page)).past).toBe(1);
});

test("a real mouse drop still moves one stack and supports Undo/Redo", async ({ page }) => {
  const before = await snapshot(page);
  const r = await page.locator(owner("script")).boundingBox(); const p = await point(page);
  await page.mouse.move(r!.x + 6, r!.y + 6); await page.mouse.down();
  await page.mouse.move(p.x, p.y, { steps: 5 }); await expect(visibleGhost(page)).toBeVisible();
  await page.mouse.up(); await expect(transient(page)).toHaveCount(0);
  const moved = await snapshot(page); expect(moved.past).toBe(1); expect(moved.doc).not.toEqual(before.doc);
  await page.keyboard.press("Control+z"); expect((await snapshot(page)).doc).toEqual(before.doc);
  await page.keyboard.press("Control+y"); expect((await snapshot(page)).doc).toEqual(moved.doc);
});

test("cancelling over the palette removes imperative trash feedback", async ({ page }) => {
  const before = await snapshot(page);
  await start(page, "palette");
  const palette = page.locator(".se-pal-wrap");
  const r = await palette.boundingBox();
  await pointer(page, "pointermove", { x: r!.x + 20, y: r!.y + 20 });
  await expect(palette).toHaveClass(/is-trash/);
  await page.keyboard.press("Escape");
  await expect(palette).not.toHaveClass(/is-trash/);
  await expect(transient(page)).toHaveCount(0);
  expect(await snapshot(page)).toEqual(before);
});

test("marquee selects blocks reached only by the release event", async ({ page }) => {
  const before = await snapshot(page);
  await start(page, "marquee");
  const block = page.locator('.se-ws [data-sel-key="step:wait"]');
  await expect(block).not.toHaveClass(/is-selected/);
  const r = await block.boundingBox();
  await pointer(page, "pointerup", { x: r!.x + 5, y: r!.y + 5, buttons: 0 });
  await expect(block).toHaveClass(/is-selected/);
  await expect(transient(page)).toHaveCount(0);
  expect(await snapshot(page)).toEqual(before);
});
