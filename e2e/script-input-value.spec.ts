import { test, expect, type Page } from "@playwright/test";
import { scriptsFile } from "../lib/script-runtime";
import { type FieldContent, type SiteDoc } from "../lib/types";
import { publishedScriptInputValue, scriptInputValueBundle, scriptInputValueDoc } from "../tests/helpers/script-input-value";
import { fieldEditorFixture } from "./helpers/field-editor";
import { publishedScriptFileValue, scriptFileValueBundle } from "../tests/helpers/script-file-value";
import { publishedScriptSelectValue, scriptSelectValueBundle, scriptSelectValueDoc } from "../tests/helpers/script-select-value";

test.describe("script-input-value", () => {
const mountEditor = fieldEditorFixture(scriptInputValueBundle);

async function setup(page: Page, preview: boolean, doc: SiteDoc) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  if (preview) {
    await page.setContent('<html><body><div id="app" style="width:1000px;height:800px"></div></body></html>');
    await mountEditor(page, doc);
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
  { name: "normalized datetime", field: { kind: "input", inputType: "datetime-local", defaultValue: "2026-11-05T12:30" }, requested: "2026-11-06 13:30:00", expected: "2026-11-06T13:30", restored: "2026-11-07T14:30" },
  { name: "clamped range", field: { kind: "input", inputType: "range", defaultValue: "10", min: "10", max: "20", step: "5" }, requested: "99", expected: "20", restored: "15" },
  { name: "invalid color", field: { kind: "input", inputType: "color", defaultValue: "#ffffff" }, requested: "not-a-color", expected: "#000000", restored: "#123456" },
  { name: "single-line text", field: { kind: "input", defaultValue: "initial" }, requested: "first\nsecond", expected: "firstsecond", restored: "restored" },
  { name: "trimmed email", field: { kind: "input", inputType: "email", defaultValue: "initial@example.com" }, requested: "  next@example.com  ", expected: "next@example.com", restored: "restored@example.com" },
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
    // 通常の利用者の入力は元に戻る。色と範囲の欄は、それぞれ独自のネイティブの操作が必要なため、別に試す。
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
  const input = dialog.locator('.se-flow [data-step-id="assign-input-set-0"] input.se-in');
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
});

test.describe("script-file-value", () => {
let previewBundle: Promise<string>;
let publishedPage: ReturnType<typeof publishedScriptFileValue>;

async function setup(page: Page, preview: boolean) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  if (preview) {
    await page.setContent('<html><body><div id="app" style="width:1000px;height:800px"></div></body></html>');
    await page.addScriptTag({ content: await (previewBundle ??= scriptFileValueBundle()) });
  } else {
    const { doc, html } = await (publishedPage ??= publishedScriptFileValue());
    await page.setContent(html);
    await page.addScriptTag({ content: scriptsFile(doc) });
  }
  await expect(page.locator("#result")).toHaveText("file=; changes=0; name=; agree=false");
  const snapshot = () => page.evaluate(() => {
    const state = (window as any).fileEditor?.getState();
    return state ? { doc: state.doc, past: state.past, future: state.future } : null;
  });
  return { errors, snapshot };
}

for (const preview of [true, false]) {
  const context = preview ? "preview" : "exported";
  test(`${context} ignores repeated nonempty file assignments without phantom values or changes`, async ({ page }) => {
    const { errors, snapshot } = await setup(page, preview);
    const before = await snapshot();
    for (const action of ["assign-file", "assign-file", "assign-variable", "clear-file", "assign-clear-file"]) {
      await page.getByRole("button", { name: action, exact: true }).click();
      await expect(page.locator("#upload")).toHaveValue("");
      await expect(page.locator("#result")).toHaveText("file=; changes=0; name=; agree=false");
    }
    // 普通の文字の欄とチェックボックスは、引き続き編集できる。
    await page.getByRole("button", { name: "fill-controls", exact: true }).click();
    await expect(page.locator("#name")).toHaveValue("Ada");
    await expect(page.locator("#agree input")).toBeChecked();
    await expect(page.locator("#result")).toHaveText("file=; changes=0; name=Ada; agree=true");
    await page.locator("#name").fill("Grace");
    await expect(page.locator("#result")).toHaveText("file=; changes=0; name=Grace; agree=true");
    await page.getByRole("button", { name: "clear-controls", exact: true }).click();
    await expect(page.locator("#result")).toHaveText("file=; changes=0; name=; agree=false");
    expect(await snapshot()).toEqual(before);
    expect(errors).toEqual([]);
  });

  test(`${context} preserves selected files on invalid assignment and still clears them`, async ({ page }) => {
    const { errors, snapshot } = await setup(page, preview);
    const before = await snapshot();
    const upload = page.locator("#upload");
    await upload.setInputFiles([
      { name: "first.txt", mimeType: "text/plain", buffer: Buffer.from("first") },
      { name: "second.txt", mimeType: "text/plain", buffer: Buffer.from("second") },
    ]);
    await expect(page.locator("#result")).toContainText("changes=1;");
    const selectedText = await page.locator("#result").textContent();
    for (const action of ["assign-file", "assign-variable", "assign-file"]) {
      await page.getByRole("button", { name: action, exact: true }).click();
      expect(await upload.evaluate((el: HTMLInputElement) => Array.from(el.files ?? [], (file) => file.name))).toEqual(["first.txt", "second.txt"]);
      await expect(page.locator("#result")).toHaveText(selectedText!);
    }
    await page.getByRole("button", { name: "clear-file", exact: true }).click();
    await expect(upload).toHaveValue("");
    expect(await upload.evaluate((el: HTMLInputElement) => el.files?.length)).toBe(0);
    await expect(page.locator("#result")).toHaveText("file=; changes=2; name=; agree=false");
    await page.getByRole("button", { name: "clear-file", exact: true }).click();
    await expect(page.locator("#result")).toHaveText("file=; changes=2; name=; agree=false");
    await upload.setInputFiles({ name: "third.txt", mimeType: "text/plain", buffer: Buffer.from("third") });
    await expect(page.locator("#result")).toContainText("changes=3;");
    await page.getByRole("button", { name: "assign-clear-file", exact: true }).click();
    await expect(upload).toHaveValue("");
    await expect(page.locator("#result")).toHaveText("file=; changes=4; name=; agree=false");
    expect(await snapshot()).toEqual(before);
    if (preview) {
      await page.evaluate(() => (window as any).fileEditor.getState().setMode("design"));
      await expect(page.locator(".cv-design")).toHaveCount(1);
      await page.evaluate(() => {
        const editor = (window as any).fileEditor;
        editor.getState().updatePage("home", { title: "Changed title" });
        editor.getState().undo();
        editor.getState().setMode("preview");
      });
      await expect(upload).toHaveValue("");
      await expect(page.locator("#result")).toHaveText("file=; changes=0; name=; agree=false");
      expect((await snapshot())?.doc).toEqual(before?.doc);
      expect((await snapshot())?.past).toEqual(before?.past);
    }
    expect(errors).toEqual([]);
  });
}
});

test.describe("script-select-value", () => {
const mountEditor = fieldEditorFixture(scriptSelectValueBundle);

const snapshot = (page: Page) => page.evaluate(() => {
  const state = (window as any).selectScriptEditor?.getState();
  return state ? { doc: state.doc, past: state.past, future: state.future } : null;
});
async function setup(page: Page, preview: boolean, doc: SiteDoc) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  if (preview) {
    await page.setContent('<html><body><div id="app" style="width:1000px;height:800px"></div></body></html>');
    await mountEditor(page, doc);
  } else {
    const { html } = await publishedScriptSelectValue(doc);
    await page.setContent(html);
    await page.addScriptTag({ content: scriptsFile(doc) });
  }
  await expect(page.locator("#choice")).toBeVisible();
  return errors;
}
async function selection(page: Page, value: string, index: number, changes: number) {
  await expect(page.locator("#choice")).toHaveValue(value);
  await expect(page.locator("#choice")).toHaveJSProperty("selectedIndex", index - 1);
  await expect(page.locator("#result")).toHaveText(`value=${value}; index=${index}; changes=${changes}`);
}
const click = (page: Page, id: string) => page.locator(`#${id}`).click();

for (const edited of ["{missing}", ""]) test(`ScriptEditor free value ${JSON.stringify(edited)} clears preview selection without rewriting the saved default`, async ({ page }) => {
  const errors = await setup(page, true, scriptSelectValueDoc());
  const before = await snapshot(page);
  await page.getByRole("button", { name: "Edit assignment", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "スクリプト", exact: true });
  const step = dialog.locator('.se-flow [data-step-id="assign-choice-set-0"]');
  await step.locator("select").last().selectOption({ label: "その他（変数・文字列）…" });
  await step.locator("input.se-in").fill(edited);
  await step.locator("input.se-in").blur();
  await dialog.getByRole("button", { name: "閉じる", exact: true }).click();
  const saved = await snapshot(page);
  expect(saved!.doc.nodes["assign-choice"].scripts[0].steps[0].value).toBe(edited);
  expect(saved!.doc.nodes.choice.field.defaultValue).toBe("B");
  expect(saved!.past).toHaveLength(1);
  await page.getByRole("button", { name: "Toggle preview", exact: true }).click();
  await selection(page, "B", 2, 0);
  await click(page, "assign-choice");
  await selection(page, "", 0, 1);
  await click(page, "assign-choice");
  await selection(page, "", 0, 1);
  expect(await snapshot(page)).toEqual(saved);
  // 実際のスクリプトの編集を、元に戻したりやり直したりする。プレビューだけでの入力は、履歴に加えてはならない。
  await page.getByRole("button", { name: "Toggle preview", exact: true }).click();
  await page.evaluate(() => (window as any).selectScriptEditor.getState().undo());
  expect((await snapshot(page))!.doc).toEqual(before!.doc);
  await page.evaluate(() => (window as any).selectScriptEditor.getState().redo());
  expect(await snapshot(page)).toEqual(saved);
  await page.getByRole("button", { name: "Toggle preview", exact: true }).click();
  // プレビューを切り替えても、同じページで利用者が選んだ入力は残る。リセットするのはスクリプトの変数だけ。
  await selection(page, "", 0, 0);
  await click(page, "valid-choice");
  await selection(page, "A", 1, 1);
  await click(page, "assign-choice");
  await selection(page, "", 0, 2);
  expect(await snapshot(page)).toEqual(saved);
  // 同じ保存した文書を、生成した公開用のコードと比べる。
  await setup(page, false, saved!.doc);
  await selection(page, "B", 2, 0);
  await click(page, "assign-choice");
  await selection(page, "", 0, 1);
  await click(page, "assign-choice");
  await selection(page, "", 0, 1);
  expect(errors).toEqual([]);
});

for (const preview of [true, false]) for (const options of [["A", "B"], ["A", "{empty}", "B"], []]) {
  const label = preview ? "preview" : "exported";
  test(`${label} preserves real empty choices and only fires changes for effective selections (${JSON.stringify(options)})`, async ({ page }) => {
    const errors = await setup(page, preview, scriptSelectValueDoc(options));
    const before = await snapshot(page);
    if (preview) await page.getByRole("button", { name: "Toggle preview", exact: true }).click();
    const hasOptions = options.length > 0, emptyIndex = options.indexOf("{empty}") + 1;
    let changes = 0;
    await selection(page, hasOptions ? "B" : "", options.length, changes);
    for (const action of ["missing-choice", "repeat-missing", "missing-choice"]) {
      await click(page, action);
      if (action === "missing-choice" && changes === 0 && hasOptions) changes++;
      await selection(page, "", 0, changes);
    }
    await click(page, "clear-choice");
    if (emptyIndex) changes++;
    await selection(page, "", emptyIndex, changes);
    await click(page, "clear-choice");
    await selection(page, "", emptyIndex, changes);
    await click(page, "missing-then-empty");
    if (emptyIndex) changes += 2;
    await selection(page, "", emptyIndex, changes);
    await click(page, "valid-choice");
    if (hasOptions) changes++;
    await selection(page, hasOptions ? "A" : "", hasOptions ? 1 : 0, changes);
    await click(page, "valid-choice");
    await selection(page, hasOptions ? "A" : "", hasOptions ? 1 : 0, changes);
    await click(page, "valid-then-missing");
    if (hasOptions) changes++;
    await selection(page, "", 0, changes);
    if (hasOptions) {
      // 選択を解除した後も、ネイティブの選択肢は動き、余分な選択肢は増えない。
      await page.locator("#choice").selectOption("B");
      changes++;
      await selection(page, "B", options.length, changes);
    }
    await expect(page.locator("#choice option")).toHaveCount(options.length);
    expect(await snapshot(page)).toEqual(before);
    expect(errors).toEqual([]);
  });
}
});
