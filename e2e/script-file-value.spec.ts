import { expect, test, type Page } from "@playwright/test";
import { scriptsFile } from "../lib/script-runtime";
import { publishedScriptFileValue, scriptFileValueBundle } from "../tests/helpers/script-file-value";

async function setup(page: Page, preview: boolean) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  if (preview) {
    await page.setContent('<html><body><div id="app" style="width:1000px;height:800px"></div></body></html>');
    await page.addScriptTag({ content: await scriptFileValueBundle() });
  } else {
    const { doc, html } = await publishedScriptFileValue();
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
