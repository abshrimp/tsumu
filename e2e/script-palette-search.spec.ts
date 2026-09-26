import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { scriptDataPickerBundle } from "../tests/helpers/script-data-picker";

let bundle: string;
test.beforeAll(async () => { bundle = await scriptDataPickerBundle(); });
test.beforeEach(async ({ page }) => {
  await page.setContent('<html><body><div id="app"></div></body></html>');
  await page.addStyleTag({ content: readFileSync("app/globals.css", "utf8") });
  await page.addScriptTag({ content: bundle });
  await expect(page.locator(".se[role=\"dialog\"]")).toBeVisible();
});
const palette = (page: Page) => page.locator('[data-tutorial="se-palette"]');

test("search has one focus outline and unchanged height when text changes", async ({ page }) => {
  const search = palette(page).locator(".se-pal-search-input");
  const wrapper = palette(page).locator(".se-pal-search");
  const height = await wrapper.evaluate((element) => (element as HTMLElement).offsetHeight);
  await search.focus();
  await expect(search).toHaveCSS("outline-style", "none");
  await search.fill("storage");
  await expect(wrapper).toHaveCSS("height", "36px");
  await expect(palette(page).locator(".se-pal-search-clear")).toHaveCount(1);
  expect(await wrapper.evaluate(el => (el as HTMLElement).offsetHeight)).toBe(height);
  await palette(page).locator(".se-pal-search-clear").click();
  expect(await wrapper.evaluate(el => (el as HTMLElement).offsetHeight)).toBe(height);
});

test("all supported blocks are available in the palette", async ({ page }) => {
  const cards = palette(page).locator(".se-pal-item");
  await expect(cards).toHaveCount(28);
  await expect(palette(page).locator('[data-tutorial="se-block-transform"]')).toBeVisible();
  await expect(palette(page).locator('[data-tutorial="se-block-list-display"]')).toBeVisible();
  await expect(palette(page).locator('[data-tutorial="se-block-make-list"]')).toBeVisible();
  await expect(palette(page).locator('[data-tutorial="se-block-set-list-item"]')).toBeVisible();
  await expect(palette(page).locator('[data-tutorial="se-block-remove-list-item"]')).toBeVisible();
  await expect(palette(page).locator('[data-tutorial="se-block-break-loop"]')).toBeVisible();
  await expect(palette(page).locator('[data-tutorial="se-block-dialog"]')).toBeVisible();
});

test("search can find the new processing and list display blocks", async ({ page }) => {
  const original = await page.evaluate(() => JSON.stringify((window as any).dataPickerStore.getState().doc));
  const search = palette(page).locator(".se-pal-search-input");
  const cases: [string, string][] = [
    ["tap", "click"], ["REST", "fetch"], ["disable", "set-enabled"],
    ["math", "transform"], ["pipeline", "transform"], ["sort", "list-display"],
    ["remove", "remove-list-item"],
    ["filter", "list-display"], ["clipboard", "copy"],
    ["alert", "dialog"], ["warning", "dialog"], ["confirm", "dialog"], ["prompt", "dialog"],
    ["forever", "repeat"], ["conditional", "if"],
  ];
  for (const [query, id] of cases) {
    await search.fill(query);
    await expect(palette(page).locator('[data-tutorial="se-block-' + id + '"]'), query).toBeVisible();
  }
  await search.fill("unimplemented-action-987654");
  await expect(palette(page).getByRole("status")).toBeVisible();
  await search.press("Escape");
  await expect(palette(page).locator(".se-pal-item")).toHaveCount(28);
  expect(await page.evaluate(() => JSON.stringify((window as any).dataPickerStore.getState().doc))).toBe(original);
});
