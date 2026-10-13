import { readEditorCss } from "../tests/helpers/editor-css";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { build } from "esbuild";
import { resolve } from "node:path";
import { scriptKeyboardDoc } from "../tests/helpers/script-keyboard";

let bundle: string;
test.beforeAll(async () => {
  bundle = (await build({
    stdin: {
      contents: `
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import ScriptEditor from "./components/ScriptEditor";
import DialogHost from "./components/DialogHost";
import { useEditor } from "./lib/store";
import { showPrompt } from "./lib/dialog";
import { loadLocale } from "./lib/i18n";
const css = ${JSON.stringify(readEditorCss())};
const style = document.createElement("style"); style.textContent = css; document.head.append(style);
useEditor.getState().replaceDoc(${JSON.stringify(scriptKeyboardDoc())});
useEditor.getState().setActivePage("p");
window.escapeStore = useEditor;
window.promptResults = [];
window.openEscapePrompt = () => { void showPrompt("Name", { defaultValue: "下書き Draft" })
  .then(value => window.promptResults.push(value)); };
function App() {
  const [open, setOpen] = useState(true);
  return <><DialogHost />{open && <ScriptEditor onClose={() => setOpen(false)} />}</>;
}
void loadLocale().then(() => createRoot(document.getElementById("app"))
  .render(<React.StrictMode><App /></React.StrictMode>));
`,
      loader: "tsx", sourcefile: "editor-escape-browser.tsx", resolveDir: resolve("."),
    },
    loader: { ".css": "text" }, bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
  })).outputFiles[0].text;
});

const selectedStep = (page: Page) => page.locator('.se-flow [data-step-id="open"]');
const selectStep = (page: Page) => selectedStep(page).click({ position: { x: 400, y: 6 } });
const snapshot = (page: Page) => page.evaluate(() => {
  const { doc, past, future } = (window as any).escapeStore.getState();
  return { doc, past, future };
});

// ブラウザの自動操作では、OS の日本語入力を動かせない。ブラウザの変換中を示す2つの合図を、
// 実際の DOM と React のリスナーを通して渡し、フォーカス・状態・振り分けを確かめる。
async function composingEscape(input: Locator, signal: "isComposing" | "keyCode") {
  await input.dispatchEvent("compositionstart", { data: "にほん" });
  const prevented = await input.evaluate((element, signal) => {
    const event = new KeyboardEvent("keydown", {
      key: "Escape", bubbles: true, cancelable: true,
      isComposing: signal === "isComposing", keyCode: signal === "keyCode" ? 229 : 27,
    });
    element.dispatchEvent(event);
    return event.defaultPrevented;
  }, signal);
  await input.dispatchEvent("compositionend", { data: "日本" });
  expect(prevented).toBe(false);
}

for (const locale of ["ja-JP", "en-US"]) test.describe(locale, () => {
  test.use({ locale });
  const labels = locale === "ja-JP"
    ? { script: "スクリプト", add: "動作を追加", search: "動作を検索", prompt: "入力してください" }
    : { script: "Scripts", add: "Add an action", search: "Search actions", prompt: "Enter a value" };
  test.beforeEach(async ({ page }) => {
    // 横取りしたオリジンを使えば、アプリのサーバーに頼らずに、
    // 実際の言語の読み込みが言語のクッキーを保存できる。
    await page.route("http://editor-escape.test/", route => route.fulfill({
      contentType: "text/html", body: '<html><body><div id="app"></div></body></html>',
    }));
    await page.goto("http://editor-escape.test/");
    await page.addScriptTag({ content: bundle });
    await expect(page.getByRole("dialog", { name: labels.script, exact: true })).toBeVisible();
  });

  for (const selected of [false, true]) test(`IME Escape keeps the action search, focus and ${selected ? "selection" : "the open editor"}`, async ({ page }) => {
    if (selected) {
      await selectStep(page);
      await expect(selectedStep(page)).toHaveClass(/is-selected/);
    }
    const before = await snapshot(page);
    await page.getByRole("button", { name: labels.add, exact: true }).click();
    const search = page.getByRole("combobox", { name: labels.search });
    await expect(search).toBeFocused();
    await search.fill("日本 English");
    for (const signal of ["isComposing", "keyCode"] as const) {
      await test.step(signal, async () => {
        await composingEscape(search, signal);
        await expect(search).toHaveValue("日本 English");
        await expect(search).toBeFocused();
        if (selected) await expect(selectedStep(page)).toHaveClass(/is-selected/);
        expect(await snapshot(page)).toEqual(before);
      });
    }
    // ふつうの Escape は、いちばん手前のパネルだけを閉じる。選択と画面はそのまま
    await search.press("Escape");
    await expect(search).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: labels.script, exact: true })).toBeVisible();
    if (selected) await expect(selectedStep(page)).toHaveClass(/is-selected/);
    await expect(page.getByRole("button", { name: labels.add, exact: true })).toBeFocused();
    expect(await snapshot(page)).toEqual(before);
  });

  test("IME Escape does not cancel a prompt or reach the script behind it", async ({ page }) => {
    await selectStep(page);
    const before = await snapshot(page);
    await page.evaluate(() => (window as any).openEscapePrompt());
    const prompt = page.getByRole("dialog", { name: labels.prompt, exact: true });
    const input = prompt.getByRole("textbox");
    await expect(input).toBeFocused();
    await input.fill("日本 English");
    for (const signal of ["isComposing", "keyCode"] as const) {
      await test.step(signal, async () => {
        await composingEscape(input, signal);
        await expect(input).toHaveValue("日本 English");
        await expect(input).toBeFocused();
        expect(await page.evaluate(() => (window as any).promptResults)).toEqual([]);
      });
    }
    await input.press("Escape");
    await expect(prompt).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).promptResults)).toEqual([null]);
    await expect(selectedStep(page)).toHaveClass(/is-selected/);
    expect(await snapshot(page)).toEqual(before);
  });

  test("plain Escape steps back one layer at a time: selection, then the editor", async ({ page }) => {
    await selectStep(page);
    await page.keyboard.press("Escape");
    await expect(selectedStep(page)).not.toHaveClass(/is-selected/);
    await expect(page.getByRole("dialog", { name: labels.script, exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: labels.script, exact: true })).toHaveCount(0);
  });
});
