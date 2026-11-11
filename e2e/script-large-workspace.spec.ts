import { expect, test } from "@playwright/test";
import { scriptDragBundle, scriptDragDoc } from "../tests/helpers/script-drag";
import type { ScriptStep } from "../lib/types";

let bundle: string;
test.beforeAll(async () => {
  const doc = scriptDragDoc();
  doc.pages.p.pageScripts![0].steps = Array.from({ length: 4000 }, (_, i): ScriptStep => ({
    id: "wait-" + i, kind: "wait", seconds: 1,
  }));
  bundle = await scriptDragBundle(doc);
});

test("a 4000-block workspace mounts nearby blocks, scrolls to distant blocks and preserves edits", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setContent('<html><body><div id="app"></div></body></html>');
  await page.addScriptTag({ content: bundle });

  const workspace = page.locator(".se-ws");
  await expect(workspace).toBeVisible();
  await expect(workspace.locator('[data-sel-key="step:wait-0"]')).toBeVisible();
  await expect(workspace.locator(".se-virtual-chunk")).toHaveCount(84);
  const mounted = () => workspace.locator('[data-sel-key^="step:"]').count();
  expect(await mounted()).toBeLessThan(400);

  // The last block must still be addressable by scrolling over placeholders.
  await workspace.locator(".se-virtual-chunk").last().evaluate((el) =>
    el.scrollIntoView({ block: "center" }));
  await expect(workspace.locator('[data-sel-key="step:wait-3999"]')).toBeVisible();
  expect(await mounted()).toBeLessThan(400);

  const input = workspace.locator('[data-sel-key="step:wait-3999"] input.se-in');
  await input.fill("2");
  await input.blur();
  const seconds = () => page.evaluate(() => {
    const store = (window as any).scriptDragEditor.getState();
    const script = store.doc.pages.p.pageScripts[0];
    return (script.steps[3999] as { seconds: number | string }).seconds;
  });
  await expect.poll(seconds).toBe(2);
  await page.evaluate(() => (window as any).scriptDragEditor.getState().undo());
  await expect.poll(seconds).toBe(1);
  await page.evaluate(() => (window as any).scriptDragEditor.getState().redo());
  await expect.poll(seconds).toBe(2);
  expect(errors).toEqual([]);
});

test("an offscreen chunk retains a focused draft and releases it after committing on blur", async ({ page }) => {
  await page.setContent('<html><body><div id="app"></div></body></html>');
  await page.addScriptTag({ content: bundle });
  const workspace = page.locator(".se-ws");
  await expect(workspace.locator('[data-sel-key="step:wait-0"]')).toBeVisible();
  const field = workspace.locator('[data-sel-key="step:wait-0"] input.se-in');
  await field.fill("2");
  await workspace.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await expect(workspace.locator('[data-sel-key="step:wait-3999"]')).toBeVisible();
  await expect(field).toBeAttached();
  await expect(field).toHaveValue("2");
  expect(await field.evaluate((el) => el === document.activeElement)).toBe(true);
  await field.blur();
  await expect(field).toHaveCount(0);
  await expect.poll(() => page.evaluate(() =>
    (window as any).scriptDragEditor.getState().doc.pages.p.pageScripts[0].steps[0].seconds
  )).toBe(2);

  await workspace.evaluate((el) => { el.scrollTop = 0; });
  await expect(field).toBeVisible();
  await expect(field).toHaveValue("2");
});

test("hundreds of separate script stacks mount only those near the viewport", async ({ page }) => {
  const doc = scriptDragDoc();
  doc.pages.p.pageScripts = Array.from({ length: 160 }, (_, i) => ({
    id: "stack-" + i, trigger: "load" as const,
    pos: { x: 32, y: 32 + i * 150 },
    steps: [{ id: "wait-stack-" + i, kind: "wait" as const, seconds: 1 }],
  }));
  const content = await scriptDragBundle(doc);
  await page.setContent('<html><body><div id="app"></div></body></html>');
  await page.addScriptTag({ content });
  const workspace = page.locator(".se-ws");
  await expect(workspace.locator('[data-script-id="stack-0"] .se-hat')).toBeVisible();
  await expect(workspace.locator(".se-stack")).toHaveCount(160);
  expect(await workspace.locator(".se-stack .se-blk").count()).toBeLessThan(50);
  await workspace.locator('[data-script-id="stack-159"]').evaluate((el) =>
    el.scrollIntoView({ block: "center" }));
  await expect(workspace.locator('[data-script-id="stack-159"] .se-hat')).toBeVisible();
  expect(await workspace.locator(".se-stack .se-blk").count()).toBeLessThan(50);
});

test("offscreen stacks release focus retention without losing edits or accumulating mounted blocks", async ({ page }) => {
  const doc = scriptDragDoc();
  doc.pages.p.pageScripts = Array.from({ length: 60 }, (_, i) => ({
    id: "stack-" + i, trigger: "load" as const,
    pos: { x: 32, y: 32 + i * 200 },
    steps: [{ id: "wait-stack-" + i, kind: "wait" as const, seconds: 1 }],
  }));
  await page.setContent('<html><body><div id="app"></div></body></html>');
  await page.addScriptTag({ content: await scriptDragBundle(doc) });
  const workspace = page.locator(".se-ws");
  // Each old stack is well outside the observer's overscan before focus leaves.
  for (const index of [0, 20, 40]) {
    const stack = workspace.locator(`[data-script-id="stack-${index}"]`);
    const field = stack.locator("input.se-in");
    await expect(field).toBeVisible();
    await field.fill("2");
    const next = workspace.locator(`[data-script-id="stack-${index + 19}"]`);
    await next.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await expect(next.locator("input.se-in")).toBeVisible();
    await expect(field).toHaveValue("2");
    expect(await field.evaluate((el) => el === document.activeElement)).toBe(true);
    await field.blur();
    await expect(stack.locator(".se-blk")).toHaveCount(0);
    await expect.poll(() => page.evaluate((i) =>
      (window as any).scriptDragEditor.getState().doc.pages.p.pageScripts[i].steps[0].seconds,
    index)).toBe(2);
    if (index < 40) {
      await workspace.locator(`[data-script-id="stack-${index + 20}"]`)
        .evaluate((el) => el.scrollIntoView({ block: "center" }));
    }
  }
  expect(await workspace.locator(".se-stack .se-blk").count()).toBeLessThan(40);
  await workspace.evaluate((el) => { el.scrollTop = 0; });
  await expect(workspace.locator('[data-script-id="stack-0"] input.se-in')).toHaveValue("2");
});

test("workspace grid scrolls with the content and stays aligned when zooming", async ({ page }) => {
  await page.setContent('<html><body><div id="app"></div></body></html>');
  await page.addScriptTag({ content: bundle });

  const workspace = page.locator(".se-ws");
  await expect(workspace).toBeVisible();

  const background = () => workspace.evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      attachment: style.backgroundAttachment,
      size: style.backgroundSize,
      scrollTop: el.scrollTop,
    };
  });

  expect(await background()).toMatchObject({ attachment: "local", size: "16px 16px" });
  await workspace.evaluate((el) => { el.scrollTop = 123; });
  await expect.poll(async () => (await background()).scrollTop).toBeGreaterThan(0);
  expect((await background()).attachment).toBe("local");

  await page.locator(".se-zoom button").last().click();
  await expect.poll(async () => parseFloat((await background()).size))
    .toBeCloseTo(17.6, 1);
  expect((await background()).attachment).toBe("local");
});
