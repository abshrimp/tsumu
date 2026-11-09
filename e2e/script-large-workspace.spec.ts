import { expect, test } from "@playwright/test";
import { scriptDragBundle, scriptDragDoc } from "../tests/helpers/script-drag";
import type { ScriptStep } from "../lib/types";
import { scriptWorkspaceDoc } from "../tests/helpers/script-workspace";

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

test("a focused field remains mounted during offscreen scrolling", async ({ page }) => {
  await page.setContent('<html><body><div id="app"></div></body></html>');
  await page.addScriptTag({ content: bundle });
  const workspace = page.locator(".se-ws");
  await expect(workspace.locator('[data-sel-key="step:wait-0"]')).toBeVisible();
  const field = workspace.locator('[data-sel-key="step:wait-0"] input.se-in');
  await field.focus();
  await workspace.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await expect(field).toBeAttached();
  expect(await field.evaluate((el) => el === document.activeElement)).toBe(true);
});

test("an offscreen chunk releases its focused draft after blur and preserves the edit", async ({ page }) => {
  await page.setContent('<html><body><div id="app"></div></body></html>');
  await page.addScriptTag({ content: bundle });
  const workspace = page.locator(".se-ws");
  const first = workspace.locator('[data-sel-key="step:wait-0"] input.se-in');
  await first.fill("7");
  await workspace.locator(".se-virtual-chunk").last().evaluate((el) =>
    el.scrollIntoView({ block: "center" }));
  await expect(workspace.locator('[data-sel-key="step:wait-3999"]')).toBeVisible();
  await expect(first).toBeFocused();
  await first.blur();
  await expect(first).toHaveCount(0);
  await expect.poll(() => page.evaluate(() =>
    (window as any).scriptDragEditor.getState().doc.pages.p.pageScripts[0].steps[0].seconds
  )).toBe(7);
  await workspace.locator(".se-virtual-chunk").first().evaluate((el) =>
    el.scrollIntoView({ block: "center" }));
  await expect(first).toHaveValue("7");
});

test("4000 blocks in 160 stacks release offscreen focus pins without accumulating DOM", async ({ page }) => {
  await page.setContent('<html><body><div id="app"></div></body></html>');
  await page.addScriptTag({ content: await scriptDragBundle(scriptWorkspaceDoc("stacks")) });
  const workspace = page.locator(".se-ws");
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const index of [0, 40, 80, 120]) {
    const stack = workspace.locator(`[data-script-id="stack-${index}"]`);
    await stack.evaluate((el) => el.scrollIntoView({ block: "start" }));
    const field = stack.locator("input.se-in").first();
    await field.focus();
    await workspace.locator('[data-script-id="stack-159"]').evaluate((el) =>
      el.scrollIntoView({ block: "start" }));
    await expect(workspace.locator('[data-sel-key="step:wait-3975"]')).toBeVisible();
    await expect(field).toBeFocused();
    await field.blur();
    await expect(stack.locator(".se-blk")).toHaveCount(0);
    expect(await workspace.locator('[data-sel-key^="step:"]').count()).toBeLessThan(100);
  }
  expect(errors).toEqual([]);
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
