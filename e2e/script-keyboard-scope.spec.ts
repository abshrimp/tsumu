import { expect, test, type Page } from "@playwright/test";
import { scriptKeyboardBundle } from "../tests/helpers/script-keyboard";

let bundle: string;
test.beforeAll(async () => { bundle = await scriptKeyboardBundle(); });
test.beforeEach(async ({ page }) => {
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
    // Select a block with the real pointer, then focus the native select without opening its popup.
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
  // Pointerdown on the select also selects its parent block.
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
