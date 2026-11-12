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

test("Enter after closing variable details inserts the value and preserves save/Undo/Redo", async ({ page }) => {
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

test("Enter/Space toggles variable details, while Enter on a row inserts its selected value", async ({ page }) => {
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

test("Search updates that remove candidates do not modify another target after clear, cancel, or reselection", async ({ page }) => {
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

test("Inspector suggestions dismiss outside but not on scrolling inside the menu", async ({ page }) => {
  const menu = page.locator(".var-comp");
  await source(page).focus();
  await source(page).press("Control+/");
  await expect(menu).toBeVisible();

  await menu.locator(".var-comp-list").evaluate((list) => {
    list.scrollTop += 30;
    list.dispatchEvent(new Event("scroll"));
  });
  await expect(menu).toBeVisible();
  await page.locator("#outside").click();
  await expect(menu).toHaveCount(0);

  // 補完を閉じても、利用者の編集は変わらない。
  await expect(source(page)).toHaveValue("");
  await source(page).focus();
  await source(page).press("Control+/");
  await expect(menu).toBeVisible();
  await source(page).press("Escape");
  await expect(menu).toHaveCount(0);
});

test("Suggestions close when the focused inspector field leaves its scroll viewport", async ({ page }) => {
  await page.evaluate(() => {
    const app = document.getElementById("app")!;
    app.style.height = "150px";
    app.style.overflowY = "auto";
    const spacer = document.createElement("div");
    spacer.style.height = "1800px";
    app.appendChild(spacer);
  });
  await source(page).scrollIntoViewIfNeeded();
  await source(page).focus();
  await source(page).press("Control+/");
  await expect(page.locator(".var-comp")).toBeVisible();

  await page.evaluate(() => {
    const app = document.getElementById("app")!;
    app.scrollTop = app.scrollHeight;
  });
  await expect(page.locator(".var-comp")).toHaveCount(0);
});

for (const width of [1440, 375, 320]) {
  test(`Both variable hint actions in Settings fit without wrapping at ${width}px`, async ({ page }) => {
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
