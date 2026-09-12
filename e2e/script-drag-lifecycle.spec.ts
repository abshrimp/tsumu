import { expect, test, type Page } from "@playwright/test";
import { makeBox } from "../lib/presets";
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
// スクリプト全体をドラッグするときの影には、絶対配置のカードが入る。大きさ 0 の親ではなく、カードを調べる。
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
    // 2本目の指や、支援技術からのボタンの操作で、履歴を変えながら元のドラッグを完了させてはならない。
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

// モーダルの表示時の変形を、決まった形で再現する。ドラッグの計測は、モーダルの
// アニメーションで拡大・縮小された矩形ではなく、レイアウトの幅を使わなければならない。
async function scaleScriptModal(page: Page) {
  await page.locator(".se").evaluate((modal) => {
    for (const animation of modal.getAnimations()) animation.finish();
    (modal as HTMLElement).style.scale = "0.94";
  });
}

test("dropping over the right side of a wide step shows the insertion bar and inserts there", async ({ page }) => {
  await page.addStyleTag({ content: '.se-ws [data-sel-key="step:wait"] { min-width: 470px; }' });
  const target = page.locator('.se-ws .se-stack[data-script-id="script"] .se-slot').last();
  // Insertion rows are deliberately zero-height, so boundingBox() can treat them as hidden.
  const rect = await target.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width };
  });
  expect(rect.width).toBeGreaterThan(300);

  await start(page, "palette");
  await pointer(page, "pointermove", { x: rect.x + rect.width - 30, y: rect.y });
  await expect(target).toHaveClass(/is-active/);
  await pointer(page, "pointerup", { x: rect.x + rect.width - 30, y: rect.y, buttons: 0 });

  await expect(transient(page)).toHaveCount(0);
  const scripts = (await snapshot(page)).doc.pages.p.pageScripts;
  expect(scripts).toHaveLength(1);
  expect(scripts[0].steps.map((step: { kind: string }) => step.kind)).toEqual(["wait", "wait"]);
});

test("drag previews stay outside the clipped dialog while crossing its edge", async ({ page }) => {
  await scaleScriptModal(page);
  const dialog = (await page.locator(".se").boundingBox())!;
  for (const kind of ["palette", "step", "script"]) {
    await start(page, kind);
    const ghost = page.locator(".se-ghost");
    await expect(visibleGhost(page)).toBeVisible();
    // The dialog clips its descendants and its scale animation changes the
    // containing block of position:fixed. The preview must escape both.
    expect(await ghost.evaluate((element) => element.parentElement === document.body)).toBe(true);

    const x = dialog.x + dialog.width - 35;
    const y = dialog.y + dialog.height - 85;
    await pointer(page, "pointermove", { x, y });
    await expect.poll(async () => (await visibleGhost(page).boundingBox())?.x ?? 0)
      .toBeGreaterThan(dialog.x + dialog.width - 100);
    await expect(visibleGhost(page)).toBeVisible();
    await pointer(page, "pointercancel", { x, y, buttons: 0 });
    await expect(transient(page)).toHaveCount(0);
  }
});

test("palette block stays visible when dragged across both conditional branches into Else", async ({ page }) => {
  await page.evaluate(() => (window as any).scriptDragEditor.getState().updateDoc((doc: any) => {
    doc.pages.p.pageScripts[0].steps = [{
      id: "condition", kind: "if",
      cond: { subject: "var", target: "", left: "ready", op: "eq", value: "true" },
      then: [], else: [],
    }];
  }));
  await scaleScriptModal(page);
  const condition = page.locator('.se-ws [data-sel-key="step:condition"]').locator("..");
  const thenSlot = condition.locator(".se-c-body").nth(0).locator(".se-slot.is-empty");
  const elseSlot = condition.locator(".se-c-body").nth(1).locator(".se-slot.is-empty");
  await expect(thenSlot).toBeVisible();
  await expect(elseSlot).toBeVisible();

  const paletteBlock = page.locator('[data-tutorial="se-block-wait"]');
  await paletteBlock.scrollIntoViewIfNeeded();
  const start = (await paletteBlock.boundingBox())!;
  let previous = { x: start.x + 28, y: start.y + 18 };
  await page.mouse.move(start.x + 8, start.y + 8);
  await page.mouse.down();
  await page.mouse.move(start.x + 28, start.y + 18, { steps: 3 });
  await expect(visibleGhost(page)).toBeVisible();

  // Move over the If branch, down to Else, back to If, then into Else again.
  // The drag preview must remain mounted during every intermediate move.
  for (const slot of [thenSlot, elseSlot, thenSlot, elseSlot]) {
    const r = (await slot.boundingBox())!;
    const target = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    // Inspect intermediate points instead of checking only the final drop target.
    for (let n = 1; n <= 8; n++) {
      const x = previous.x + (target.x - previous.x) * n / 8;
      const y = previous.y + (target.y - previous.y) * n / 8;
      await page.mouse.move(x, y);
      await expect(visibleGhost(page)).toBeVisible();
    }
    previous = target;
    await expect(slot).toHaveClass(/is-active/);
    expect(await page.locator(".se-ghost").evaluate(el => el.parentElement === document.body)).toBe(true);
  }

  await page.mouse.up();
  await expect(transient(page)).toHaveCount(0);
  const scripts = (await snapshot(page)).doc.pages.p.pageScripts;
  expect(scripts).toHaveLength(1);
  expect(scripts[0].steps[0].then).toEqual([]);
  expect(scripts[0].steps[0].else.map((step: { kind: string }) => step.kind)).toEqual(["wait"]);
});

test("dragged steps retain their width without narrowing the source stack", async ({ page }) => {
  // 幅の広い手順が、元の並びの幅を決める。それを取り除くと、通常は並びが縮む。
  await page.addStyleTag({ content: '.se-ws [data-sel-key="step:wait"] { min-width: 480px; }' });
  await scaleScriptModal(page);
  const source = page.locator('.se-ws .se-stack[data-script-id="script"]');
  const originalStack = (await source.boundingBox())!;
  await start(page, "step");
  const preview = (await visibleGhost(page).boundingBox())!;
  const remaining = (await source.boundingBox())!;
  // カードの外側の枠で比べる。この準備で画面にだけ付けた min-width の規則は、
  // 意図的に、プレビューの内側の手順の行には適用していない。
  expect(Math.abs(preview.width - originalStack.width)).toBeLessThan(1);
  expect(Math.abs(remaining.width - originalStack.width)).toBeLessThan(1);
  await pointer(page, "pointercancel", { buttons: 0 });
  await expect(transient(page)).toHaveCount(0);
});

test("dragging multiple scripts preserves each original stack width", async ({ page }) => {
  await page.evaluate(() => {
    (window as any).scriptDragEditor.getState().updateDoc((doc: any) => {
      doc.pages.p.pageScripts.push({
        id: "second", trigger: "load", pos: { x: 490, y: 32 },
        steps: [{ id: "second-wait", kind: "wait", seconds: 2 }],
      });
    });
  });
  await page.addStyleTag({ content: [
    '.se-ws .se-stack[data-script-id="script"] { min-width: 420px; }',
    '.se-ws .se-stack[data-script-id="second"] { min-width: 530px; }',
  ].join(" ") });
  await scaleScriptModal(page);
  const widths: number[] = [];
  for (const id of ["script", "second"]) {
    const hat = page.locator(`.se-ws .se-stack[data-script-id="${id}"] .se-hat`);
    const rect = (await hat.boundingBox())!;
    await hat.dispatchEvent("pointerdown", {
      pointerId: 1, pointerType: "mouse", button: 0, buttons: 1, shiftKey: true,
      clientX: rect.x + 6, clientY: rect.y + 6,
    });
    widths.push((await page.locator(`.se-ws .se-stack[data-script-id="${id}"]`).boundingBox())!.width);
  }
  await expect(page.locator(".se-ws .se-stack.is-selected")).toHaveCount(2);
  // 画面にはきっかけのブロックが複数あるため、特定のものを選ぶ。
  const mainHat = page.locator('.se-ws .se-stack[data-script-id="script"] .se-hat');
  const rect = (await mainHat.boundingBox())!;
  await mainHat.dispatchEvent("pointerdown", {
    pointerId: 1, pointerType: "touch", button: 0, buttons: 1,
    clientX: rect.x + 6, clientY: rect.y + 6,
  });
  const p = await point(page);
  await pointer(page, "pointermove", { x: p.x - 50, y: p.y - 50 });
  await expect(visibleGhost(page)).toBeVisible();
  for (const [i, id] of ["script", "second"].entries()) {
    const width = (await page.locator(`.se-ghost .se-stack[data-script-id="${id}"]`).boundingBox())!.width;
    expect(Math.abs(width - widths[i])).toBeLessThan(1);
  }
  await pointer(page, "pointercancel", { buttons: 0 });
  await expect(transient(page)).toHaveCount(0);
});


test("drag preview keeps the original input controls and appears above every script layer", async ({ page }) => {
  await page.evaluate(() => {
    (window as any).scriptDragEditor.getState().updateDoc((doc: any) => {
      doc.pages.p.pageScripts[0].steps.push({ id: "value", kind: "set-var", value: "Initial", into: "result" });
    });
  });
  const original = page.locator('.se-ws [data-sel-key="step:value"]');
  const input = original.locator("input").first();
  await input.fill("Current unsaved input");
  const before = {
    value: await input.inputValue(),
    className: await original.getAttribute("class"),
    controls: await original.locator("input,select,textarea").count(),
  };
  await start(page, "step");
  const preview = page.locator('.se-ghost [data-sel-key="step:value"]');
  await expect(preview).toBeVisible();
  expect(await preview.getAttribute("class")).toBe(before.className);
  expect(await preview.locator("input,select,textarea").count()).toBe(before.controls);
  await expect(preview.locator("input").first()).toHaveValue(before.value);
  expect(await page.locator(".se-ghost").evaluate((el) => Number(getComputedStyle(el).zIndex))).toBeGreaterThan(20);
  expect(await page.locator(".se-ghost").evaluate((el) => (el as HTMLElement).inert)).toBe(true);
  await pointer(page, "pointercancel", { buttons: 0 });
  await expect(transient(page)).toHaveCount(0);
});

test("script block clipboard supports copy, paste, cut and Undo without hijacking text or external clipboard", async ({ page }) => {
  const trigger = page.locator('.se-ws [data-sel-key="step:wait"]');
  const rect = (await trigger.boundingBox())!;
  await trigger.dispatchEvent("pointerdown", {
    pointerId: 1, pointerType: "mouse", button: 0, buttons: 1,
    clientX: rect.x + 6, clientY: rect.y + 6,
  });
  await pointer(page, "pointerup", { buttons: 0 });
  await expect(trigger).toHaveClass(/is-selected/);
  const before = await snapshot(page);
  const copied = await page.evaluate(() => {
    const data = new DataTransfer();
    const e = new ClipboardEvent("copy", { bubbles: true, cancelable: true, clipboardData: data });
    document.querySelector('.se-ws [data-sel-key="step:wait"]')!.dispatchEvent(e);
    return { prevented: e.defaultPrevented, raw: data.getData("application/x-tsumu-script+json") };
  });
  expect(copied.prevented).toBe(true);
  expect(JSON.parse(copied.raw).steps[0].id).toBe("wait");
  const paste = async (raw: string, mime = "application/x-tsumu-script+json") => page.evaluate(({ raw, mime }) => {
    const data = new DataTransfer(); data.setData(mime, raw);
    const e = new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data });
    document.querySelector(".se-ws")!.dispatchEvent(e);
    return e.defaultPrevented;
  }, { raw, mime });
  expect(await paste(copied.raw)).toBe(true);
  const afterPaste = await snapshot(page);
  const steps = afterPaste.doc.pages.p.pageScripts[0].steps;
  expect(steps).toHaveLength(2);
  expect(steps[1].id).not.toBe(steps[0].id);
  await page.keyboard.press("Control+z");
  expect((await snapshot(page)).doc).toEqual(before.doc);
  await page.keyboard.press("Control+y");
  expect((await snapshot(page)).doc).toEqual(afterPaste.doc);
  expect(await paste("Some other copied text", "text/plain")).toBe(false);
  expect((await snapshot(page)).doc).toEqual(afterPaste.doc);

  const cut = await page.evaluate(() => {
    const data = new DataTransfer();
    const e = new ClipboardEvent("cut", { bubbles: true, cancelable: true, clipboardData: data });
    document.querySelector(".se-ws")!.dispatchEvent(e);
    return { prevented: e.defaultPrevented, raw: data.getData("application/x-tsumu-script+json") };
  });
  expect(cut.prevented).toBe(true);
  expect(JSON.parse(cut.raw).steps).toHaveLength(1);
  expect((await snapshot(page)).doc.pages.p.pageScripts[0].steps).toHaveLength(1);
  await page.keyboard.press("Control+z");
  expect((await snapshot(page)).doc).toEqual(afterPaste.doc);
});

test("copying a whole script creates independent script and nested step IDs", async ({ page }) => {
  const hat = page.locator(".se-ws .se-hat").first();
  const r = (await hat.boundingBox())!;
  await hat.dispatchEvent("pointerdown", {
    pointerId: 1, pointerType: "mouse", button: 0, buttons: 1, clientX: r.x + 6, clientY: r.y + 6,
  });
  await pointer(page, "pointerup", { buttons: 0 });
  const ids = await page.evaluate(() => {
    const data = new DataTransfer();
    document.querySelector(".se-ws .se-hat")!.dispatchEvent(
      new ClipboardEvent("copy", { bubbles: true, cancelable: true, clipboardData: data })
    );
    const raw = data.getData("application/x-tsumu-script+json");
    if (!raw) return null;
    const paste = new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data });
    document.querySelector(".se-ws")!.dispatchEvent(paste);
    return { raw, accepted: paste.defaultPrevented };
  });
  expect(ids?.accepted).toBe(true);
  const scripts = (await snapshot(page)).doc.pages.p.pageScripts;
  expect(scripts).toHaveLength(2);
  expect(scripts[0].id).not.toBe(scripts[1].id);
  expect(scripts[0].steps[0].id).not.toBe(scripts[1].steps[0].id);
});

for (const hasTrailingBlock of [false, true]) {
  test(`dragging a condition with a selected element keeps its original controls and layout${hasTrailingBlock ? " across chained blocks" : ""}`, async ({ page }) => {
    // スクリプトの条件の対象には、ノードの ID ではなく、HTML の ID 属性を保存する。
    const selected = { ...makeBox("選択済みの要素（長い名前）"), id: "chosen-node", attrId: "chosen-element" };
    await page.evaluate(({ selected, hasTrailingBlock }) => {
      (window as any).scriptDragEditor.getState().updateDoc((doc: any) => {
        doc.nodes[selected.id] = selected;
        doc.pages.p.children = [selected.id];
        doc.pages.p.pageScripts[0].steps = [{
          id: "condition", kind: "if",
          cond: { subject: "value", target: selected.attrId, op: "eq", value: "first" },
          conditions: [{
            subject: "value", target: selected.attrId, op: "eq", value: "second", and: true,
          }],
          then: [{ id: "inside-condition", kind: "wait", seconds: 2 }],
          else: [],
        }, ...(hasTrailingBlock ? [{ id: "after-condition", kind: "wait", seconds: 3 }] : [])];
      });
    }, { selected, hasTrailingBlock });

    const source = page.locator('.se-ws [data-sel-key="step:condition"]');
    const appearance = (selector: string) => page.locator(selector).evaluate((element) => ({
      width: (element as HTMLElement).offsetWidth,
      height: (element as HTMLElement).offsetHeight,
      lineWidths: Array.from(element.querySelectorAll<HTMLElement>(".se-if-condition-line"),
        (line) => line.offsetWidth),
      lineHeights: Array.from(element.querySelectorAll<HTMLElement>(".se-if-condition-line"),
        (line) => line.offsetHeight),
      pickers: Array.from(element.querySelectorAll(".np-btn"), (button) => button.textContent?.trim()),
      controls: Array.from(element.querySelectorAll("input, select, button"), (control) => ({
        tag: control.tagName,
        className: control.className,
        value: control instanceof HTMLSelectElement || control instanceof HTMLInputElement
          ? control.value : control.textContent?.trim(),
      })),
    }));
    await expect(source.locator(".np-btn")).toHaveCount(2);
    await expect(source.locator(".np-btn").first()).toContainText("選択済みの要素");
    const before = await appearance('.se-ws [data-sel-key="step:condition"]');
    expect(before.controls.some((control) => control.className.includes("se-mini"))).toBe(true);

    const origin = (await source.boundingBox())!;
    await source.dispatchEvent("pointerdown", {
      pointerId: 1, pointerType: "touch", button: 0, buttons: 1,
      clientX: origin.x + 5, clientY: origin.y + 5,
    });
    const p = await point(page);
    await pointer(page, "pointermove", { x: p.x - 40, y: p.y - 40 });
    const ghost = page.locator('.se-ghost [data-sel-key="step:condition"]');
    await expect(ghost).toBeVisible();
    if (hasTrailingBlock) {
      await expect(page.locator('.se-ghost [data-sel-key="step:after-condition"]')).toBeVisible();
    }
    const after = await appearance('.se-ghost [data-sel-key="step:condition"]');
    expect(after.controls).toEqual(before.controls);
    expect(after.pickers).toEqual(before.pickers);
    expect(after.lineWidths).toEqual(before.lineWidths);
    expect(after.lineHeights).toEqual(before.lineHeights);
    expect(Math.abs(after.width - before.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.height - before.height)).toBeLessThanOrEqual(1);
    await pointer(page, "pointercancel", { buttons: 0 });
    await expect(transient(page)).toHaveCount(0);
    await expect(source.locator(".np-btn").first()).toContainText("選択済みの要素");
  });
}

test("nested step drag keeps the original indentation, border and width", async ({ page }) => {
  await page.evaluate(() => (window as any).scriptDragEditor.getState().updateDoc((doc: any) => {
    doc.pages.p.pageScripts[0].steps.push({
      id: "loop", kind: "repeat", times: 3, then: [{ id: "inside", kind: "wait", seconds: 4 }],
    });
  }));
  await page.addStyleTag({ content:
    '.se-ws [data-sel-key="step:inside"] { border-top: 3px dotted rgb(30, 70, 120); padding-left: 18px; }',
  });
  const nested = page.locator('.se-ws [data-sel-key="step:inside"]');
  const measure = (locator: typeof nested) => locator.evaluate((el) => {
    const css = getComputedStyle(el);
    return { width: (el as HTMLElement).offsetWidth, padding: css.paddingLeft,
      border: css.borderTop, radius: css.borderTopLeftRadius };
  });
  const before = await measure(nested);
  const origin = (await nested.boundingBox())!;
  await nested.dispatchEvent("pointerdown", {
    pointerId: 1, pointerType: "touch", button: 0, buttons: 1,
    clientX: origin.x + 5, clientY: origin.y + 5,
  });
  const p = await point(page);
  await pointer(page, "pointermove", { x: p.x - 40, y: p.y - 40 });
  const ghost = page.locator('.se-ghost [data-sel-key="step:inside"]');
  await expect(ghost).toBeVisible();
  expect(await measure(ghost)).toEqual(before);
  await pointer(page, "pointercancel", { buttons: 0 });
  await expect(transient(page)).toHaveCount(0);
});

test("large nested drag keeps its real header instead of switching to read-only placeholders", async ({ page }) => {
  await page.evaluate(() => (window as any).scriptDragEditor.getState().updateDoc((doc: any) => {
    doc.pages.p.pageScripts[0].steps.push({
      id: "long", kind: "repeat", times: 5,
      then: Array.from({ length: 160 }, (_, i) => ({ id: "long-" + i, kind: "wait", seconds: i + 1 })),
    });
  }));
  const original = page.locator('.se-ws [data-sel-key="step:long"]');
  const input = original.locator("input").first();
  await expect(input).toHaveValue("5");
  const origin = (await original.boundingBox())!;
  await original.dispatchEvent("pointerdown", {
    pointerId: 1, pointerType: "touch", button: 0, buttons: 1,
    clientX: origin.x + 5, clientY: origin.y + 5,
  });
  const p = await point(page);
  await pointer(page, "pointermove", { x: p.x - 40, y: p.y - 40 });
  const ghost = page.locator('.se-ghost [data-sel-key="step:long"]');
  await expect(ghost).toBeVisible();
  await expect(ghost.locator("input").first()).toHaveValue("5");
  await expect(ghost).toHaveClass(/se-c-head/);
  await pointer(page, "pointercancel", { buttons: 0 });
  await expect(transient(page)).toHaveCount(0);
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

test("duplicating from an open menu follows its block after another edit shifts the list", async ({ page }) => {
  await page.locator('.se-ws [data-sel-key="step:wait"]').click({ button: "right", position: { x: 8, y: 8 } });
  await page.evaluate(() => {
    (window as any).scriptDragEditor.getState().updateDoc((doc: any) => {
      doc.pages.p.pageScripts[0].steps.unshift({ id: "earlier", kind: "wait", seconds: 9 });
    });
  });
  await expect(page.locator('.se-ws [data-sel-key="step:earlier"]')).toBeVisible();
  await page.locator(".se-menu button").first().click();
  const steps = (await snapshot(page)).doc.pages.p.pageScripts[0].steps;
  expect(steps.map((step: { seconds: number }) => step.seconds)).toEqual([9, 1, 1]);
  expect(steps[1].id).toBe("wait");
  expect(steps[2].id).not.toBe("wait");
});
