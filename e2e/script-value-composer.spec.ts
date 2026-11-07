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

const modal = (page: Page) => page.getByRole("dialog", { name: "値を組み立てる" });
const fieldList = (page: Page) => page.getByRole("listbox", { name: "項目の候補" });
const block = (page: Page) => page.locator('[data-sel-key="step:value"]');
const snapshot = (page: Page) => page.evaluate(() =>
  JSON.parse(JSON.stringify((window as any).dataPickerStore.getState().doc)));
const step = async (page: Page) => (await snapshot(page)).pages.p.pageScripts[0].steps.find((s: any) => s.id === "value");
const open = (page: Page, label = "値を組み立てる") => block(page).getByRole("button", { name: label }).click();
const add = (page: Page, kind: string) =>
  modal(page).getByRole("combobox", { name: "加工を追加" }).selectOption(kind);

async function chooseSource(page: Page, name: string) {
  await modal(page).getByRole("button", { name: "元の変数を選ぶ" }).click();
  const menu = page.locator(".se-pm");
  await expect(menu).toBeVisible();
  const back = menu.getByRole("button", { name: "ひとつ上へ" });
  for (let depth = 0; depth < 8 && await back.count(); depth++) await back.click();
  await menu.locator(".se-pm-row")
    .filter({ has: page.locator(".se-pm-key").filter({ hasText: new RegExp("^" + name + "$") }) })
    .locator("button.dd-item").click();
}

test("値を組み立てて反映すると同じブロックに保存され、編集・Undo/Redoで戻せる", async ({ page }) => {
  const before = await snapshot(page);
  await open(page);
  await chooseSource(page, "data");
  await add(page, "field");
  const input = modal(page).getByRole("combobox", { name: "取り出す項目名" });
  await input.focus();
  await fieldList(page).getByRole("option", { name: "tags" }).click();
  await expect(input).toHaveValue("tags");
  await add(page, "length");
  await add(page, "format");
  await expect(modal(page).locator("output")).toHaveText('"2"');

  await modal(page).getByRole("button", { name: "ブロックに反映" }).click();
  await expect(modal(page)).toHaveCount(0);
  const saved = await snapshot(page);
  const value = await step(page);
  expect(value).toMatchObject({
    id: "value", kind: "set-var", into: "chosen", value: "{data}",
    recipe: { source: "data", steps: [
      { kind: "field", key: "tags" }, { kind: "length" }, { kind: "format" },
    ] },
  });
  await expect(block(page)).toContainText("3件の加工");
  await open(page, "加工を編集");
  await expect(modal(page).locator(".se-composer-step")).toHaveCount(3);
  await expect(modal(page).locator("output")).toHaveText('"2"');
  await modal(page).getByRole("button", { name: "キャンセル" }).click();
  expect(await snapshot(page)).toEqual(saved);

  await page.getByRole("button", { name: "取り消す", exact: true }).click();
  expect(await snapshot(page)).toEqual(before);
  await page.getByRole("button", { name: "やり直す", exact: true }).click();
  expect(await snapshot(page)).toEqual(saved);
  await page.evaluate((doc) =>
    (window as any).dataPickerStore.getState().replaceDoc(JSON.parse(JSON.stringify(doc))), saved);
  expect(await step(page)).toMatchObject(value);
});

test("保存した加工が生成コードにも反映される", async ({ page }) => {
  await open(page);
  await chooseSource(page, "data");
  await add(page, "field");
  await modal(page).getByRole("combobox", { name: "取り出す項目名" }).fill("tags");
  await add(page, "length");
  await modal(page).getByRole("button", { name: "ブロックに反映" }).click();
  const generated = await page.evaluate(() => (window as any).dataPickerProject());
  const pageCode = Object.entries(generated.files).find(([name]) => name.endsWith("/page.tsx") || name === "app/page.tsx")?.[1];
  expect(pageCode).toBeTruthy();
  expect(pageCode).toContain("__evalValueRecipe");
  expect(pageCode).toContain("array.length".replace("array.length", '"length"'));
  expect(pageCode).toContain('"field"');
});

test("項目がない場合と一致する候補がない場合を区別し、直接入力できる", async ({ page }) => {
  await open(page);
  await chooseSource(page, "data");
  await add(page, "field");
  const first = modal(page).getByRole("combobox", { name: "取り出す項目名" });
  await first.fill("not-in-sample");
  await expect(fieldList(page)).toContainText("一致する候補がありません");
  await expect(first).toHaveValue("not-in-sample");

  await first.fill("");
  await fieldList(page).getByRole("option", { name: "tags" }).click();
  await expect(first).toHaveValue("tags");
  await add(page, "field");
  const second = modal(page).getByRole("combobox", { name: "取り出す項目名" }).last();
  await second.focus();
  await expect(fieldList(page)).toContainText("候補がありません");
  await second.fill("custom");
  await expect(fieldList(page)).toContainText("候補がありません");
  await second.press("Escape");
  await expect(fieldList(page)).toHaveCount(0);
  await expect(modal(page)).toBeVisible();
});

test("候補の再選択を繰り返しても確定した項目名が反映される", async ({ page }) => {
  await open(page);
  await chooseSource(page, "data");
  await add(page, "field");
  const input = modal(page).getByRole("combobox", { name: "取り出す項目名" });
  const toggle = modal(page).getByRole("button", { name: "項目の候補を表示" });
  for (const name of ["detail", "tags", "empty", "detail", "tags"]) {
    await toggle.click();
    await fieldList(page).getByRole("option", { name, exact: true }).click();
    await expect(input).toHaveValue(name);
    await expect(fieldList(page)).toHaveCount(0);
  }
  await input.fill("det");
  await input.press("Enter");
  await expect(input).toHaveValue("detail");
  await expect(fieldList(page)).toHaveCount(0);
});

test("加工9種類を4つの目的に分け、nullとmissingの補完を区別する", async ({ page }) => {
  await open(page);
  await chooseSource(page, "data");
  const groups = modal(page).getByRole("combobox", { name: "加工を追加" }).locator("optgroup");
  await expect(groups).toHaveCount(4);
  await add(page, "has");
  await modal(page).getByRole("combobox", { name: "取り出す項目名" }).fill("empty");
  await expect(modal(page).locator("output")).toHaveText("true");
  await modal(page).getByRole("button", { name: "削除" }).click();

  await add(page, "field");
  await modal(page).getByRole("combobox", { name: "取り出す項目名" }).fill("empty");
  await add(page, "fallback");
  await modal(page).getByRole("textbox", { name: "値がないときの文字列" }).fill("未設定");
  await expect(modal(page).locator("output")).toHaveText("null");
  await modal(page).getByRole("button", { name: "削除" }).last().click();
  await add(page, "fallback-nullish");
  await modal(page).getByRole("textbox", { name: "値がないときの文字列" }).fill("未設定");
  await expect(modal(page).locator("output")).toHaveText('"未設定"');
});

test("狭い幅でも項目の候補がモーダルに切られず選択できる", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 740 });
  await open(page);
  await chooseSource(page, "data");
  await add(page, "field");
  const input = modal(page).getByRole("combobox", { name: "取り出す項目名" });
  await input.focus();
  const box = await fieldList(page).boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await fieldList(page).getByRole("option", { name: "detail" }).click();
  await expect(input).toHaveValue("detail");
  await expect(modal(page).locator("output")).toHaveText('{"title":"Nested"}');
});


test("加工追加のフォーカス枠は外側と揃い、アクションは入力の有無を問わず右端にある", async ({ page }) => {
  await open(page);
  const select = modal(page).getByRole("combobox", { name: "加工を追加" });
  const wrapper = modal(page).locator(".se-composer-add");
  const before = await wrapper.boundingBox();
  await select.focus();
  await expect(select).toBeFocused();
  const styles = await select.evaluate((el) => ({
    outline: getComputedStyle(el).outlineStyle,
    border: getComputedStyle(el.closest(".se-composer-add")!).borderTopStyle,
    color: getComputedStyle(el.closest(".se-composer-add")!).borderTopColor,
  }));
  expect(styles).toMatchObject({ outline: "none", border: "solid" });
  expect(styles.color).not.toBe("rgba(0, 0, 0, 0)");
  const after = await wrapper.boundingBox();
  expect(after?.height).toBe(before?.height);

  await add(page, "length"); // no parameter input: actions still occupy the last grid column
  const row = modal(page).locator(".se-composer-step");
  const actions = row.locator(".se-composer-step-actions");
  await expect(actions).toBeVisible();
  expect(await actions.evaluate((el) => getComputedStyle(el).gridColumnStart)).toBe("4");
  const wideRow = await row.boundingBox(), wideActions = await actions.boundingBox();
  expect(wideRow!.x + wideRow!.width - wideActions!.x - wideActions!.width).toBeLessThan(18);
  await page.setViewportSize({ width: 390, height: 740 });
  expect(await actions.evaluate((el) => getComputedStyle(el).gridColumnStart)).toBe("3");
  const narrowRow = await row.boundingBox(), narrowActions = await actions.boundingBox();
  expect(narrowRow!.x + narrowRow!.width - narrowActions!.x - narrowActions!.width).toBeLessThan(18);
});
