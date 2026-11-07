import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { expectVariableMenuLayout } from "./helpers/variable-menu-layout";
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
const row = (page: Page, token: string) => picker(page).locator(".vx-row").filter({ has: page.locator(".vx-tok").filter({ hasText: new RegExp(`^${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) }) });
async function snapshot(page: Page) {
  return page.evaluate(() => JSON.parse(JSON.stringify((window as any).dataPickerStore.getState().doc)));
}
async function selected(page: Page) { return (await snapshot(page)).pages.p.pageScripts[0].steps.find((s: any) => s.id === "value").value; }
async function openPicker(page: Page, id = "value", selectAll = true) {
  const input = block(page, id).locator("input").first();
  await input.focus(); if (selectAll) await input.selectText();
  await input.press("Control+/");
  await expect(picker(page)).toBeVisible();
}
async function pick(page: Page, name: string, id = "value") {
  await picker(page).getByPlaceholder("変数名・値で検索").fill(name);
  await row(page, `{${name}}`).click();
  await block(page, id).locator("input").first().blur();
}

test("スクリプトの値候補と変数名候補は外側のクリックで閉じる", async ({ page }) => {
  const input = block(page, "value").locator("input").first();
  await input.focus();
  await expect(page.locator(".var-comp")).toBeVisible();
  await page.locator(".se-header").click({ position: { x: 70, y: 12 } });
  await expect(page.locator(".var-comp")).toHaveCount(0);

  const name = block(page, "value").getByPlaceholder("名前（例: 合計）");
  await name.focus();
  await name.fill("");
  await expect(page.locator(".var-comp")).toBeVisible();
  await page.locator(".se-header").click({ position: { x: 70, y: 12 } });
  await expect(page.locator(".var-comp")).toHaveCount(0);
});

test("one value input keeps raw objects, save/load and Undo without mode or redundant search buttons", async ({ page }) => {
  const b = block(page, "value"); const before = await snapshot(page);
  await expect(b.getByRole("combobox", { name: "値の入力方法" })).toHaveCount(0);
  await expect(b.getByRole("button", { name: "データを選ぶ", exact: true })).toHaveCount(0);
  await openPicker(page); await pick(page, "data");
  expect(await selected(page)).toBe("{data}");
  await expect(b.locator(".se-value-info")).toContainText("項目付きデータ");
  const changed = await snapshot(page);
  await page.getByRole("button", { name: "取り消す", exact: true }).click(); expect(await snapshot(page)).toEqual(before);
  await page.getByRole("button", { name: "やり直す", exact: true }).click(); expect(await snapshot(page)).toEqual(changed);
  await page.evaluate((doc) => (window as any).dataPickerStore.getState().replaceDoc(JSON.parse(JSON.stringify(doc))), changed);
  expect(await snapshot(page)).toEqual(changed);
});

test("string value hints and card hover remain inside rounded borders", async ({ page }) => {
  await openPicker(page); await pick(page, "data.name");
  await expect(block(page, "value").locator(".se-value-info .vx-kind")).toHaveText("文字列");
  await expect(block(page, "value").locator(".se-value-sample")).toHaveCount(0);
  const valueBlock = block(page, "value");
  await valueBlock.hover();
  const style = await valueBlock.evaluate(el => {
    const stack = el.closest(".se-stack")!;
    const computed = getComputedStyle(stack);
    return { overflow: computed.overflow, radius: computed.borderTopLeftRadius, borderWidth: computed.borderTopWidth };
  });
  expect(style).toEqual({ overflow: "clip", radius: "10px", borderWidth: "1px" });
});

test("変数を探すの行は下の操作案内の区切り線と角丸が重ならない", async ({ page }) => {
  const input = block(page, "value").locator("input").first();
  await input.focus();
  const explore = page.locator(".var-comp-explore");
  const footer = page.locator(".var-comp-foot");
  await expect(explore).toBeVisible();
  await expect(footer).toBeVisible();
  const corners = await explore.evaluate((element) => {
    const style = getComputedStyle(element);
    return [style.borderBottomLeftRadius, style.borderBottomRightRadius];
  });
  expect(corners).toEqual(["0px", "0px"]);
  await expect(footer).toHaveCSS("border-top-width", "1px");
});

test("focus suggestions offer a touch/click route to nested data and Cmd+/ opens unfiltered exploration", async ({ page }) => {
  const input = block(page, "value").locator("input").first();
  await input.focus();
  await expect(page.locator(".var-comp-explore")).toBeVisible();
  await expect(page.locator(".var-comp-foot")).toContainText("変数を探す");
  await page.locator(".var-comp-explore").click();
  await expect(picker(page)).toBeVisible();
  await picker(page).getByPlaceholder("変数名・値で検索").press("Escape");
  await input.fill("data.name"); await input.press("Control+/");
  await expect(picker(page).getByPlaceholder("変数名・値で検索")).toHaveValue("");
  await expect(row(page, "{data}")).toBeVisible();
});

test("text picker expands object rows and keyboard chooses a scalar leaf without inserting the object", async ({ page }) => {
  const b = block(page, "copy"); await openPicker(page, "copy");
  const data = row(page, "{data}"); await data.focus(); await data.press("Enter");
  await expect(picker(page)).toBeVisible();
  const title = row(page, "{data.name}");
  await expect(title.locator(".vx-kind")).toHaveText("文字列");
  await title.focus(); await title.press("Enter");
  await expect(picker(page)).toHaveCount(0);
  await expect(b.locator("input").first()).toHaveValue("{data.name}");
  await b.locator("input").first().blur();
  expect((await snapshot(page)).pages.p.pageScripts[0].steps.find((s: any) => s.id === "copy").value).toBe("{data.name}");
});

test("numeric picker excludes incompatible values but retains dynamic variables, cancelling changes nothing", async ({ page }) => {
  const before = await snapshot(page); await openPicker(page, "calc");
  const search = picker(page).getByPlaceholder("変数名・値で検索");
  await search.fill("data.name"); await expect(picker(page).locator(".vx-row")).toHaveCount(0);
  await search.fill("data.price"); await expect(row(page, "{data.price}")).toBeVisible();
  await search.fill("later"); await expect(row(page, "{later}")).toBeVisible();
  await search.press("Escape"); expect(await snapshot(page)).toEqual(before);
});

test("legacy mixed templates and generated code survive exploring, cancelling and save/load unchanged", async ({ page }) => {
  const before = await snapshot(page);
  const original = await page.evaluate(() => (window as any).dataPickerProject());
  await openPicker(page);
  await picker(page).getByPlaceholder("変数名・値で検索").press("Escape");
  await expect(block(page, "value").locator("input").first()).toHaveValue("Legacy {data.name}");
  await block(page, "value").locator("input").first().blur();
  expect(await snapshot(page)).toEqual(before);
  await page.evaluate(() => { const store = (window as any).dataPickerStore; store.getState().replaceDoc(JSON.parse(JSON.stringify(store.getState().doc))); });
  expect(await page.evaluate(() => (window as any).dataPickerProject())).toEqual(original);
});

test("typed references preserve arrays, false, null and runtime-unknown choices", async ({ page }) => {
  for (const name of ["data.tags", "data.available", "data.empty", "later"]) {
    await openPicker(page); await pick(page, name);
    expect(await selected(page)).toBe(`{${name}}`);
  }
});

test("keyboard exploration preserves uncommitted literal and escaped text on cancellation", async ({ page }) => {
  const input = block(page, "value").locator("input").first();
  await input.fill("001 false \\{literal} {data.name}"); await input.press("Control+/");
  await picker(page).getByPlaceholder("変数名・値で検索").press("Escape");
  await expect(input).toHaveValue("001 false \\{literal} {data.name}"); await input.blur();
  expect(await selected(page)).toBe("001 false \\{literal} {data.name}");
});

test("a newly defined output cannot suggest itself, but a prior producer remains available to update", async ({ page }) => {
  const input = block(page, "value").locator("input").first();
  await input.fill(""); await input.focus();
  await expect(page.locator(".var-chip").filter({ hasText: /^chosen$/ })).toHaveCount(0);
  await input.press("Control+/");
  await picker(page).getByPlaceholder("変数名・値で検索").fill("chosen");
  await expect(picker(page).locator(".vx-row")).toHaveCount(0);
  await picker(page).getByPlaceholder("変数名・値で検索").press("Escape"); await input.blur();
  await page.evaluate(() => (window as any).dataPickerStore.getState().updateDoc((doc: any) => {
    doc.pages.p.pageScripts[0].steps.splice(1, 0, { id: "prior", kind: "set-var", value: "{data.name}", into: "chosen" });
  }));
  await input.focus(); await expect(page.locator(".var-chip").filter({ hasText: /^chosen$/ })).toBeVisible();
  await openPicker(page); await picker(page).getByPlaceholder("変数名・値で検索").fill("chosen");
  await expect(row(page, "{chosen}")).toContainText("Product"); await pick(page, "chosen");
  expect(await selected(page)).toBe("{chosen}");
});

test("array-field input keeps loop-local roots and ignores shortcut and Enter during IME composition", async ({ page }) => {
  await page.evaluate(() => (window as any).dataPickerStore.getState().updateDoc((doc: any) => {
    doc.pages.p.pageScripts[0].steps = [doc.pages.p.pageScripts[0].steps[0], { id: "each", kind: "for-each", array: "data.rows", then: [
      { id: "field", kind: "array-field", array: "data.rows", field: "label", value: "Legacy" },
    ] }];
  }));
  const input = block(page, "field").locator("input").first();
  await input.focus(); await input.dispatchEvent("compositionstart");
  await input.evaluate((el: HTMLInputElement) => { el.value = "入力中"; });
  await input.dispatchEvent("input", { isComposing: true, data: "入力中" });
  for (const key of ["Enter", "/"]) await input.dispatchEvent("keydown", { key, ctrlKey: true, keyCode: 229, isComposing: true });
  await expect(picker(page)).toHaveCount(0); await expect(input).toHaveValue("入力中");
  await input.dispatchEvent("compositionend", { data: "入力中" }); await input.blur();
  await openPicker(page, "field"); await pick(page, "title", "field");
  expect((await snapshot(page)).pages.p.pageScripts[0].steps[1].then[0].value).toBe("{title}");
});

test("raw picker retains a loop object with the same name as its output and shadows the page value", async ({ page }) => {
  await page.evaluate(() => (window as any).dataPickerStore.getState().updateDoc((doc: any) => {
    const fetch = doc.pages.p.pageScripts[0].steps[0]; fetch.sample.rows = [{ details: { id: "LOCAL" }, empty: {} }];
    doc.pages.p.pageScripts[0].steps = [fetch,
      { id: "global", kind: "set-var", value: "{data.detail}", into: "details" },
      { id: "each", kind: "for-each", array: "data.rows", then: [{ id: "local-value", kind: "set-var", value: "{details}", into: "details" }] },
    ];
  }));
  await expect(block(page, "local-value").locator(".se-value-info")).toContainText("実行時");
  await openPicker(page, "local-value");
  await picker(page).getByPlaceholder("変数名・値で検索").fill("details");
  await expect(row(page, "{details}")).toBeVisible(); await expect(row(page, "{details}")).not.toContainText("Nested");
  await pick(page, "details", "local-value");
  expect((await snapshot(page)).pages.p.pageScripts[0].steps[2].then[0].value).toBe("{details}");
  await openPicker(page, "local-value"); await picker(page).getByPlaceholder("変数名・値で検索").fill("empty");
  await expect(row(page, "{empty}")).toBeVisible();
});


test("inline dropdown selection replaces an existing raw object reference with a raw array reference", async ({ page }) => {
  await openPicker(page); await pick(page, "data");
  const input = block(page, "value").locator("input").first();
  await input.focus(); await input.press("End"); await input.press("Control+Space");
  await page.locator(".var-comp-list button").filter({ has: page.locator(".var-chip").filter({ hasText: /^data.tags$/ }) }).click();
  await expect(input).toHaveValue("{data.tags}"); await input.blur();
  expect(await selected(page)).toBe("{data.tags}");
  await expect(block(page, "value").locator(".se-value-info")).toContainText("リスト");
});

for (const width of [1440, 375, 320]) {
  test(`スクリプトの変数候補の3つの操作案内は幅 ${width}px でも一行に収まる`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const input = block(page, "value").locator("input").first();
    await input.focus();
    await expectVariableMenuLayout(page, width, 3);
    await input.press("Escape");
    await expect(page.locator(".var-comp")).toHaveCount(0);
    await input.blur();
    await input.focus();
    await expectVariableMenuLayout(page, width, 3);
    await page.locator(".var-comp-explore").click();
    await expect(picker(page)).toBeVisible();
    await picker(page).getByPlaceholder("変数名・値で検索").press("Escape");
    await expect(picker(page)).toHaveCount(0);
    await expect(input).toHaveValue("Legacy {data.name}");
  });
}
