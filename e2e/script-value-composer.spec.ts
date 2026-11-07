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

const documentSnapshot = (page: Page) => page.evaluate(() =>
  JSON.stringify((window as any).dataPickerStore.getState().doc));
const projectSnapshot = (page: Page) => page.evaluate(() =>
  JSON.stringify((window as any).dataPickerProject()));
const modal = (page: Page) => page.getByRole("dialog", { name: "値を組み立てる" });
const fieldList = (page: Page) => page.getByRole("listbox", { name: "項目の候補" });
async function chooseSource(page: Page, name: string) {
  await modal(page).getByRole("button", { name: "元の変数を選ぶ" }).click();
  const menu = page.locator(".se-pm");
  await expect(menu).toBeVisible();
  await expect(menu).toHaveCSS("z-index", "550");
  const back = menu.getByRole("button", { name: "ひとつ上へ" });
  for (let depth = 0; depth < 8 && await back.count(); depth++) await back.click();
  await menu.locator(".se-pm-row")
    .filter({ has: page.locator(".se-pm-key").filter({ hasText: new RegExp("^" + name + "$") }) })
    .locator("button.dd-item").click();
}
const add = (page: Page, kind: string) =>
  modal(page).getByRole("combobox", { name: "加工を追加" }).selectOption(kind);

test("値の入力欄から加工を積み重ね、見本を計算する。スクリプトには反映しない", async ({ page }) => {
  const originalDoc = await documentSnapshot(page);
  const originalProject = await projectSnapshot(page);

  await page.locator('[data-sel-key="step:value"]').getByRole("button", { name: "値を組み立てる" }).click();
  await expect(modal(page)).toBeVisible();
  await expect(modal(page)).toContainText("ここでの加工は保存・実行されません");
  await chooseSource(page, "data");

  await add(page, "field");
  const keyInput = modal(page).getByRole("combobox", { name: "取り出す項目名" });
  await keyInput.focus();
  await expect(fieldList(page).getByRole("option", { name: "tags" })).toBeVisible();
  await fieldList(page).getByRole("option", { name: "tags" }).click();
  await expect(keyInput).toHaveValue("tags");
  await expect(modal(page).locator("output")).toHaveText('["red","blue"]');

  await add(page, "length");
  await expect(modal(page).locator("output")).toHaveText("2");

  await add(page, "format");
  await expect(modal(page).locator("output")).toHaveText('"2"');
  await expect(modal(page).locator(".se-composer-step")).toHaveCount(3);

  await modal(page).getByRole("button", { name: "閉じる" }).last().click();
  await expect(modal(page)).toHaveCount(0);
  expect(await documentSnapshot(page)).toBe(originalDoc);
  expect(await projectSnapshot(page)).toBe(originalProject);

  // Reopening starts a new local-only review; it must not restore the recipe.
  await page.locator('[data-sel-key="step:value"]').getByRole("button", { name: "値を組み立てる" }).click();
  await expect(modal(page).locator(".se-composer-step")).toHaveCount(0);
  expect(await documentSnapshot(page)).toBe(originalDoc);
});

test("missingとnullを区別し、加工の順番と取り消しを編集できる", async ({ page }) => {
  const originalDoc = await documentSnapshot(page);
  await page.locator('[data-sel-key="step:value"]').getByRole("button", { name: "値を組み立てる" }).click();
  await chooseSource(page, "data");

  await add(page, "field");
  const field = modal(page).getByRole("combobox", { name: "取り出す項目名" });
  await field.fill("notFound");
  await expect(modal(page).locator("output")).toHaveText("値がありません（未取得）");

  await add(page, "fallback");
  await modal(page).getByRole("textbox", { name: "値がないときの文字列" }).fill("代わり");
  await expect(modal(page).locator("output")).toHaveText('"代わり"');

  await field.fill("empty");
  await expect(modal(page).locator("output")).toHaveText("null");

  const up = modal(page).getByRole("button", { name: "上へ" }).last();
  const down = modal(page).getByRole("button", { name: "下へ" }).first();
  await expect(up.locator("svg")).toHaveCount(1);
  await expect(down.locator("svg")).toHaveCount(1);
  await up.click();
  await expect(modal(page).locator(".se-composer-step").first()).toContainText("値がないとき文字列を使う");
  await modal(page).getByRole("button", { name: "削除" }).first().click();
  await expect(modal(page).locator(".se-composer-step")).toHaveCount(1);
  expect(await documentSnapshot(page)).toBe(originalDoc);
});


test("元の値は入れ子の変数を選択でき、項目候補は直前の加工結果で変わる", async ({ page }) => {
  const before = await documentSnapshot(page);
  await page.locator('[data-sel-key="step:value"]').getByRole("button", { name: "値を組み立てる" }).click();

  await modal(page).getByRole("button", { name: "元の変数を選ぶ" }).click();
  const menu = page.locator(".se-pm");
  const data = menu.locator(".se-pm-row").filter({
    has: page.locator(".se-pm-key").filter({ hasText: /^data$/ }),
  });
  await data.getByRole("button", { name: "data の中を見る" }).click();
  const tags = menu.locator(".se-pm-row").filter({
    has: page.locator(".se-pm-key").filter({ hasText: /^tags$/ }),
  });
  await tags.locator("button.dd-item").click();
  await expect(menu).toHaveCount(0);
  await expect(modal(page).locator("output")).toHaveText('["red","blue"]');

  // Selecting the full object offers its keys; the next field offers keys from the preceding result.
  await chooseSource(page, "data");
  await add(page, "field");
  const first = modal(page).getByRole("combobox", { name: "取り出す項目名" });
  await first.focus();
  await fieldList(page).getByRole("option", { name: "detail" }).click();
  await add(page, "field");
  const second = modal(page).getByRole("combobox", { name: "取り出す項目名" }).last();
  await second.focus();
  await expect(fieldList(page).getByRole("option", { name: "title" })).toBeVisible();
  await fieldList(page).getByRole("option", { name: "title" }).click();
  await expect(modal(page).locator("output")).toHaveText('"Nested"');
  expect(await documentSnapshot(page)).toBe(before);
});

test("項目候補が空または検索に一致しない場合、理由を表示し手入力を許す", async ({ page }) => {
  const before = await documentSnapshot(page);
  await page.locator('[data-sel-key="step:value"]').getByRole("button", { name: "値を組み立てる" }).click();
  await chooseSource(page, "data");

  await add(page, "field");
  const first = modal(page).getByRole("combobox", { name: "取り出す項目名" });
  await first.fill("not-in-sample");
  await expect(fieldList(page)).toContainText("一致する候補がありません");
  await expect(first).toHaveValue("not-in-sample");

  await first.fill("");
  await fieldList(page).getByRole("option", { name: "tags" }).click();
  await expect(first).toHaveValue("tags");
  await expect(modal(page).locator("output")).toHaveText('["red","blue"]');

  await add(page, "field");
  const second = modal(page).getByRole("combobox", { name: "取り出す項目名" }).last();
  await second.focus();
  await expect(fieldList(page)).toContainText("候補がありません");
  await second.fill("custom");
  await expect(fieldList(page)).toContainText("候補がありません");
  await expect(second).toHaveValue("custom");
  await second.press("Escape");
  await expect(fieldList(page)).toHaveCount(0);
  await expect(modal(page)).toBeVisible();
  expect(await documentSnapshot(page)).toBe(before);
});

test("候補の再選択とキーボード確定を確実に反映する", async ({ page }) => {
  await page.locator('[data-sel-key="step:value"]').getByRole("button", { name: "値を組み立てる" }).click();
  await chooseSource(page, "data");
  await add(page, "field");
  const input = modal(page).getByRole("combobox", { name: "取り出す項目名" });
  const toggle = modal(page).getByRole("button", { name: "項目の候補を表示" });

  for (const key of ["detail", "tags", "empty", "detail", "tags"]) {
    await toggle.click();
    await fieldList(page).getByRole("option", { name: key, exact: true }).click();
    await expect(input).toHaveValue(key);
    await expect(fieldList(page)).toHaveCount(0);
  }
  await input.fill("det");
  await expect(fieldList(page).getByRole("option", { name: "detail" })).toBeVisible();
  await input.press("Enter");
  await expect(input).toHaveValue("detail");
  await expect(fieldList(page)).toHaveCount(0);
});

test("加工の目的別グループと途中結果を確認できる", async ({ page }) => {
  const before = await documentSnapshot(page);
  await page.locator('[data-sel-key="step:value"]').getByRole("button", { name: "値を組み立てる" }).click();
  await chooseSource(page, "data");

  const groups = modal(page).getByRole("combobox", { name: "加工を追加" }).locator("optgroup");
  await expect(groups).toHaveCount(4);
  await expect(groups.first()).toHaveAttribute("label", "値を取り出す");
  await add(page, "has");
  await modal(page).getByRole("combobox", { name: "取り出す項目名" }).fill("empty");
  await expect(modal(page).locator(".se-composer-progress code")).toHaveText("true");
  await expect(modal(page).locator("output")).toHaveText("true");
  await modal(page).getByRole("button", { name: "削除" }).click();

  await add(page, "field");
  await modal(page).getByRole("combobox", { name: "取り出す項目名" }).fill("empty");
  await add(page, "fallback-nullish");
  await modal(page).getByRole("textbox", { name: "値がないときの文字列" }).fill("未設定");
  await expect(modal(page).locator("output")).toHaveText('"未設定"');
  await expect(modal(page).locator(".se-composer-progress code")).toHaveText(["null", '"未設定"']);
  expect(await documentSnapshot(page)).toBe(before);
});

test("狭い画面でも加工の入力欄と候補を表示できる", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 740 });
  await page.locator('[data-sel-key="step:value"]').getByRole("button", { name: "値を組み立てる" }).click();
  await chooseSource(page, "data");
  await add(page, "field");
  const input = modal(page).getByRole("combobox", { name: "取り出す項目名" });
  await input.focus();
  const menu = fieldList(page);
  await expect(menu).toBeVisible();
  const bounds = await menu.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  await menu.getByRole("option", { name: "detail" }).click();
  await expect(input).toHaveValue("detail");
  await expect(modal(page).locator("output")).toHaveText('{"title":"Nested"}');
});
