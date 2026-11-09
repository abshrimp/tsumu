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
import css from "./app/globals.css";
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

const selectedStep = (page: Page) => page.locator('.se-ws [data-sel-key="step:open"]');
const snapshot = (page: Page) => page.evaluate(() => {
  const { doc, past, future } = (window as any).escapeStore.getState();
  return { doc, past, future };
});

// Browser automation cannot drive an OS IME. Deliver both browser composition
// signals through the real DOM/React listeners and check focus, state and routing.
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
    ? { script: "スクリプト", search: "操作を探す", prompt: "入力してください" }
    : { script: "Scripts", search: "Find an action", prompt: "Enter a value" };
  test.beforeEach(async ({ page }) => {
    // A routed origin lets the real locale loader persist its language cookie
    // without depending on the application server.
    await page.route("http://editor-escape.test/", route => route.fulfill({
      contentType: "text/html", body: '<html><body><div id="app"></div></body></html>',
    }));
    await page.goto("http://editor-escape.test/");
    await page.addScriptTag({ content: bundle });
    await expect(page.getByRole("dialog", { name: labels.script, exact: true })).toBeVisible();
  });

  test("Escape clears palette search before changing selection or closing the editor", async ({ page }) => {
    await selectedStep(page).locator(".se-ico").first().click();
    await expect(selectedStep(page)).toHaveClass(/is-selected/);
    const before = await snapshot(page);
    const search = page.getByRole("searchbox", { name: labels.search });
    await search.fill("missing action 987654");
    await search.press("Escape");
    await expect(search).toHaveValue("");
    await expect(search).toBeFocused();
    await expect(selectedStep(page)).toHaveClass(/is-selected/);
    expect(await snapshot(page)).toEqual(before);
    // Once focus leaves the field, Escape still clears selection, then closes.
    await search.blur();
    await page.keyboard.press("Escape");
    await expect(selectedStep(page)).not.toHaveClass(/is-selected/);
    await page.keyboard.press("Escape");
    await expect(page.locator(".se-backdrop")).toHaveCount(0);
    expect(await snapshot(page)).toEqual(before);
  });

  for (const signal of ["isComposing", "keyCode"] as const) {
    for (const selected of [false, true]) test(`${signal}: IME Escape preserves search, focus and ${selected ? "selection" : "the open editor"}`, async ({ page }) => {
      if (selected) {
        await selectedStep(page).locator(".se-ico").first().click();
        await expect(selectedStep(page)).toHaveClass(/is-selected/);
      }
      const before = await snapshot(page);
      const search = page.getByRole("searchbox", { name: labels.search });
      await search.fill("日本 English");
      await composingEscape(search, signal);
      await expect(search).toHaveValue("日本 English");
      await expect(search).toBeFocused();
      if (selected) await expect(selectedStep(page)).toHaveClass(/is-selected/);
      expect(await snapshot(page)).toEqual(before);
      await search.press("Escape");
      await expect(search).toHaveValue("");
      await expect(search).toBeFocused();
    });

    test(`${signal}: IME Escape does not cancel a prompt or reach the script behind it`, async ({ page }) => {
      await selectedStep(page).locator(".se-ico").first().click();
      const before = await snapshot(page);
      await page.evaluate(() => (window as any).openEscapePrompt());
      const prompt = page.getByRole("dialog", { name: labels.prompt, exact: true });
      const input = prompt.getByRole("textbox");
      await expect(input).toBeFocused();
      await input.fill("日本 English");
      await composingEscape(input, signal);
      await expect(input).toHaveValue("日本 English");
      await expect(input).toBeFocused();
      expect(await page.evaluate(() => (window as any).promptResults)).toEqual([]);
      await input.press("Escape");
      await expect(prompt).toHaveCount(0);
      expect(await page.evaluate(() => (window as any).promptResults)).toEqual([null]);
      await expect(selectedStep(page)).toHaveClass(/is-selected/);
      expect(await snapshot(page)).toEqual(before);
    });
  }
});
