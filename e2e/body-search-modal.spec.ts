import { readEditorCss } from "../tests/helpers/editor-css";
import { expect, test } from "@playwright/test";
import { bodySearchModalBundle } from "../tests/helpers/body-search-modal";

let bundle: string;
const css = readEditorCss();
test.beforeAll(async () => { bundle = await bodySearchModalBundle(); });
test.beforeEach(async ({ page }) => {
  // A transformed and clipped parent catches dialogs not portaled to document.body.
  await page.setContent('<html lang="ja"><body><header style="position:relative; height:24px; transform:translateZ(0); overflow:hidden"><div id="app"></div></header></body></html>');
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: bundle });
  await expect(page.getByRole("dialog", { name: "本文を検索" })).toBeVisible();
});

test("Search dialog uses a visible header, clear control and independently scrolling results", async ({ page }) => {
  const modal = page.getByRole("dialog", { name: "本文を検索" });
  await expect(modal.locator(".body-search-head h2")).toHaveText("本文を検索");
  const close = modal.getByRole("button", { name: "閉じる" });
  const title = modal.locator(".body-search-head h2");
  const closeBox = await close.boundingBox();
  const titleBox = await title.boundingBox();
  expect(closeBox!.x).toBeGreaterThan(titleBox!.x + titleBox!.width);
  const input = modal.getByRole("searchbox", { name: "本文を検索" });
  await input.fill("日本語の本文");
  await expect(modal.locator(".body-search-result")).toHaveCount(100);
  await expect(modal.locator(".body-search-meta")).toContainText("100");
  const scroll = modal.locator(".body-search-results");
  await expect.poll(() => scroll.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
  await scroll.evaluate((node) => { node.scrollTop = 200; });
  await expect.poll(() => scroll.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
  await modal.getByRole("button", { name: "検索をクリア" }).click();
  await expect(input).toHaveValue("");
  await expect(input).toBeFocused();
  await expect(modal.locator(".body-search-result")).toHaveCount(0);
  await input.press("Escape");
  await expect(modal).toHaveCount(0);
});

test("Search results navigate to the correct page and select its text", async ({ page }) => {
  const modal = page.getByRole("dialog", { name: "本文を検索" });
  await modal.getByRole("searchbox", { name: "本文を検索" }).fill("Unique visitor text");
  await expect(modal.locator(".body-search-result")).toHaveCount(1);
  await expect(modal.locator(".body-search-result-name")).toContainText("Second page / Target");
  await modal.locator(".body-search-result").click();
  await expect(modal).toHaveCount(0);
  const selection = await page.evaluate(() => {
    const state = (window as any).bodySearchStore.getState();
    return { active: state.activePageId, selected: state.selection, leftTab: state.leftTab };
  });
  expect(selection).toEqual({ active: "other", selected: "special", leftTab: "layers" });
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await modal.getByRole("searchbox").fill("Reusable card text");
  await modal.getByRole("button", { name: /Second page \/ Card label/ }).click();
  expect(await page.evaluate(() => {
    const state = (window as any).bodySearchStore.getState();
    return [state.activePageId, state.editingComponentId, state.selection];
  })).toEqual(["other", "card", "card-root"]);
});

test("Mobile modal stays inside the viewport and does not clip the search field", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 540 });
  const modal = page.getByRole("dialog", { name: "本文を検索" });
  const modalRect = await modal.boundingBox();
  const fieldRect = await modal.locator(".body-search-field").boundingBox();
  const closeRect = await modal.getByRole("button", { name: "閉じる" }).boundingBox();
  expect(modalRect!.x).toBeGreaterThanOrEqual(0);
  expect(modalRect!.x + modalRect!.width).toBeLessThanOrEqual(375);
  expect(modalRect!.y + modalRect!.height).toBeLessThanOrEqual(540);
  expect(fieldRect!.x).toBeGreaterThan(modalRect!.x);
  expect(fieldRect!.x + fieldRect!.width).toBeLessThan(modalRect!.x + modalRect!.width);
  expect(closeRect!.y).toBeGreaterThanOrEqual(modalRect!.y);
  await modal.getByRole("searchbox", { name: "本文を検索" }).fill("Searchable");
  await expect(modal.locator(".body-search-result")).toHaveCount(100);
  await expect(modal.getByRole("searchbox", { name: "本文を検索" })).toBeVisible();
});
