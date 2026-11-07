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

const valueBlock = (page: Page) => page.locator('[data-sel-key="step:value"]');
const operation = (page: Page) =>
  valueBlock(page).getByRole("combobox", { name: "値の作り方" });
const document = (page: Page) =>
  page.evaluate(() => JSON.parse(JSON.stringify((window as any).dataPickerStore.getState().doc)));
const current = async (page: Page) =>
  (await document(page)).pages.p.pageScripts[0].steps.find((step: any) => step.id === "value");

test("値の作り方を切り替えても変数名を保ち、保存形式と公開コードを既存形式のまま出力する", async ({ page }) => {
  await expect(operation(page).locator("option")).toHaveCount(7);
  await operation(page).selectOption("count");
  expect(await current(page)).toEqual({
    id: "value", kind: "count", array: "", into: "chosen",
  });
  await valueBlock(page).locator("select.se-in").last().selectOption("data.tags");
  expect(await current(page)).toEqual({
    id: "value", kind: "count", array: "data.tags", into: "chosen",
  });

  await operation(page).selectOption("join");
  expect(await current(page)).toEqual({
    id: "value", kind: "join", array: "data.tags", sep: "、", into: "chosen",
  });
  const saved = await document(page);
  const project = await page.evaluate(() => (window as any).dataPickerProject());
  await page.evaluate((doc) => (window as any).dataPickerStore.getState()
    .replaceDoc(JSON.parse(JSON.stringify(doc))), saved);
  expect(await document(page)).toEqual(saved);
  expect(await page.evaluate(() => (window as any).dataPickerProject())).toEqual(project);

  await operation(page).selectOption("set-var");
  expect(await current(page)).toEqual({
    id: "value", kind: "set-var", value: "{data.tags}", into: "chosen",
  });
  // No schema fields or neighboring steps were introduced by the operation selector.
  const after = await document(page);
  expect(after.pages.p.pageScripts[0].steps.map((step: any) => step.id))
    .toEqual(saved.pages.p.pageScripts[0].steps.map((step: any) => step.id));
});

test("計算・文字列処理・1件検索も既存の動作ブロックに切り替わり、Undoで戻せる", async ({ page }) => {
  const before = await document(page);
  for (const kind of ["split", "replace", "calc", "array-find"] as const) {
    await operation(page).selectOption(kind);
    const step = await current(page);
    expect(step.id).toBe("value");
    expect(step.into).toBe("chosen");
    expect(step.kind).toBe(kind);
    await operation(page).selectOption("set-var");
  }
  await page.getByRole("button", { name: "取り消す", exact: true }).click();
  expect((await current(page)).kind).toBe("array-find");
  // Resetting the original fixture must keep all legacy script values.
  await page.evaluate((doc) => (window as any).dataPickerStore.getState()
    .replaceDoc(JSON.parse(JSON.stringify(doc))), before);
  expect(await document(page)).toEqual(before);
});
