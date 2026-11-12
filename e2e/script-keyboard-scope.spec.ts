import { expect, test, type Page } from "@playwright/test";
import { scriptKeyboardBundle } from "../tests/helpers/script-keyboard";

let bundle: string;
test.beforeAll(async () => { bundle = await scriptKeyboardBundle({ localized: true }); });
test.beforeEach(async ({ page }) => {
  // 言語のクッキーと辞書が本番と同じように読み込まれるよう、普通のオリジンを使う。
  await page.goto("/robots.txt");
  await page.setContent('<html><body><div id="app"></div></body></html>');
  await page.addScriptTag({ content: bundle });
  await expect(page.getByRole("dialog", { name: "スクリプト", exact: true })).toBeVisible();
});
const snapshot = (page: Page) => page.evaluate(() => {
  const { doc, past, future } = (window as any).scriptKeyboardEditor.getState();
  return { doc, past, future };
});
const block = (page: Page, kind: "step" | "script") => page.locator(kind === "step"
  ? '.se-ws [data-sel-key="step:open"]' : '.se-ws [data-sel-key="script:script"]');
const select = (page: Page, kind: "step" | "script") => block(page, kind).locator("select").last();
const selected = (page: Page, kind: "step" | "script") => kind === "step" ? block(page, kind) : page.locator('.se-stack[data-script-id="script"]');

for (const kind of ["step", "script"] as const) for (const key of ["Backspace", "Delete"]) {
  test(`${kind}: a closed focused native select does not delete its selected block with ${key}`, async ({ page }) => {
    // 実際のポインターでブロックを選び、ポップアップを開かずに、ネイティブの select にフォーカスする。
    await block(page, kind).locator(".se-ico").first().click();
    await expect(selected(page, kind)).toHaveClass(/is-selected/);
    await select(page, kind).focus();
    await expect(select(page, kind)).toBeFocused();
    const before = await snapshot(page);
    await page.keyboard.press(key);
    expect(await snapshot(page)).toEqual(before);
    await expect(selected(page, kind)).toHaveClass(/is-selected/);
  });
}

test("clicking a native select and accepting its option keeps Delete inside the select", async ({ page }) => {
  // select での pointerdown は、その親のブロックも選ぶ。
  await select(page, "step").click();
  await page.keyboard.press("Enter");
  await expect(select(page, "step")).toBeFocused();
  await expect(selected(page, "step")).toHaveClass(/is-selected/);
  const before = await snapshot(page);
  await page.keyboard.press("Delete");
  expect(await snapshot(page)).toEqual(before);
});

test("native arrow changes still work and Ctrl+A does not select other scripts", async ({ page }) => {
  await block(page, "step").locator(".se-ico").first().click();
  await select(page, "step").focus();
  await page.keyboard.press("ArrowDown");
  await expect(select(page, "step")).toHaveValue("r");
  await expect.poll(async () => (await snapshot(page)).doc.pages.p.pageScripts[0].steps[0].pageId).toBe("r");
  const changed = await snapshot(page);
  expect(changed.past).toHaveLength(1);
  await page.keyboard.press("ControlOrMeta+a");
  expect(await snapshot(page)).toEqual(changed);
  await expect(page.locator('.se-stack[data-script-id="other"]')).not.toHaveClass(/is-selected/);
  await page.keyboard.press("ControlOrMeta+z");
  expect(await snapshot(page)).toEqual(changed);
});

test("ordinary workspace Delete and Undo/Redo still affect exactly the selected step", async ({ page }) => {
  await block(page, "step").locator(".se-ico").first().click();
  const before = await snapshot(page);
  await page.keyboard.press("Delete");
  const after = await snapshot(page);
  expect(after.doc.pages.p.pageScripts[0].steps).toEqual([]);
  expect(after.doc.pages.p.pageScripts[1]).toEqual(before.doc.pages.p.pageScripts[1]);
  expect(after.past).toHaveLength(before.past.length + 1);
  await page.keyboard.press("ControlOrMeta+z");
  expect((await snapshot(page)).doc).toEqual(before.doc);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  expect((await snapshot(page)).doc).toEqual(after.doc);
});

for (const key of ["Backspace", "Delete", "ControlOrMeta+a", "ControlOrMeta+z", "ControlOrMeta+Shift+z"]) {
  test(`the element picker owns ${key} after tabbing from search to a button`, async ({ page }) => {
    await page.evaluate((redo) => {
      const store = (window as any).scriptKeyboardEditor.getState();
      store.updatePage("p", { title: "Keep this edit" });
      if (redo) store.undo();
    }, key.includes("Shift"));
    await block(page, "script").locator(".np-btn").click();
    const picker = page.locator("[data-se-popover]");
    await expect(picker.locator("input")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(picker.locator("button.np-special")).toBeFocused();
    await expect(selected(page, "script")).toHaveClass(/is-selected/);
    const before = await snapshot(page);
    await page.keyboard.press(key);
    expect(await snapshot(page)).toEqual(before);
    await expect(picker).toBeVisible();
    await expect(page.locator('.se-stack[data-script-id="other"]')).not.toHaveClass(/is-selected/);

    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Escape");
    await expect(picker).toHaveCount(0);
    await block(page, "script").locator(".se-ico").first().click();
    await page.keyboard.press("Delete");
    expect((await snapshot(page)).doc.pages.p.pageScripts.map((s: { id: string }) => s.id)).toEqual(["other"]);
    await page.keyboard.press("ControlOrMeta+z");
    expect((await snapshot(page)).doc).toEqual(before.doc);
  });
}
