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
const block = (page: Page, id: string) => page.locator(`[data-sel-key="step:${id}"]`);
const picker = (page: Page) => page.getByRole("dialog", { name: "変数を探す", exact: true });
const row = (page: Page, token: string) => picker(page).locator(".vx-row").filter({ has: page.locator(".vx-tok", { hasText: token }) });
async function snapshot(page: Page) {
  return page.evaluate(() => JSON.parse(JSON.stringify((window as any).dataPickerStore.getState().doc)));
}
async function selected(page: Page) { return (await snapshot(page)).pages.p.pageScripts[0].steps.find((s: any) => s.id === "value").value; }

test("raw data selection preserves object type, save/load and undo while view changes do not rewrite text", async ({ page }) => {
  const b = block(page, "value"); const before = await snapshot(page);
  await b.getByRole("combobox", { name: "値の入力方法" }).selectOption("data");
  await b.getByRole("button", { name: "データを選ぶ", exact: true }).click();
  await picker(page).getByPlaceholder("変数名・値で検索").fill("data");
  await row(page, "{data}").filter({ has: page.locator(".vx-tok", { hasText: /^\{data\}$/ }) }).click();
  expect(await selected(page)).toBe("{data}");
  await expect(b.locator(".se-value-source")).toContainText("まとまり");
  const changed = await snapshot(page);
  await page.getByRole("button", { name: "取り消す", exact: true }).click();
  expect(await snapshot(page)).toEqual(before);
  await page.getByRole("button", { name: "やり直す", exact: true }).click();
  expect(await snapshot(page)).toEqual(changed);
  await b.getByRole("combobox", { name: "値の入力方法" }).selectOption("text");
  expect(await selected(page)).toBe("{data}");
  await b.getByRole("combobox", { name: "値の入力方法" }).selectOption("data");
  expect(await selected(page)).toBe("{data}");
  await page.evaluate((doc) => (window as any).dataPickerStore.getState().replaceDoc(JSON.parse(JSON.stringify(doc))), changed);
  expect(await snapshot(page)).toEqual(changed);
});

test("text picker opens object rows instead of inserting them and keyboard chooses a scalar leaf", async ({ page }) => {
  const b = block(page, "copy");
  await b.getByRole("button", { name: "データを選ぶ" }).click();
  const data = row(page, "{data}").filter({ has: page.locator(".vx-tok", { hasText: /^\{data\}$/ }) });
  await data.focus(); await data.press("Enter");
  await expect(picker(page)).toBeVisible();
  const title = row(page, "{data.name}"); await title.focus(); await title.press("Enter");
  await expect(picker(page)).toHaveCount(0);
  await expect(b.locator("input").first()).toHaveValue("{data.name}");
  await b.locator("input").first().press("Enter");
  expect((await snapshot(page)).pages.p.pageScripts[0].steps.find((s: any) => s.id === "copy").value).toBe("{data.name}");
});

test("numeric picker excludes incompatible values but keeps dynamic variables; cancelling changes nothing", async ({ page }) => {
  const before = await snapshot(page); const b = block(page, "calc");
  await b.getByRole("button", { name: "データを選ぶ" }).click();
  const search = picker(page).getByPlaceholder("変数名・値で検索");
  await search.fill("data.name"); await expect(picker(page).locator(".vx-row")).toHaveCount(0);
  await search.fill("data.price"); await expect(row(page, "{data.price}")).toBeVisible();
  await search.fill("later"); await expect(row(page, "{later}")).toBeVisible();
  await search.press("Escape"); expect(await snapshot(page)).toEqual(before);
});

test("legacy mixed templates survive mode switches and cancelled data selection", async ({ page }) => {
  const b = block(page, "value"); const before = await snapshot(page);
  await b.getByRole("combobox", { name: "値の入力方法" }).selectOption("data");
  await b.getByRole("button", { name: "データを選ぶ", exact: true }).click();
  await picker(page).getByPlaceholder("変数名・値で検索").press("Escape");
  await b.getByRole("combobox", { name: "値の入力方法" }).selectOption("text");
  await expect(b.locator("input").first()).toHaveValue("Legacy {data.name}");
  expect(await snapshot(page)).toEqual(before);
});

test("typed references preserve arrays, false, null and runtime-unknown choices", async ({ page }) => {
  const b = block(page, "value");
  for (const name of ["data.tags", "data.available", "data.empty", "later"]) {
    await b.getByRole("combobox", { name: "値の入力方法" }).selectOption("data");
    await b.locator(".se-value-source").click();
    await picker(page).getByPlaceholder("変数名・値で検索").fill(name);
    await row(page, `{${name}}`).click();
    expect(await selected(page)).toBe(`{${name}}`);
  }
});

test("switching editors commits the current draft without changing its literal or escaped content", async ({ page }) => {
  const b = block(page, "value");
  await b.locator("input").first().fill("001 false \\{literal} {data.name}");
  await b.getByRole("combobox", { name: "値の入力方法" }).selectOption("data");
  await b.getByRole("combobox", { name: "値の入力方法" }).selectOption("text");
  await expect(b.locator("input").first()).toHaveValue("001 false \\{literal} {data.name}");
  expect(await selected(page)).toBe("001 false \\{literal} {data.name}");
});

test("unchanged legacy editor operations preserve exported code, not just saved JSON", async ({ page }) => {
  const original = await page.evaluate(() => (window as any).dataPickerProject());
  const b = block(page, "value");
  await b.getByRole("combobox", { name: "値の入力方法" }).selectOption("data");
  await b.locator(".se-value-source").click();
  await picker(page).getByPlaceholder("変数名・値で検索").press("Escape");
  await b.getByRole("combobox", { name: "値の入力方法" }).selectOption("text");
  await page.evaluate(() => {
    const store = (window as any).dataPickerStore;
    store.getState().replaceDoc(JSON.parse(JSON.stringify(store.getState().doc)));
  });
  expect(await page.evaluate(() => (window as any).dataPickerProject())).toEqual(original);
});

test("array-field picker uses loop-local names and does not insert during IME composition", async ({ page }) => {
  await page.evaluate(() => {
    const store = (window as any).dataPickerStore;
    const doc = JSON.parse(JSON.stringify(store.getState().doc));
    doc.pages.p.pageScripts[0].steps = [doc.pages.p.pageScripts[0].steps[0], {
      id: "each", kind: "for-each", array: "data.rows", then: [{
        id: "field", kind: "array-field", array: "data.rows", field: "label", value: "Legacy",
      }],
    }];
    store.getState().replaceDoc(doc);
  });
  const b = block(page, "field");
  const input = b.locator("input").first();
  await input.focus();
  await input.dispatchEvent("compositionstart");
  await input.evaluate((el: HTMLInputElement) => { el.value = "入力中"; });
  await input.dispatchEvent("input", { isComposing: true, data: "入力中" });
  await input.dispatchEvent("keydown", { key: "Enter", code: "Enter", keyCode: 229, isComposing: true });
  await expect(input).toHaveValue("入力中");
  await input.dispatchEvent("compositionend", { data: "入力中" });
  await input.blur();
  await b.getByRole("combobox", { name: "値の入力方法" }).selectOption("data");
  await b.locator(".se-value-source").click();
  await picker(page).getByPlaceholder("変数名・値で検索").fill("title");
  await row(page, "{title}").click();
  expect((await snapshot(page)).pages.p.pageScripts[0].steps[1].then[0].value).toBe("{title}");
});


test("keyboard focus changes preserve the current text before switching to data", async ({ page }) => {
  const b = block(page, "value");
  await b.locator("input").first().fill("Keyboard {data.name}");
  const mode = b.getByRole("combobox", { name: "値の入力方法" });
  await mode.focus();
  await mode.press("ArrowDown");
  await expect(mode).toHaveValue("data");
  expect(await selected(page)).toBe("Keyboard {data.name}");
  await mode.press("ArrowUp");
  await expect(b.locator("input").first()).toHaveValue("Keyboard {data.name}");
});

test("raw picker exposes loop object roots without showing a colliding page value", async ({ page }) => {
  await page.evaluate(() => {
    const store = (window as any).dataPickerStore;
    const doc = JSON.parse(JSON.stringify(store.getState().doc));
    const fetch = doc.pages.p.pageScripts[0].steps[0];
    fetch.sample.rows = [{ details: { id: "LOCAL" }, empty: {} }];
    doc.pages.p.pageScripts[0].steps = [fetch,
      { id: "global", kind: "set-var", value: "{data.detail}", into: "details" },
      { id: "each", kind: "for-each", array: "data.rows", then: [{ id: "local-value", kind: "set-var", value: "{details}", into: "chosen" }] },
    ];
    store.getState().replaceDoc(doc);
  });
  const b = block(page, "local-value");
  await expect(b.locator(".se-value-source")).toContainText("実行時");
  await b.locator(".se-value-source").click();
  await picker(page).getByPlaceholder("変数名・値で検索").fill("details");
  const root = row(page, "{details}").filter({ has: page.locator(".vx-tok", { hasText: /^\{details\}$/ }) });
  await expect(root).toBeVisible();
  await expect(root).not.toContainText("Nested");
  await root.click();
  expect((await snapshot(page)).pages.p.pageScripts[0].steps[2].then[0].value).toBe("{details}");
  await b.locator(".se-value-source").click();
  await picker(page).getByPlaceholder("変数名・値で検索").fill("empty");
  await expect(row(page, "{empty}")).toBeVisible();
});
