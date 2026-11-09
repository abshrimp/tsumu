import { expect, test, type Page } from "@playwright/test";
import { scriptsFile } from "../lib/script-runtime";
import { publishedSelectDefault, selectDefaultBundle, selectDefaultDoc } from "../tests/helpers/select-default";
import type { SiteDoc } from "../lib/types";

async function setup(page: Page, doc = selectDefaultDoc()) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setContent('<html><body><div id="app" style="width:1000px;height:800px"></div></body></html>');
  await page.addScriptTag({ content: await selectDefaultBundle(doc) });
  await expect(page.locator("#choice")).toBeVisible();
  const snapshot = () => page.evaluate(() => {
    const { doc, past, future } = (window as any).selectEditor.getState();
    return { doc, past, future };
  });
  return { errors, snapshot };
}

async function selection(page: Page, value: string, index: number) {
  await expect(page.locator("#choice")).toHaveValue(value);
  await expect(page.locator("#choice")).toHaveJSProperty("selectedIndex", index - 1);
  await expect(page.locator("#result")).toHaveText(`value=${value}; index=${index}`);
}

async function published(page: Page, doc: SiteDoc, value: string, index: number) {
  const { html } = await publishedSelectDefault(doc);
  await page.setContent(html);
  await page.addScriptTag({ content: scriptsFile(doc) });
  await selection(page, value, index);
  expect(await page.locator("#choice").evaluate((el) => {
    const form = document.createElement("form");
    form.append(el.cloneNode(true));
    return new FormData(form).get("choice");
  })).toBe(index ? value : null);
}

test("editing away the default option keeps preview, bindings and generated form values consistent", async ({ page }) => {
  const { errors, snapshot } = await setup(page);
  const options = page.locator("aside textarea");
  await options.fill("A\nC");
  await page.getByRole("button", { name: "Toggle preview", exact: true }).click();
  await selection(page, "A", 1);
  const edited = await snapshot();
  expect(edited.doc.nodes.choice.field.defaultValue).toBe("B");
  expect(edited.doc.nodes.choice.field.options).toEqual([
    { label: "A", value: "A" }, { label: "C", value: "C" },
  ]);
  expect(edited.past).toHaveLength(1);
  await page.evaluate(() => (window as any).selectEditor.getState().undo());
  await selection(page, "B", 2);
  await page.evaluate(() => (window as any).selectEditor.getState().redo());
  await selection(page, "A", 1);
  expect(await snapshot()).toEqual(edited);
  // Do not overwrite an edited value with the default.
  await page.locator("#choice").selectOption("C");
  await selection(page, "C", 2);
  expect(await snapshot()).toEqual(edited);
  await page.getByRole("button", { name: "Toggle preview", exact: true }).click();
  await page.getByRole("button", { name: "Toggle preview", exact: true }).click();
  // Returning to preview on the same page preserves the user's selection.
  await selection(page, "C", 2);
  expect(await snapshot()).toEqual(edited);
  await published(page, edited.doc, "A", 1);
  expect(errors).toEqual([]);
});

test("removing every option exposes no value and index zero", async ({ page }) => {
  const { errors, snapshot } = await setup(page);
  await page.locator("aside textarea").fill("");
  await page.getByRole("button", { name: "Toggle preview", exact: true }).click();
  await selection(page, "", 0);
  const edited = await snapshot();
  expect(edited.doc.nodes.choice.field.options).toEqual([]);
  await page.evaluate(() => (window as any).selectEditor.getState().undo());
  await selection(page, "B", 2);
  await published(page, edited.doc, "", 0);
  expect(errors).toEqual([]);
});

for (const [name, doc, value, index] of [
  ["valid default", selectDefaultDoc(), "B", 2],
  ["omitted default", selectDefaultDoc({ defaultValue: undefined }), "A", 1],
  ["resolved valid default", selectDefaultDoc({ options: ["{a}", "{b}"].map((value) => ({ label: value, value })), defaultValue: "{selected}" }, "a=A&b=B&selected=B"), "B", 2],
  ["resolved missing default", selectDefaultDoc({ options: ["{a}", "{b}"].map((value) => ({ label: value, value })), defaultValue: "{selected}" }, "a=A&b=C&selected=B"), "A", 1],
  ["resolved empty first option", selectDefaultDoc({ options: ["{empty}", "B"].map((value) => ({ label: value, value })), defaultValue: "C" }, "empty="), "", 1],
  ["resolved empty default", selectDefaultDoc({ options: ["A", "{empty}"].map((value) => ({ label: value, value })), defaultValue: "{empty}" }, "empty="), "", 2],
] as const) test(`${name} agrees between preview and the generated site`, async ({ page }) => {
  const { errors, snapshot } = await setup(page, doc);
  const before = await snapshot();
  await page.getByRole("button", { name: "Toggle preview", exact: true }).click();
  await selection(page, value, index);
  expect(await snapshot()).toEqual(before);
  await published(page, doc, value, index);
  expect(errors).toEqual([]);
});
