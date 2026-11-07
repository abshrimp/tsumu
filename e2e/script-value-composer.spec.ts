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
const block = (page: Page) => page.locator('[data-sel-key="step:value"]');
const modal = (page: Page) => page.getByRole("dialog", { name: "値を組み立てる" });
const snapshot = (page: Page) => page.evaluate(() =>
  JSON.parse(JSON.stringify((window as any).dataPickerStore.getState().doc)));

test("new set-variable blocks no longer ask users to open the value-composition modal", async ({ page }) => {
  await expect(block(page).getByRole("button", { name: "値を組み立てる" })).toHaveCount(0);
  await expect(page.locator('[data-tutorial="se-block-transform"]')).toBeVisible();
  const before = await snapshot(page);
  await page.getByRole("button", { name: "以前のブロックを表示" }).click();
  await page.getByRole("button", { name: "以前のブロックを隠す" }).click();
  expect(await snapshot(page)).toEqual(before);
});

test("saved recipes remain editable for backward compatibility", async ({ page }) => {
  await page.evaluate(() => {
    (window as any).dataPickerStore.getState().updateDoc((doc: any) => {
      const step = doc.pages.p.pageScripts[0].steps.find((s: any) => s.id === "value");
      step.value = "{data}";
      step.recipe = { source: "data", steps: [
        { kind: "field", key: "tags" }, { kind: "length" },
      ] };
    });
  });
  const before = await snapshot(page);
  await block(page).getByRole("button", { name: "加工を編集" }).click();
  await expect(modal(page)).toBeVisible();
  await expect(modal(page).locator(".se-composer-step")).toHaveCount(2);
  await expect(modal(page).locator("output")).toHaveText("2");
  await modal(page).getByRole("button", { name: "キャンセル" }).click();
  expect(await snapshot(page)).toEqual(before);
  await block(page).getByRole("button", { name: "通常の値に戻す" }).click();
  const result = (await snapshot(page)).pages.p.pageScripts[0].steps.find((s: any) => s.id === "value");
  expect(result.value).toBe("{data}");
  expect(result.recipe).toBeUndefined();
  await page.getByRole("button", { name: "取り消す", exact: true }).click();
  expect(await snapshot(page)).toEqual(before);
});
