import { expect, test, type Page } from "@playwright/test";
import { scriptsFile } from "../lib/script-runtime";
import type { FieldContent, SiteDoc } from "../lib/types";
import { inputDefaultBundle, inputDefaultDoc, publishedInputDefault } from "../tests/helpers/input-default";

async function setup(page: Page, doc: SiteDoc) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setContent('<html><body><div id="app" style="width:1200px;height:850px"></div></body></html>');
  await page.addScriptTag({ content: await inputDefaultBundle(doc) });
  await expect(page.locator("#entry")).toBeVisible();
  return errors;
}
const snapshot = (page: Page) => page.evaluate(() => {
  const { doc, past, future } = (window as any).initialEditor.getState();
  return { doc, past, future };
});
const toggle = (page: Page) => page.getByRole("button", { name: "Toggle preview", exact: true }).click();
const setting = (page: Page, label: string) => page.locator("aside .row, aside .stack").filter({
  has: page.locator("label").filter({ hasText: new RegExp(`^${label}$`) }),
}).locator("input");
async function value(page: Page, expected: string, changes = 0) {
  await expect(page.locator("#entry")).toHaveValue(expected);
  await expect(page.locator("#result")).toHaveText(`value=[${expected}]; changes=${changes}`);
}
async function published(page: Page, doc: SiteDoc, expected: string) {
  const { html } = await publishedInputDefault(doc);
  await page.setContent(html);
  await page.addScriptTag({ content: scriptsFile(doc) });
  await value(page, expected);
  expect(await page.locator("#entry").evaluate((el) => {
    const form = document.createElement("form");
    form.append(el.cloneNode(true));
    return new FormData(form).get("entry");
  })).toBe(expected);
}

const cases: { name: string; field: FieldContent; expected: string; query?: string }[] = [
  { name: "missing range", field: { kind: "input", inputType: "range" }, expected: "50" },
  { name: "bounded range midpoint", field: { kind: "input", inputType: "range", min: "10", max: "20", step: "5" }, expected: "15" },
  { name: "invalid range", field: { kind: "input", inputType: "range", defaultValue: "invalid", min: "10", max: "20", step: "5" }, expected: "15" },
  { name: "clamped range", field: { kind: "input", inputType: "range", defaultValue: "99", min: "10", max: "20", step: "5" }, expected: "20" },
  { name: "rounded range", field: { kind: "input", inputType: "range", defaultValue: "14", min: "10", max: "20", step: "5" }, expected: "15" },
  { name: "default attribute is the range step base", field: { kind: "input", inputType: "range", defaultValue: "14", step: "5", max: "99" }, expected: "14" },
  { name: "resolved range constraints", field: { kind: "input", inputType: "range", min: "{low}", max: "{high}", step: "{increment}" }, query: "low=10&high=20&increment=5", expected: "15" },
  { name: "missing color", field: { kind: "input", inputType: "color" }, expected: "#000000" },
  { name: "invalid color", field: { kind: "input", inputType: "color", defaultValue: "invalid" }, expected: "#000000" },
  { name: "normalized color", field: { kind: "input", inputType: "color", defaultValue: "#ABCDEF" }, expected: "#abcdef" },
  { name: "invalid number", field: { kind: "input", inputType: "number", defaultValue: "invalid" }, expected: "" },
  { name: "out-of-bounds number stays populated", field: { kind: "input", inputType: "number", defaultValue: "12", max: "10" }, expected: "12" },
  { name: "invalid date", field: { kind: "input", inputType: "date", defaultValue: "2026-02-30" }, expected: "" },
  { name: "valid date", field: { kind: "input", inputType: "date", defaultValue: "2026-11-05" }, expected: "2026-11-05" },
  { name: "normalized datetime", field: { kind: "input", inputType: "datetime-local", defaultValue: "2026-11-05 12:30:00" }, expected: "2026-11-05T12:30" },
  { name: "single-line text", field: { kind: "input", defaultValue: "first\nsecond" }, expected: "firstsecond" },
  { name: "text default is not truncated", field: { kind: "input", defaultValue: "abcdef", maxLength: 3 }, expected: "abcdef" },
  { name: "trimmed email", field: { kind: "input", inputType: "email", defaultValue: "  name@example.com  " }, expected: "name@example.com" },
  { name: "textarea line endings", field: { kind: "textarea", defaultValue: "first\r\nsecond" }, expected: "first\nsecond" },
];

for (const entry of cases) test(`initial input agrees between Canvas and generated output: ${entry.name}`, async ({ page }) => {
  const doc = inputDefaultDoc(entry.field, entry.query);
  const errors = await setup(page, doc);
  const before = await snapshot(page);
  await expect(setting(page, "初期値")).toHaveValue(entry.field.defaultValue?.replace(/\r?\n/g, "") ?? "");
  await expect(page.locator("#result")).toHaveText("value=[{entry}]; changes={changes}");
  await toggle(page);
  await value(page, entry.expected);
  expect(await snapshot(page)).toEqual(before);
  await toggle(page);
  await toggle(page);
  await value(page, entry.expected);
  expect(await snapshot(page)).toEqual(before);
  await published(page, doc, entry.expected);
  expect(errors).toEqual([]);
});

test("SettingsPanel edits preserve raw defaults and history while preview respects native initial values", async ({ page }) => {
  const errors = await setup(page, inputDefaultDoc({ kind: "input", inputType: "number", defaultValue: "12" }));
  const initial = await snapshot(page);
  await setting(page, "初期値").fill("invalid");
  await toggle(page); // blur commits through the real SettingsPanel
  await value(page, "");
  const edited = await snapshot(page);
  expect(edited.doc.nodes.entry.field.defaultValue).toBe("invalid");
  expect(edited.past).toHaveLength(1);
  await page.evaluate(() => (window as any).initialEditor.getState().undo());
  await value(page, "12");
  expect((await snapshot(page)).doc).toEqual(initial.doc);
  await page.evaluate(() => (window as any).initialEditor.getState().redo());
  await value(page, "");
  expect(await snapshot(page)).toEqual(edited);
  await page.locator("#entry").fill("7");
  await value(page, "7", 1);
  expect(await snapshot(page)).toEqual(edited);
  await page.locator("#assign-input").click();
  await value(page, "8", 2);
  await toggle(page);
  await setting(page, "初期値").fill("30");
  await toggle(page);
  await value(page, "8", 0); // a new default must not erase the script-owned value
  const latest = await snapshot(page);
  expect(latest.doc.nodes.entry.field.defaultValue).toBe("30");
  expect(latest.past).toHaveLength(2);
  await published(page, latest.doc, "30");
  expect(errors).toEqual([]);
});

test("range bounds and input type can still be edited before entering preview", async ({ page }) => {
  const errors = await setup(page, inputDefaultDoc({ kind: "input", inputType: "range" }));
  await setting(page, "最小").fill("10");
  await setting(page, "最大").fill("20");
  await setting(page, "刻み").fill("5");
  await toggle(page);
  await value(page, "15");
  const bounded = await snapshot(page);
  expect(bounded.doc.nodes.entry.field.defaultValue).toBeUndefined();
  expect(bounded.past).toHaveLength(3);
  await page.evaluate(() => (window as any).initialEditor.getState().undo());
  await value(page, "15");
  await page.evaluate(() => (window as any).initialEditor.getState().undo());
  await value(page, "55");
  await page.evaluate(() => { const s = (window as any).initialEditor.getState(); s.redo(); s.redo(); });
  await value(page, "15");
  expect(await snapshot(page)).toEqual(bounded);
  await toggle(page);
  await page.locator("aside .row").filter({ has: page.locator("span.lbl").filter({ hasText: /^type$/ }) }).locator(".dd").click();
  await page.getByRole("button", { name: "color（色）", exact: true }).click();
  await toggle(page);
  await value(page, "#000000");
  const color = await snapshot(page);
  expect(color.doc.nodes.entry.field.defaultValue).toBeUndefined();
  await published(page, color.doc, "#000000");
  expect(errors).toEqual([]);
});

test("remote defaults update untouched preview inputs without replacing a later manual or scripted value", async ({ page }) => {
  const errors = await setup(page, inputDefaultDoc({ kind: "input", inputType: "number", defaultValue: "12" }));
  await toggle(page);
  await value(page, "12");
  const remote = async (defaultValue: string) => page.evaluate((next) => {
    const store = (window as any).initialEditor.getState();
    const doc = structuredClone(store.doc);
    doc.nodes.entry.field.defaultValue = next;
    store.applyRemoteDoc(doc);
  }, defaultValue);
  await remote("invalid");
  await value(page, "");
  await remote("24");
  await value(page, "24");
  await page.locator("#entry").fill("7");
  await value(page, "7", 1);
  await remote("30");
  await value(page, "7", 1);
  await page.locator("#assign-input").click();
  await value(page, "8", 2);
  await remote("invalid again");
  await value(page, "8", 2);
  const saved = await snapshot(page);
  expect(saved.doc.nodes.entry.field.defaultValue).toBe("invalid again");
  expect(saved.past).toHaveLength(0);
  await toggle(page);
  await toggle(page);
  await value(page, "8");
  expect(await snapshot(page)).toEqual(saved);
  await published(page, saved.doc, "");
  expect(errors).toEqual([]);
});
