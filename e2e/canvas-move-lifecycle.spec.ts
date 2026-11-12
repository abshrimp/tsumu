import { expect, test, type Page } from "@playwright/test";
import { canvasMoveBundle, canvasMoveDoc } from "../tests/helpers/canvas-move";

const node = (page: Page, id: string) => page.locator(`.cv-root [data-node="${id}"]`);
const snapshot = (page: Page) => page.evaluate(() => {
  const s = (window as any).canvasMoveEditor.getState();
  return { doc: s.doc, past: s.past, future: s.future };
});
async function point(page: Page, id: string, after = false) {
  const rect = (await node(page, id).boundingBox())!;
  return { x: rect.x + rect.width / 2, y: rect.y + (after ? rect.height - 5 : 10) };
}
async function pointer(page: Page, type: string, { id = 1, buttons = 1, x, y }: { id?: number; buttons?: number; x?: number; y?: number } = {}) {
  const p = x === undefined || y === undefined ? await point(page, "c", true) : { x, y };
  await page.evaluate(({ type, id, buttons, p }) => window.dispatchEvent(new PointerEvent(type, {
    bubbles: true, pointerId: id, pointerType: "touch", button: 0, buttons, clientX: p.x, clientY: p.y,
  })), { type, id, buttons, p });
}
async function start(page: Page, id = "a") {
  const p = await point(page, id);
  await node(page, id).dispatchEvent("pointerdown", { pointerId: 1, pointerType: "touch", button: 0, buttons: 1, clientX: p.x, clientY: p.y });
  await pointer(page, "pointermove");
  await expect(node(page, id)).toHaveCSS("opacity", "0.35");
  await expect(page.locator(".move-line")).toBeVisible();
}
async function cleared(page: Page) {
  await expect(page.locator(".move-line")).toHaveCount(0);
  await expect.poll(() => page.locator(".canvas-inner > style").allTextContents()).not.toContainEqual(expect.stringContaining("cursor: grabbing"));
}
async function mouseDrag(page: Page, from: string, to: string) {
  const p = await point(page, from), q = await point(page, to, true);
  await page.mouse.move(p.x, p.y); await page.mouse.down();
  await page.mouse.move(q.x, q.y, { steps: 5 });
  await expect(node(page, from)).toHaveCSS("opacity", "0.35");
}
const order = (page: Page) => page.locator(".cv-root > [data-node]").evaluateAll((els) => els.map((el) => el.getAttribute("data-node")));

test.describe("Canvas movement fixture", () => {
  test.use({ hasTouch: true });
  let bundle: string;
  test.beforeAll(async () => { bundle = await canvasMoveBundle(); });
  test.beforeEach(async ({ page }) => {
    await page.setContent('<html><body><div id="app"></div></body></html>');
    await page.addScriptTag({ content: bundle });
    await expect(node(page, "c")).toBeVisible();
  });

  // Node covers all synthetic interruption events. Exercise keyboard and React
  // cleanup here alongside the trusted touch cancellation below.
  for (const end of ["escape", "unmount"] as const) {
    test(`${end} clears the drag and preserves document, undo, and redo through a late release`, async ({ page }) => {
      await page.evaluate(() => {
        const s = (window as any).canvasMoveEditor.getState(); s.updatePage("p", { title: "Undoable" }); s.undo();
      });
      const before = await snapshot(page);
      await start(page);
      const release = await point(page, "c", true);
      if (end === "escape") await page.keyboard.press("Escape");
      else await page.evaluate(() => (window as any).showCanvas(false));
      await cleared(page);
      await pointer(page, "pointermove", release); await pointer(page, "pointerup", { ...release, buttons: 0 });
      expect(await snapshot(page)).toEqual(before);
      if (end === "unmount") await page.evaluate(() => (window as any).showCanvas(true));
      await expect(node(page, "a")).toHaveCSS("opacity", "1");
      await start(page); await pointer(page, "pointerup", { buttons: 0 });
      await cleared(page); expect(await order(page)).toEqual(["b", "c", "a"]);
      const moved = await snapshot(page); expect(moved.past).toHaveLength(before.past.length + 1); expect(moved.future).toHaveLength(0);
      await page.evaluate(() => (window as any).canvasMoveEditor.getState().undo()); expect((await snapshot(page)).doc).toEqual(before.doc);
      await page.evaluate(() => (window as any).canvasMoveEditor.getState().redo()); expect((await snapshot(page)).doc).toEqual(moved.doc);
    });
  }

  // Keep cases that replace the displayed page, document or editing surface.
  // The Node suite checks the full store matrix for pending and active drags.
  for (const change of ["page", "remote", "replace", "mode"] as const) {
    test(`${change} invalidates the pending drop before the owner releases`, async ({ page }) => {
      await page.evaluate(() => (window as any).canvasMoveEditor.getState().updatePage("p", { title: "Changed" }));
      await start(page);
      const release = await point(page, "c", true);
      await page.evaluate((change) => {
        const s = (window as any).canvasMoveEditor.getState();
        if (change === "page") s.setActivePage("q");
        if (change === "replace") s.replaceDoc(structuredClone(s.doc));
        if (change === "remote") { const doc = structuredClone(s.doc); doc.nodes.b.name = "Remote"; s.applyRemoteDoc(doc); }
        if (change === "mode") s.setMode("preview");
      }, change);
      await cleared(page);
      const interrupted = await snapshot(page);
      await pointer(page, "pointermove", release); await pointer(page, "pointerup", { ...release, buttons: 0 });
      expect(await snapshot(page)).toEqual(interrupted);
      expect(interrupted.doc.pages.p.children).toEqual(["a", "b", "c"]);
    });
  }

  test("other pointers cannot replace, move, cancel, or commit the owner", async ({ page }) => {
    const before = await snapshot(page); await start(page);
    const line = await page.locator(".move-line").getAttribute("style");
    const p = await point(page, "b");
    await node(page, "b").dispatchEvent("pointerdown", { pointerId: 2, pointerType: "touch", button: 0, buttons: 1, clientX: p.x, clientY: p.y });
    for (const type of ["pointermove", "pointercancel", "pointerup"]) {
      await pointer(page, type, { id: 2, buttons: 0, ...p });
      await expect(node(page, "a")).toHaveCSS("opacity", "0.35");
      expect(await page.locator(".move-line").getAttribute("style")).toBe(line); expect(await snapshot(page)).toEqual(before);
    }
    await pointer(page, "pointerup", { buttons: 0 });
    await cleared(page); expect(await order(page)).toEqual(["b", "c", "a"]);
    expect((await snapshot(page)).past).toHaveLength(1);
  });

  for (const multiple of [false, true]) test(`real mouse ${multiple ? "multiple" : "single"} movement remains one reversible edit from hover style`, async ({ page }) => {
    await page.evaluate((multiple) => {
      const s = (window as any).canvasMoveEditor.getState();
      if (multiple) s.selectMany(["a", "b"], "a"); else s.select("b");
      s.setStyleState("hover");
    }, multiple);
    const before = await snapshot(page);
    await mouseDrag(page, "a", "c"); await page.mouse.up(); await cleared(page);
    expect(await order(page)).toEqual(multiple ? ["c", "a", "b"] : ["b", "c", "a"]);
    const moved = await snapshot(page); expect(moved.past).toHaveLength(1);
    await page.evaluate(() => (window as any).canvasMoveEditor.getState().undo()); expect((await snapshot(page)).doc).toEqual(before.doc);
    await page.evaluate(() => (window as any).canvasMoveEditor.getState().redo()); expect((await snapshot(page)).doc).toEqual(moved.doc);
  });

  test("a browser-generated touch cancellation removes the drag before a late release", async ({ page }) => {
    const before = await snapshot(page);
    const p = await point(page, "a");
    const touch = await page.context().newCDPSession(page);
    await page.evaluate(() => {
      (window as any).touchCancels = [];
      window.addEventListener("pointercancel", (e) => (window as any).touchCancels.push({ trusted: e.isTrusted, id: e.pointerId }));
    });
    await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: p.x, y: p.y, id: 7 }] });
    await touch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: p.x + 8, y: p.y, id: 7 }] });
    await expect(node(page, "a")).toHaveCSS("opacity", "0.35");
    await touch.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
    await cleared(page);
    const cancelled = await page.evaluate(() => (window as any).touchCancels);
    expect(cancelled).toHaveLength(1); expect(cancelled[0].trusted).toBe(true);
    await pointer(page, "pointerup", { id: cancelled[0].id, buttons: 0 });
    expect(await snapshot(page)).toEqual(before);
    await mouseDrag(page, "a", "c"); await page.mouse.up();
    expect(await order(page)).toEqual(["b", "c", "a"]); expect((await snapshot(page)).past).toHaveLength(1);
  });
});

test("the real Editor Ctrl+Z during a mouse drag cannot be overwritten by releasing it", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem("tsumu-help-seen-v1", "1"));
  const created = await page.request.post("/api/sites", { data: { name: "Canvas undo lifecycle" } });
  expect(created.ok()).toBeTruthy();
  const { site } = await created.json();
  expect((await page.request.put(`/api/doc?site=${site.id}`, { data: canvasMoveDoc() })).ok()).toBeTruthy();
  await page.goto(`/sites/${site.id}`);
  await expect(node(page, "c")).toBeVisible();
  await expect(page.locator('[data-tutorial="save-status"]')).toContainText("サーバー保存済み");
  await mouseDrag(page, "a", "c"); await page.mouse.up();
  expect(await order(page)).toEqual(["b", "c", "a"]);
  await mouseDrag(page, "b", "a");
  await page.keyboard.press("ControlOrMeta+z"); await cleared(page);
  expect(await order(page)).toEqual(["a", "b", "c"]);
  await page.mouse.up(); await cleared(page);
  expect(await order(page)).toEqual(["a", "b", "c"]);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  expect(await order(page)).toEqual(["b", "c", "a"]);
  await page.keyboard.press("ControlOrMeta+z");
  expect(await order(page)).toEqual(["a", "b", "c"]);
  expect(errors).toEqual([]);
});
