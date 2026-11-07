import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { expectVariableMenuLayout } from "./helpers/variable-menu-layout";
import { varExplorerBundle } from "../tests/helpers/var-explorer";

let bundle: string;
test.beforeAll(async () => { bundle = await varExplorerBundle(); });
test.beforeEach(async ({ page }) => {
  await page.setContent('<html><body><div id="app"></div></body></html>');
  await page.addStyleTag({ content: readFileSync("app/globals.css", "utf8") });
  await page.addScriptTag({ content: bundle });
});
const source = (page: Page) => page.getByPlaceholder("最初から入力されている文字", { exact: true });
const snapshot = (page: Page) => page.evaluate(() => {
  const { doc, past, future } = (window as any).pickerStore.getState();
  return { doc, past, future };
});
async function openPicker(page: Page) {
  await source(page).focus();
  await source(page).press("Control+/");
  await page.locator(".var-comp-explore").click();
  await expect(page.getByRole("dialog", { name: "変数を探す" })).toBeVisible();
}

test("詳細を隠した直後の Enter で変数を挿入でき、保存・元に戻す・やり直すも一致する", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await openPicker(page);
  const before = await snapshot(page);
  await page.getByRole("button", { name: "詳細を表示", exact: true }).click();
  const search = page.getByPlaceholder("変数名・値で検索");
  await search.fill("search");
  await expect(page.locator(".vx-row")).toHaveCount(3);
  await search.press("ArrowUp");
  await expect(page.locator(".vx-row.is-key .vx-tok")).toHaveText("{search.disabled}");
  await page.getByRole("button", { name: "詳細を隠す", exact: true }).click();
  await expect(page.locator(".vx-row")).toHaveCount(1);
  await expect(page.locator(".vx-row.is-key .vx-tok")).toHaveText("{search}");
  expect(await snapshot(page)).toEqual(before);
  await search.press("Enter");
  await expect(page.getByRole("dialog", { name: "変数を探す" })).toHaveCount(0);
  await expect(source(page)).toHaveValue("{search}");
  await page.locator("#outside").click();
  const after = await snapshot(page);
  expect(after.doc.nodes.target.field.defaultValue).toBe("{search}");
  expect(after.past).toHaveLength(before.past.length + 1);
  expect(after.doc.nodes.other).toEqual(before.doc.nodes.other);
  await page.evaluate(() => (window as any).pickerStore.getState().undo());
  await expect(source(page)).toHaveValue("");
  expect((await snapshot(page)).doc).toEqual(before.doc);
  await page.evaluate(() => (window as any).pickerStore.getState().redo());
  await expect(source(page)).toHaveValue("{search}");
  expect((await snapshot(page)).doc).toEqual(after.doc);
  expect(errors).toEqual([]);
});

test("変数の開閉ボタンは Enter・Space で中身だけを開き、行の Enter で選んだ項目を挿入する", async ({ page }) => {
  await openPicker(page); const before = await snapshot(page);
  const product = page.locator(".vx-row").filter({ has: page.locator(".vx-tok", { hasText: /^\{product\}$/ }) });
  const expand = product.getByRole("button", { name: "中を開く", exact: true });
  await expand.focus(); await expand.press("Enter");
  await expect(page.getByRole("dialog", { name: "変数を探す" })).toBeVisible();
  await expect(product.locator("button")).toHaveAttribute("aria-expanded", "true");
  expect(await snapshot(page)).toEqual(before);
  await product.locator("button").press("Space");
  await expect(product.locator("button")).toHaveAttribute("aria-expanded", "false");
  await product.focus(); await product.press("ArrowRight");
  const name = page.locator(".vx-row").filter({ has: page.locator(".vx-tok", { hasText: /^\{product\.name\}$/ }) });
  await name.focus(); await name.press("Enter");
  await expect(source(page)).toHaveValue("{product.name}");
  await page.locator("#outside").click();
  expect((await snapshot(page)).doc.nodes.target.field.defaultValue).toBe("{product.name}");
});

test("検索中のデータ更新で候補が減っても、空の検索・キャンセル・再選択で別の要素を変えない", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await openPicker(page);
  await page.getByRole("button", { name: "詳細を表示", exact: true }).click();
  const search = page.getByPlaceholder("変数名・値で検索");
  await search.fill("search"); await search.press("ArrowUp");
  await page.evaluate(() => (window as any).pickerStore.getState().updateNode("search", {
    type: "box", field: undefined, text: { content: "Search" },
  }));
  await expect(page.locator(".vx-row.is-key .vx-tok")).toHaveText("{search}");
  await page.evaluate(() => (window as any).pickerStore.getState().deleteNodes(["search"]));
  await expect(page.locator(".vx-row")).toHaveCount(0);
  const before = await snapshot(page);
  await search.press("Enter"); await search.press("ArrowDown");
  await expect(page.getByRole("dialog", { name: "変数を探す" })).toBeVisible();
  await search.press("Escape");
  await page.locator("#outside").click();
  expect(await snapshot(page)).toEqual(before);
  await page.evaluate(() => {
    const s = (window as any).pickerStore.getState(); s.setActivePage("q"); s.select("other");
  });
  await openPicker(page);
  await page.getByPlaceholder("変数名・値で検索").fill("other");
  await page.locator(".vx-row").click(); await page.locator("#outside").click();
  const after = await snapshot(page);
  expect(after.doc.nodes.other.field.defaultValue).toBe("{other}");
  expect(after.doc.nodes.target).toEqual(before.doc.nodes.target);
  expect(errors).toEqual([]);
});

for (const width of [1440, 375, 320]) {
  test(`設定欄の変数候補の2つの操作案内は折り返さず、幅 ${width}px の画面内に収まる`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await source(page).focus();
    await source(page).press("Control+/");
    const menu = page.locator(".var-comp");
    await expect(menu).toBeVisible();
    await expectVariableMenuLayout(page, width, 2);
    await source(page).press("Escape");
    await expect(menu).toHaveCount(0);
    await source(page).press("Control+/");
    await page.locator(".var-comp-explore").click();
    await expect(page.getByRole("dialog", { name: "変数を探す" })).toBeVisible();
    await page.getByPlaceholder("変数名・値で検索").press("Escape");
    await expect(page.getByRole("dialog", { name: "変数を探す" })).toHaveCount(0);
  });
}
