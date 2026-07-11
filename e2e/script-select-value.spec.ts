import { expect, test, type Page } from "@playwright/test";
import { scriptsFile } from "../lib/script-runtime";
import { publishedScriptSelectValue, scriptSelectValueBundle, scriptSelectValueDoc } from "../tests/helpers/script-select-value";
import type { SiteDoc } from "../lib/types";

const snapshot = (page: Page) => page.evaluate(() => {
  const state = (window as any).selectScriptEditor?.getState();
  return state ? { doc: state.doc, past: state.past, future: state.future } : null;
});
async function setup(page: Page, preview: boolean, doc: SiteDoc) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  if (preview) {
    await page.setContent('<html><body><div id="app" style="width:1000px;height:800px"></div></body></html>');
    await page.addScriptTag({ content: await scriptSelectValueBundle(doc) });
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
  const step = dialog.locator('.se-ws [data-sel-key="step:assign-choice-set-0"]');
  await step.locator("select").last().selectOption({ label: "その他（変数・文字）…" });
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
  // 実スクリプト編集をUndo/Redoし、プレビュー中の入力は履歴へ保存しない。
  await page.getByRole("button", { name: "Toggle preview", exact: true }).click();
  await page.evaluate(() => (window as any).selectScriptEditor.getState().undo());
  expect((await snapshot(page))!.doc).toEqual(before!.doc);
  await page.evaluate(() => (window as any).selectScriptEditor.getState().redo());
  expect(await snapshot(page)).toEqual(saved);
  await page.getByRole("button", { name: "Toggle preview", exact: true }).click();
  // 同じページの入力値はプレビュー切替でも保持される。スクリプト変数だけが初期化される。
  await selection(page, "", 0, 0);
  await click(page, "valid-choice");
  await selection(page, "A", 1, 1);
  await click(page, "assign-choice");
  await selection(page, "", 0, 2);
  expect(await snapshot(page)).toEqual(saved);
  // 編集した同じ保存文書を公開用コードにして比較する。
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
      // 選択解除後に通常のユーザー選択が動き、余分な選択肢も増えていない。
      await page.locator("#choice").selectOption("B");
      changes++;
      await selection(page, "B", options.length, changes);
    }
    await expect(page.locator("#choice option")).toHaveCount(options.length);
    expect(await snapshot(page)).toEqual(before);
    expect(errors).toEqual([]);
  });
}
