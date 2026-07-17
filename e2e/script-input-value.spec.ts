import { expect, test, type Page } from "@playwright/test";
import { scriptsFile } from "../lib/script-runtime";
import type { FieldContent, SiteDoc } from "../lib/types";
import { publishedScriptInputValue, scriptInputValueBundle, scriptInputValueDoc } from "../tests/helpers/script-input-value";

async function setup(page: Page, preview: boolean, doc: SiteDoc) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  if (preview) {
    await page.setContent('<html><body><div id="app" style="width:1000px;height:800px"></div></body></html>');
    await page.addScriptTag({ content: await scriptInputValueBundle(doc) });
  } else {
    const { html } = await publishedScriptInputValue(doc);
    await page.setContent(html);
    await page.addScriptTag({ content: scriptsFile(doc) });
  }
  await expect(page.locator("#entry")).toBeVisible();
  return errors;
}
const snapshot = (page: Page) => page.evaluate(() => {
  const state = (window as any).inputScriptEditor?.getState();
  return state ? { doc: state.doc, past: state.past, future: state.future } : null;
});
async function value(page: Page, expected: string, changes: number) {
  await expect(page.locator("#entry")).toHaveValue(expected);
  await expect(page.locator("#result")).toHaveText(`value=[${expected}]; changes=${changes}`);
}
const click = (page: Page, id: string) => page.locator(`#${id}`).click();

const cases: { name: string; field: FieldContent; requested: string; expected: string; restored: string }[] = [
  { name: "invalid number", field: { kind: "input", inputType: "number", defaultValue: "12" }, requested: "not-a-number", expected: "", restored: "8" },
  { name: "invalid date", field: { kind: "input", inputType: "date", defaultValue: "2026-11-05" }, requested: "2026-02-30", expected: "", restored: "2026-11-06" },
  { name: "invalid time", field: { kind: "input", inputType: "time", defaultValue: "12:30" }, requested: "25:00", expected: "", restored: "13:30" },
  { name: "normalized datetime", field: { kind: "input", inputType: "datetime-local", defaultValue: "2026-11-05T12:30" }, requested: "2026-11-06 13:30:00", expected: "2026-11-06T13:30", restored: "2026-11-07T14:30" },
  { name: "invalid month", field: { kind: "input", inputType: "month", defaultValue: "2026-11" }, requested: "2026-13", expected: "", restored: "2026-12" },
  { name: "invalid week", field: { kind: "input", inputType: "week", defaultValue: "2026-W45" }, requested: "2026-W99", expected: "", restored: "2026-W46" },
  { name: "clamped range", field: { kind: "input", inputType: "range", defaultValue: "10", min: "10", max: "20", step: "5" }, requested: "99", expected: "20", restored: "15" },
  { name: "rounded range", field: { kind: "input", inputType: "range", defaultValue: "10", min: "10", max: "20", step: "5" }, requested: "14", expected: "15", restored: "20" },
  { name: "empty range", field: { kind: "input", inputType: "range", defaultValue: "10", min: "10", max: "20", step: "5" }, requested: "", expected: "15", restored: "20" },
  { name: "invalid color", field: { kind: "input", inputType: "color", defaultValue: "#ffffff" }, requested: "not-a-color", expected: "#000000", restored: "#123456" },
  { name: "single-line text", field: { kind: "input", defaultValue: "initial" }, requested: "first\nsecond", expected: "firstsecond", restored: "restored" },
  { name: "trimmed email", field: { kind: "input", inputType: "email", defaultValue: "initial@example.com" }, requested: "  next@example.com  ", expected: "next@example.com", restored: "restored@example.com" },
  { name: "trimmed URL", field: { kind: "input", inputType: "url", defaultValue: "https://example.com" }, requested: "  https://example.org  ", expected: "https://example.org", restored: "https://example.net" },
  { name: "textarea line endings", field: { kind: "textarea", defaultValue: "initial" }, requested: "first\r\nsecond", expected: "first\nsecond", restored: "restored" },
];

for (const preview of [true, false]) for (const entry of cases) {
  test(`${preview ? "preview" : "exported"} scripts use native input values: ${entry.name}`, async ({ page }) => {
    const doc = scriptInputValueDoc(entry.field, entry.requested, entry.restored);
    const errors = await setup(page, preview, doc);
    const before = await snapshot(page);
    if (preview) await page.getByRole("button", { name: "Toggle preview", exact: true }).click();
    await value(page, entry.field.defaultValue!, 0);
    await click(page, "assign-input");
    await value(page, entry.expected, 1);
    await click(page, "assign-input");
    await click(page, "repeat-input");
    await value(page, entry.expected, 1);
    await click(page, "restore-input");
    await value(page, entry.restored, 2);
    await click(page, "restore-then-assign");
    await value(page, entry.expected, 3);
    await click(page, "restore-then-assign");
    await value(page, entry.expected, 5);
    // Normal user input resumes; color and range require their own native interactions and are tested separately.
    if (entry.field.inputType === "range") {
      await page.locator("#entry").focus();
      await page.locator("#entry").press("ArrowLeft");
      await value(page, String(Number(entry.expected) - 5), 6);
    } else if (entry.field.inputType !== "color") {
      await page.locator("#entry").fill(entry.restored);
      await page.locator("#entry").blur();
      await value(page, entry.restored, 6);
    }
    expect(await snapshot(page)).toEqual(before);
    expect(errors).toEqual([]);
  });
}

test("ScriptEditor numeric assignment preserves the document and undo history while preview normalizes values", async ({ page }) => {
  const doc = scriptInputValueDoc({ kind: "input", inputType: "number", defaultValue: "12" }, "4", "8");
  const errors = await setup(page, true, doc);
  const before = await snapshot(page);
  await page.getByRole("button", { name: "Edit assignment", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "スクリプト", exact: true });
  const input = dialog.locator('.se-ws [data-sel-key="step:assign-input-set-0"] input.se-in');
  await input.fill("not-a-number");
  await input.blur();
  await dialog.getByRole("button", { name: "閉じる", exact: true }).click();
  const saved = await snapshot(page);
  expect(saved!.doc.nodes["assign-input"].scripts[0].steps[0].value).toBe("not-a-number");
  expect(saved!.doc.nodes.entry.field.defaultValue).toBe("12");
  expect(saved!.past).toHaveLength(1);
  await page.getByRole("button", { name: "Toggle preview", exact: true }).click();
  await click(page, "assign-input");
  await value(page, "", 1);
  await click(page, "assign-input");
  await value(page, "", 1);
  expect(await snapshot(page)).toEqual(saved);
  await page.getByRole("button", { name: "Toggle preview", exact: true }).click();
  await page.evaluate(() => (window as any).inputScriptEditor.getState().undo());
  expect((await snapshot(page))!.doc).toEqual(before!.doc);
  await page.evaluate(() => (window as any).inputScriptEditor.getState().redo());
  expect(await snapshot(page)).toEqual(saved);
  await page.getByRole("button", { name: "Toggle preview", exact: true }).click();
  await value(page, "", 0);
  await click(page, "restore-input");
  await value(page, "8", 1);
  await click(page, "assign-input");
  await value(page, "", 2);
  expect(await snapshot(page)).toEqual(saved);
  await setup(page, false, saved!.doc);
  await value(page, "12", 0);
  await click(page, "assign-input");
  await value(page, "", 1);
  expect(errors).toEqual([]);
});

test("native typing is preserved before any assignment when change scripts rerender the Canvas", async ({ page }) => {
  const doc = scriptInputValueDoc({ kind: "input", inputType: "number", defaultValue: "12" }, "invalid", "8");
  const errors = await setup(page, true, doc);
  const before = await snapshot(page);
  await page.getByRole("button", { name: "Toggle preview", exact: true }).click();
  await value(page, "12", 0);
  const input = page.locator("#entry");
  await input.fill("7");
  await value(page, "7", 1);
  await input.pressSequentially("8");
  await value(page, "78", 2);
  await input.press("Backspace");
  await value(page, "7", 3);
  await input.fill("");
  await value(page, "", 4);
  await input.pressSequentially("9");
  await value(page, "9", 5);
  await input.blur();
  await value(page, "9", 5);
  expect(await snapshot(page)).toEqual(before);
  expect(errors).toEqual([]);
});
