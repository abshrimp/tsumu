import { expect, test, type Page } from "@playwright/test";
import { imageDropBundle } from "../tests/helpers/image-drop";

let bundle: string;
const errors = new WeakMap<Page, string[]>();
test.beforeAll(async () => { bundle = await imageDropBundle(); });
test.beforeEach(async ({ page }) => {
  errors.set(page, []);
  page.on("pageerror", (error) => errors.get(page)!.push(error.message));
  await page.route("http://image-drop.test/", (route) => route.fulfill({ contentType: "text/html", body: '<html><body><div id="app"></div></body></html>' }));
  await page.route("http://image-drop.test/api/assets/file?**", (route) => route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>' }));
  await page.goto("http://image-drop.test/");
  await page.addScriptTag({ content: bundle });
  await expect(page.locator('[data-tutorial="canvas"]')).toBeVisible();
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
});
test.afterEach(async ({ page }) => { expect(errors.get(page)).toEqual([]); });
const target = (surface: string) => `[data-tutorial="${surface === "canvas" ? "canvas" : "layers-panel"}"]`;
const busy = (surface: string) => surface === "canvas" ? ".canvas-drop-overlay" : ".layer-uploading";
async function snapshot(page: Page) {
  return page.evaluate(() => {
    const s = (window as any).dropEditor.getState();
    return { doc: s.doc, selection: s.selection, selectedIds: s.selectedIds, past: s.past.length, future: s.future.length };
  });
}
async function holdUploads(page: Page) {
  const requests: { finish: (ok: boolean) => void; done: Promise<void> }[] = [];
  await page.route("http://image-drop.test/api/assets", async (route) => {
    let finish!: (ok: boolean) => void;
    let completed!: () => void;
    const gate = new Promise<boolean>((resolve) => { finish = resolve; });
    const done = new Promise<void>((resolve) => { completed = resolve; });
    const index = requests.length;
    requests.push({ finish, done });
    const ok = await gate;
    await route.fulfill({ status: ok ? 200 : 400, contentType: "application/json", body: JSON.stringify(ok ? { path: `assets/${index}.svg` } : { error: "upload failed" }) });
    completed();
  });
  return {
    wait: async (count: number) => { await expect.poll(() => requests.length).toBe(count); },
    release: async (index: number, ok = true) => { requests[index].finish(ok); await requests[index].done; },
  };
}
async function drop(page: Page, surface: string, names = ["new.svg"], node?: string) {
  const selector = node ? `${target(surface)} [data-${surface === "canvas" ? "node" : "layer"}="${node}"]` : target(surface);
  await page.locator(selector).evaluate(async (element, names) => {
    const dataTransfer = new DataTransfer();
    for (const name of names) dataTransfer.items.add(new File(['<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'], name, { type: "image/svg+xml" }));
    const rect = element.getBoundingClientRect();
    element.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, clientY: rect.top + rect.height / 2, dataTransfer }));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    element.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer }));
  }, names);
}

for (const surface of ["canvas", "layers"]) {
  test(`${surface}: moving to another page preserves the original drop target without stealing selection`, async ({ page }) => {
    const uploads = await holdUploads(page);
    await drop(page, surface); await uploads.wait(1);
    await page.evaluate(() => { const s = (window as any).dropEditor.getState(); s.setActivePage("q"); s.select("c"); });
    await uploads.release(0);
    await expect(page.locator(busy(surface))).toHaveCount(0);
    const after = await snapshot(page);
    expect(after.selection).toBe("c"); expect(after.selectedIds).toEqual(["c"]);
    expect(after.doc.pages.p.children).toHaveLength(3);
    expect(after.doc.pages.q.children).toEqual(["c"]);
  });

  test(`${surface}: multi-image drops and assets undo and redo as one action`, async ({ page }) => {
    const before = await snapshot(page);
    const uploads = await holdUploads(page);
    await drop(page, surface, ["one.svg", "two.svg"]); await uploads.wait(1);
    await uploads.release(0); await uploads.wait(2);
    expect((await snapshot(page)).doc).toEqual(before.doc);
    await expect(page.locator(busy(surface))).toContainText("アップロード中");
    await uploads.release(1); await expect(page.locator(busy(surface))).toHaveCount(0);
    const after = await snapshot(page);
    expect(after.doc.pages.p.children.slice(2).map((id: string) => after.doc.nodes[id].name)).toEqual(["one.svg", "two.svg"]);
    expect(after.past).toBe(1);
    await page.evaluate(() => (window as any).dropEditor.getState().undo());
    expect((await snapshot(page)).doc).toEqual(before.doc);
    await page.evaluate(() => (window as any).dropEditor.getState().redo());
    expect((await snapshot(page)).doc).toEqual(after.doc);
  });

  test(`${surface}: an in-flight Undo is not overwritten; completed files and Redo remain available`, async ({ page }) => {
    await page.evaluate(() => (window as any).dropEditor.getState().updateNode("b", { name: "Edited" }));
    const uploads = await holdUploads(page);
    await drop(page, surface, ["one.svg", "two.svg"]); await uploads.wait(1);
    await page.evaluate(() => (window as any).dropEditor.getState().undo());
    await uploads.release(0); await expect(page.locator(busy(surface))).toHaveCount(0);
    const after = await snapshot(page);
    expect(after.doc.pages.p.children).toEqual(["a", "b"]);
    expect(Object.keys(after.doc.assets)).toHaveLength(1); expect(after.future).toBe(1);
    await page.evaluate(() => (window as any).dropEditor.getState().redo());
    expect((await snapshot(page)).doc.nodes.b.name).toBe("Edited");
    expect(Object.keys((await snapshot(page)).doc.assets)).toHaveLength(1);
  });

  test(`${surface}: deleting the drop target does not create stale nodes or error dialogs`, async ({ page }) => {
    const uploads = await holdUploads(page);
    await drop(page, surface); await uploads.wait(1);
    await page.evaluate(() => (window as any).dropEditor.getState().deletePage("p"));
    await uploads.release(0); await expect(page.locator(busy(surface))).toHaveCount(0);
    const after = await snapshot(page);
    expect(after.doc.pages.p).toBeUndefined();
    expect(Object.keys(after.doc.assets)).toHaveLength(1);
    expect(Object.values(after.doc.nodes).some((node: any) => node.type === "image")).toBe(false);
    expect(await page.evaluate(() => (window as any).dropDialogs.getState().queue)).toEqual([]);
  });

  test(`${surface}: a drop completes while preserving unrelated edits`, async ({ page }) => {
    const uploads = await holdUploads(page);
    await drop(page, surface); await uploads.wait(1);
    await page.evaluate(() => {
      const s = (window as any).dropEditor.getState();
      s.updateDoc((doc: any) => { doc.siteName = "Renamed"; doc.nodes.b.name = "Edited"; }); s.select("b");
    });
    const edited = await snapshot(page);
    await uploads.release(0); await expect(page.locator(busy(surface))).toHaveCount(0);
    expect((await snapshot(page)).selection).toBe("b");
    expect((await snapshot(page)).doc.pages.p.children).toHaveLength(3);
    await page.evaluate(() => (window as any).dropEditor.getState().undo());
    expect((await snapshot(page)).doc).toEqual(edited.doc);
  });

  test(`${surface}: an older overlapping drop does not overwrite newer selection or loading state`, async ({ page }) => {
    const uploads = await holdUploads(page);
    await drop(page, surface, ["old.svg"]); await uploads.wait(1);
    await drop(page, surface, ["new.svg"]); await uploads.wait(2);
    await uploads.release(1);
    await expect.poll(async () => Object.keys((await snapshot(page)).doc.assets).length).toBe(1);
    const selected = (await snapshot(page)).selection;
    await expect(page.locator(busy(surface))).toContainText("アップロード中");
    await uploads.release(0); await expect(page.locator(busy(surface))).toHaveCount(0);
    const after = await snapshot(page);
    expect(after.selection).toBe(selected); expect(after.doc.nodes[selected].name).toBe("new.svg");
    expect(after.doc.pages.p.children).toHaveLength(4);
  });

  test(`${surface}: partial failures keep successful images in Assets and allow another drop`, async ({ page }) => {
    const uploads = await holdUploads(page);
    await drop(page, surface, ["one.svg", "two.svg"]); await uploads.wait(1);
    await uploads.release(0); await uploads.wait(2); await uploads.release(1, false);
    await expect(page.locator(busy(surface))).toHaveCount(0);
    const after = await snapshot(page);
    expect(after.doc.pages.p.children).toEqual(["a", "b"]);
    expect(Object.keys(after.doc.assets)).toHaveLength(1);
    expect(await page.evaluate(() => (window as any).dropDialogs.getState().queue.length)).toBe(1);
    await drop(page, surface, ["retry.svg"]); await uploads.wait(3); await uploads.release(2);
    await expect(page.locator(busy(surface))).toHaveCount(0);
    expect((await snapshot(page)).doc.pages.p.children).toHaveLength(3);
  });
}

for (const surface of ["canvas", "layers"]) {
  test(`${surface}: an upload started in component editing still targets the master after returning to the page`, async ({ page }) => {
    await page.evaluate(() => (window as any).dropEditor.getState().setEditingComponent("comp"));
    const uploads = await holdUploads(page);
    await drop(page, surface); await uploads.wait(1);
    await page.evaluate(() => { const s = (window as any).dropEditor.getState(); s.setActivePage("q"); s.select("c"); });
    await uploads.release(0); await expect(page.locator(busy(surface))).toHaveCount(0);
    const after = await snapshot(page);
    expect(after.doc.nodes.root.children).toHaveLength(1);
    expect(after.doc.pages.q.children).toEqual(["c"]); expect(after.selection).toBe("c");
  });

  test(`${surface}: a late upload never inserts into a deleted box`, async ({ page }) => {
    const uploads = await holdUploads(page);
    await drop(page, surface, ["nested.svg"], "a"); await uploads.wait(1);
    await page.evaluate(() => (window as any).dropEditor.getState().deleteNode("a"));
    await uploads.release(0); await expect(page.locator(busy(surface))).toHaveCount(0);
    const after = await snapshot(page);
    expect(after.doc.pages.p.children).toEqual(["b"]);
    expect(Object.keys(after.doc.assets)).toHaveLength(1);
    expect(Object.values(after.doc.nodes).some((node: any) => node.type === "image")).toBe(false);
  });

  test(`${surface}: closing the surface keeps only successfully uploaded assets`, async ({ page }) => {
    const uploads = await holdUploads(page);
    await drop(page, surface); await uploads.wait(1);
    await page.evaluate(() => (window as any).unmountDropEditor());
    await uploads.release(0);
    await expect.poll(async () => Object.keys((await snapshot(page)).doc.assets).length).toBe(1);
    expect((await snapshot(page)).doc.pages.p.children).toEqual(["a", "b"]);
    expect(await page.evaluate(() => (window as any).dropDialogs.getState().queue)).toEqual([]);
  });
}

const gestureActive = (page: Page) => page.evaluate(() => (window as any).dropEditor.getState().gestureActive);
async function settleGesture(page: Page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
type GestureControl = "padding" | "radius" | "size" | "resize" | "range" | "color";
async function openColorPicker(page: Page) {
  if (!await page.locator('[data-tutorial="style-background"] .color-pop input[type="color"]').count()) {
    await page.locator('[data-tutorial="style-background"] .color-swatch').first().click();
  }
}
async function colorInput(page: Page, kind: "range" | "color", value: string, event = "input") {
  await page.locator(`[data-tutorial="style-background"] .color-pop input[type="${kind}"]`).evaluate((element, args) => {
    // React の値の追跡を直接呼ばずに、input と change のイベントを通して、ネイティブの入力の更新を再現する。
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, args.value);
    element.dispatchEvent(new Event(args.event, { bubbles: true }));
  }, { value, event });
}
async function startControl(page: Page, control: GestureControl) {
  if (control === "color" || control === "range") {
    await openColorPicker(page);
    await colorInput(page, control, control === "range" ? "80" : "#00ff00");
    return {
      move: () => colorInput(page, control, control === "range" ? "60" : "#0000ff"),
      finish: async (ending = "up") => {
        const input = page.locator(`[data-tutorial="style-background"] .color-pop input[type="${control}"]`);
        if (ending === "close") await page.locator('[data-tutorial="style-background"] .color-swatch').first().click();
        else await input.dispatchEvent(control === "color" ? "change" : ending === "cancel" ? "pointercancel" : ending === "lost" ? "lostpointercapture" : "pointerup", { bubbles: true, pointerId: 1 });
      },
    };
  }
  const handle = control === "resize" ? page.locator('.handle.h-e').first()
    : control === "padding" ? page.locator('[data-tutorial="style-spacing"] .field-pre.scrub').first()
    : control === "size" ? page.locator('[data-tutorial="style-layout"] .size-field .field-pre.scrub').first()
    : page.locator('[data-tutorial="style-appearance"] .field-pre.scrub').nth(1);
  await handle.scrollIntoViewIfNeeded();
  const rect = (await handle.boundingBox())!;
  const x = rect.x + rect.width / 2; const y = rect.y + rect.height / 2;
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 20, y);
  return {
    move: () => page.mouse.move(x + 40, y),
    finish: async (ending = "up") => {
      if (ending === "cancel" || ending === "lost") await handle.dispatchEvent(ending === "cancel" ? "pointercancel" : "lostpointercapture", { pointerId: 1 });
      await page.mouse.up();
    },
  };
}

for (const surface of ["canvas", "layers"]) {
  for (const control of ["padding", "radius", "size", "resize", "range", "color"] as const) {
    test(`${surface}: dropping during a ${control} adjustment waits and preserves separate adjustment and image Undo steps`, async ({ page }) => {
      const before = await snapshot(page);
      const uploads = await holdUploads(page);
      await drop(page, surface); await uploads.wait(1);
      const gesture = await startControl(page, control);
      await expect.poll(() => gestureActive(page)).toBe(true);
      await uploads.release(0); await settleGesture(page);
      expect((await snapshot(page)).doc.pages.p.children).toEqual(["a", "b"]);
      await gesture.move(); const edited = await snapshot(page);
      await gesture.finish();
      await expect.poll(async () => (await snapshot(page)).doc.pages.p.children.length).toBe(3);
      expect(await gestureActive(page)).toBe(false);
      const completed = await snapshot(page);
      await page.evaluate(() => (window as any).dropEditor.getState().undo());
      expect((await snapshot(page)).doc).toEqual(edited.doc);
      await page.evaluate(() => (window as any).dropEditor.getState().undo());
      expect((await snapshot(page)).doc).toEqual(before.doc);
      await page.evaluate(() => { const s = (window as any).dropEditor.getState(); s.redo(); s.redo(); });
      expect((await snapshot(page)).doc).toEqual(completed.doc);
    });
  }
}

for (const control of ["padding", "resize", "range", "color"] as const) {
  for (const ending of ["cancel", "lost", "blur", "target", "unmount"] as const) {
    if (control === "color" && (ending === "cancel" || ending === "lost")) continue;
    test(`${control}: ${ending} releases continuous editing and unblocks pending drops`, async ({ page }) => {
      const uploads = await holdUploads(page);
      // キャンバスだけを閉じた場合も、レイヤーへのドロップが完了することを確かめる。
      await drop(page, "layers"); await uploads.wait(1);
      const gesture = await startControl(page, control);
      await expect.poll(() => gestureActive(page)).toBe(true);
      await uploads.release(0); await settleGesture(page);
      expect((await snapshot(page)).doc.pages.p.children).toHaveLength(2);
      const edited = await snapshot(page);
      if (ending === "blur") await page.evaluate(() => window.dispatchEvent(new Event("blur")));
      else if (ending === "target") await page.evaluate(() => (window as any).dropEditor.getState().setBreakpoint("sm"));
      else if (ending === "unmount") await page.evaluate((control) => (window as any)[control === "resize" ? "closeDropCanvas" : "closeDropInspector"](), control);
      else await gesture.finish(ending);
      await expect.poll(() => gestureActive(page)).toBe(false);
      await expect.poll(async () => (await snapshot(page)).doc.pages.p.children.length).toBe(3);
      await page.mouse.up();
      await page.evaluate(() => (window as any).dropEditor.getState().undo());
      expect((await snapshot(page)).doc).toEqual(edited.doc);
    });
  }
}

test("An unchanged native color change and a change-only commit both unblock pending drops", async ({ page }) => {
  const uploads = await holdUploads(page);
  await drop(page, "canvas"); await uploads.wait(1);
  await openColorPicker(page);
  await colorInput(page, "color", "#00ff00");
  await expect.poll(() => gestureActive(page)).toBe(true);
  await uploads.release(0); await settleGesture(page);
  expect((await snapshot(page)).doc.pages.p.children).toHaveLength(2);
  // 値が変わらないと React は onChange を呼ばないが、ネイティブの確定のイベントで操作を終えなければならない。
  await page.locator('[data-tutorial="style-background"] input[type="color"]').dispatchEvent("change", { bubbles: true });
  await expect.poll(async () => (await snapshot(page)).doc.pages.p.children.length).toBe(3);
  await page.evaluate(() => (window as any).dropEditor.getState().select("a"));
  await drop(page, "canvas", ["second.svg"]); await uploads.wait(2);
  await openColorPicker(page);
  await colorInput(page, "color", "#0000ff", "change");
  await expect.poll(() => gestureActive(page)).toBe(false);
  await uploads.release(1);
  await expect.poll(async () => (await snapshot(page)).doc.pages.p.children.length).toBe(4);
  await page.evaluate(() => (window as any).dropEditor.getState().undo());
  expect((await snapshot(page)).doc.nodes.a.styles.base.default.backgroundColor).toBe("#0000ff");
});

test("Repeated range arrow-key changes do not interrupt an active drag with a drop", async ({ page }) => {
  const uploads = await holdUploads(page);
  await drop(page, "layers"); await uploads.wait(1);
  await openColorPicker(page);
  await page.locator('[data-tutorial="style-background"] input[type="range"]').focus();
  await page.keyboard.down("ArrowLeft");
  await expect.poll(() => gestureActive(page)).toBe(true);
  await uploads.release(0); await settleGesture(page);
  await page.keyboard.down("ArrowLeft"); await settleGesture(page);
  expect(await gestureActive(page)).toBe(true);
  expect((await snapshot(page)).doc.pages.p.children).toHaveLength(2);
  const edited = await snapshot(page);
  await page.keyboard.up("ArrowLeft");
  await expect.poll(async () => (await snapshot(page)).doc.pages.p.children.length).toBe(3);
  await page.evaluate(() => (window as any).dropEditor.getState().undo());
  expect((await snapshot(page)).doc).toEqual(edited.doc);
});

test("Two real controls keep pending drops blocked until the last gesture owner finishes", async ({ page }) => {
  const before = await snapshot(page);
  const uploads = await holdUploads(page);
  await drop(page, "canvas"); await uploads.wait(1);
  const handles = [page.locator('[data-tutorial="style-spacing"] .field-pre.scrub').first(), page.locator('[data-tutorial="style-appearance"] .field-pre.scrub').nth(1)];
  for (let i = 0; i < handles.length; i++) {
    // キャプチャだけを差し替えて2つのポインターを再現し、React のポインターのハンドラーと DOM のリスナーは実際のものを使う。
    await handles[i].evaluate((element, pointerId) => {
      (element as HTMLElement).setPointerCapture = () => {};
      element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId, clientX: 0, buttons: 1 }));
      element.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId, clientX: 20, buttons: 1 }));
    }, i + 1);
  }
  await uploads.release(0); await settleGesture(page);
  await handles[0].dispatchEvent("pointerup", { pointerId: 1 });
  expect(await gestureActive(page)).toBe(true);
  expect((await snapshot(page)).doc.pages.p.children).toHaveLength(2);
  await handles[1].dispatchEvent("pointermove", { pointerId: 2, clientX: 40, buttons: 1 });
  const edited = await snapshot(page);
  await handles[1].dispatchEvent("pointerup", { pointerId: 2 });
  await expect.poll(async () => (await snapshot(page)).doc.pages.p.children.length).toBe(3);
  await page.evaluate(() => (window as any).dropEditor.getState().undo());
  expect((await snapshot(page)).doc).toEqual(edited.doc);
  await page.evaluate(() => (window as any).dropEditor.getState().undo());
  expect((await snapshot(page)).doc).toEqual(before.doc);
});
