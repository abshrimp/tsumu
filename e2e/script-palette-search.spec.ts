import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { scriptDataPickerBundle } from "../tests/helpers/script-data-picker";

let bundle: string;
test.beforeAll(async () => { bundle = await scriptDataPickerBundle(); });
test.beforeEach(async ({ page }) => {
  await page.setContent('<html><body><div id="app"></div></body></html>');
  await page.addStyleTag({ content: readFileSync("app/globals.css", "utf8") });
  await page.addScriptTag({ content: bundle });
  await expect(page.getByRole("dialog", { name: "スクリプト", exact: true })).toBeVisible();
});
const palette = (page: Page) => page.locator('[data-tutorial="se-palette"]');

test("search has one focus outline and unchanged height when text changes", async ({ page }) => {
  const search = palette(page).getByRole("searchbox", { name: "操作を探す" });
  const wrapper = palette(page).locator(".se-pal-search");
  const height = await wrapper.evaluate((element) => (element as HTMLElement).offsetHeight);
  await search.focus();
  await expect(search).toHaveCSS("outline-style", "none");
  await search.fill("保存");
  await expect(wrapper).toHaveCSS("height", "36px");
  await expect(palette(page).getByRole("button", { name: "検索をクリア" })).toHaveCount(1);
  expect(await wrapper.evaluate(el => (el as HTMLElement).offsetHeight)).toBe(height);
  await palette(page).getByRole("button", { name: "検索をクリア" }).click();
  expect(await wrapper.evaluate(el => (el as HTMLElement).offsetHeight)).toBe(height);
});

test("all supported blocks are available in the palette", async ({ page }) => {
  const cards = palette(page).locator(".se-pal-item");
  await expect(cards).toHaveCount(27);
  await expect(palette(page).locator('[data-tutorial="se-block-transform"]')).toBeVisible();
  await expect(palette(page).locator('[data-tutorial="se-block-list-display"]')).toBeVisible();
  await expect(palette(page).locator('[data-tutorial="se-block-make-list"]')).toBeVisible();
  await expect(palette(page).locator('[data-tutorial="se-block-set-list-item"]')).toBeVisible();
  await expect(palette(page).locator('[data-tutorial="se-block-remove-list-item"]')).toBeVisible();
  await expect(palette(page).locator('[data-tutorial="se-block-break-loop"]')).toBeVisible();
});

test("search can find the new processing and list display blocks", async ({ page }) => {
  const original = await page.evaluate(() => JSON.stringify((window as any).dataPickerStore.getState().doc));
  const search = palette(page).getByRole("searchbox", { name: "操作を探す" });
  const cases: [string, string][] = [
    ["タップ", "click"], ["REST", "fetch"], ["入力禁止", "set-enabled"],
    ["数値演算", "transform"], ["分割", "transform"], ["並べ替え", "list-display"],
    ["値で削除", "remove-list-item"],
    ["フィルター解除", "list-display"], ["クリップボード", "copy"],
    ["無限ループ", "repeat"], ["条件分岐", "if"],
  ];
  for (const [query, id] of cases) {
    await search.fill(query);
    await expect(palette(page).locator('[data-tutorial="se-block-' + id + '"]'), query).toBeVisible();
  }
  await search.fill("未実装の操作987654");
  await expect(palette(page).getByRole("status")).toHaveText("一致する操作がありません");
  await search.press("Escape");
  await expect(palette(page).locator(".se-pal-item")).toHaveCount(27);
  expect(await page.evaluate(() => JSON.stringify((window as any).dataPickerStore.getState().doc))).toBe(original);
});
