import { test, expect, type Page, type Locator } from "@playwright/test";
import { dialogFocusBundle } from "../tests/helpers/dialog-focus";
import { readEditorCss } from "../tests/helpers/editor-css";
import { bodySearchModalBundle } from "../tests/helpers/body-search-modal";
import { build } from "../tests/helpers/bundle";
import { resolve as resolve_2 } from "node:path";
import { scriptKeyboardDoc } from "../tests/helpers/script-keyboard";

test.describe("dialog-focus", () => {
let bundle: string;
test.beforeAll(async () => { bundle = await dialogFocusBundle(); });
test.beforeEach(async ({ page }) => {
  // loadLocale は言語のクッキーを書くが、about:blank のオリジンは中身が見えない。
  // 準備のコードを入れる前に、動いているテスト用サーバーのテキストのエンドポイントを開く。
  await page.goto("/robots.txt");
  await page.setContent('<div id="app"></div>');
  await page.addScriptTag({ content: bundle });
  await expect(page.locator("#confirm")).toBeVisible();
});

for (const locale of ["ja-JP", "en-US"]) test.describe(locale, () => {
  test.use({ locale });
  const cancelName = locale === "ja-JP" ? "キャンセル" : "Cancel";
  const promptName = locale === "ja-JP" ? "入力してください" : "Enter a value";

  test("keyboard confirmation stays modal and restores its trigger", async ({ page }) => {
    await page.keyboard.press("Tab");
    await expect(page.locator("#confirm")).toBeFocused();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog");
    const cancel = dialog.getByRole("button", { name: cancelName, exact: true });
    const ok = dialog.getByRole("button", { name: "OK", exact: true });
    await expect(cancel).toBeFocused();
    await page.keyboard.press("Shift+Tab"); await expect(ok).toBeFocused();
    await page.keyboard.press("Tab"); await expect(cancel).toBeFocused();
    await page.keyboard.press("Tab"); await expect(ok).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(page.locator("#confirm")).toBeFocused();
    await expect(page.locator("#results")).toHaveText("[false]");
    await expect(page.getByRole("textbox", { name: "Background name" })).toHaveValue("unchanged");
  });

  test("prompt is named, skips disabled OK, and preserves IME input", async ({ page }) => {
    await page.locator("#prompt").focus(); await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog");
    const input = dialog.getByRole("textbox", { name: promptName, exact: true });
    const cancel = dialog.getByRole("button", { name: cancelName, exact: true });
    const ok = dialog.getByRole("button", { name: "OK", exact: true });
    await expect(input).toBeFocused(); await expect(input).toHaveAccessibleDescription("Type DELETE");
    await expect(ok).toBeDisabled();
    await page.keyboard.press("Shift+Tab"); await expect(cancel).toBeFocused();
    await page.keyboard.press("Tab"); await expect(input).toBeFocused();
    await input.dispatchEvent("compositionstart"); await input.fill("日本語");
    for (const init of [{ isComposing: true }, { keyCode: 229 }]) {
      for (const key of ["Enter", "Escape"]) await input.dispatchEvent("keydown", { key, ...init });
      await expect(input).toBeFocused(); await expect(input).toHaveValue("日本語");
      await expect(page.locator("#results")).toHaveText("[]");
    }
    await input.dispatchEvent("compositionend", { data: "日本語" });
    await input.fill("DELETE"); await expect(ok).toBeEnabled();
    await page.keyboard.press("Shift+Tab"); await expect(ok).toBeFocused();
    await page.keyboard.press("Tab"); await expect(input).toBeFocused();
    await page.keyboard.press("Enter"); await expect(dialog).toHaveCount(0);
    await expect(page.locator("#prompt")).toBeFocused();
    await expect(page.locator("#results")).toHaveText('["DELETE"]');
  });

  test("queued dialogs keep focus through the transition and return it after the last closes", async ({ page }) => {
    await page.locator("#queue").focus(); await page.keyboard.press("Enter");
    await page.getByRole("dialog").getByRole("button", { name: cancelName, exact: true }).click();
    const alert = page.getByRole("alertdialog");
    const ok = alert.getByRole("button", { name: "OK", exact: true });
    await expect(ok).toBeFocused();
    for (const key of ["Tab", "Shift+Tab", "Tab"]) {
      await page.keyboard.press(key); await expect(ok).toBeFocused();
    }
    await page.keyboard.press("Enter"); await expect(alert).toHaveCount(0);
    await expect(page.locator("#queue")).toBeFocused();
    await expect(page.locator("#results")).toHaveText('[false,"second"]');
  });
});

test("a closing dialog cannot take focus and follows changes to reduced motion", async ({ page }) => {
  for (const reducedMotion of ["no-preference", "reduce"] as const) {
    await page.emulateMedia({ reducedMotion });
    await page.locator("#alert").click();
    const ok = page.getByRole("alertdialog").getByRole("button", { name: "OK" });
    const result = await ok.evaluate(async (button) => {
      (button as HTMLButtonElement).click();
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      const copy = document.querySelector<HTMLElement>(".is-leaving");
      copy?.querySelector("button")?.focus();
      return { hasCopy: !!copy, focused: document.activeElement?.id };
    });
    expect(result).toEqual({ hasCopy: reducedMotion === "no-preference", focused: "alert" });
    await expect(page.locator(".is-leaving")).toHaveCount(0);
  }
});

test.describe("touch", () => {
  test.use({ hasTouch: true });
  test("touch can acknowledge an alert without trapping later keyboard navigation", async ({ page }) => {
    await page.locator("#alert").tap();
    const alert = page.getByRole("alertdialog");
    await alert.getByRole("button", { name: "OK", exact: true }).tap();
    await expect(alert).toHaveCount(0);
    await expect(page.locator("#results")).toHaveText('["acknowledged"]');
    await page.locator("#confirm").focus(); await page.keyboard.press("Tab");
    await expect(page.locator("#prompt")).toBeFocused();
  });
});
});

test.describe("body-search-modal", () => {
let bundle: string;
const css = readEditorCss();
test.beforeAll(async () => { bundle = await bodySearchModalBundle(); });
test.beforeEach(async ({ page }) => {
  // A transformed and clipped parent catches dialogs not portaled to document.body.
  await page.setContent('<html lang="ja"><body><header style="position:relative; height:24px; transform:translateZ(0); overflow:hidden"><div id="app"></div></header></body></html>');
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: bundle });
  await expect(page.getByRole("dialog", { name: "本文を検索" })).toBeVisible();
});

test("Search dialog uses a visible header, clear control and independently scrolling results", async ({ page }) => {
  const modal = page.getByRole("dialog", { name: "本文を検索" });
  await expect(modal.locator(".body-search-head h2")).toHaveText("本文を検索");
  const close = modal.getByRole("button", { name: "閉じる" });
  const title = modal.locator(".body-search-head h2");
  const closeBox = await close.boundingBox();
  const titleBox = await title.boundingBox();
  expect(closeBox!.x).toBeGreaterThan(titleBox!.x + titleBox!.width);
  const input = modal.getByRole("searchbox", { name: "本文を検索" });
  await input.fill("日本語の本文");
  await expect(modal.locator(".body-search-result")).toHaveCount(100);
  await expect(modal.locator(".body-search-meta")).toContainText("100");
  const scroll = modal.locator(".body-search-results");
  await expect.poll(() => scroll.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
  await scroll.evaluate((node) => { node.scrollTop = 200; });
  await expect.poll(() => scroll.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
  await modal.getByRole("button", { name: "検索をクリア" }).click();
  await expect(input).toHaveValue("");
  await expect(input).toBeFocused();
  await expect(modal.locator(".body-search-result")).toHaveCount(0);
  await input.press("Escape");
  await expect(modal).toHaveCount(0);
});

test("Search results navigate to the correct page and select its text", async ({ page }) => {
  const modal = page.getByRole("dialog", { name: "本文を検索" });
  await modal.getByRole("searchbox", { name: "本文を検索" }).fill("Unique visitor text");
  await expect(modal.locator(".body-search-result")).toHaveCount(1);
  await expect(modal.locator(".body-search-result-name")).toContainText("Second page / Target");
  await modal.locator(".body-search-result").click();
  await expect(modal).toHaveCount(0);
  const selection = await page.evaluate(() => {
    const state = (window as any).bodySearchStore.getState();
    return { active: state.activePageId, selected: state.selection, leftTab: state.leftTab };
  });
  expect(selection).toEqual({ active: "other", selected: "special", leftTab: "layers" });
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await modal.getByRole("searchbox").fill("Reusable card text");
  await modal.getByRole("button", { name: /Second page \/ Card label/ }).click();
  expect(await page.evaluate(() => {
    const state = (window as any).bodySearchStore.getState();
    return [state.activePageId, state.editingComponentId, state.selection];
  })).toEqual(["other", "card", "card-root"]);
});

test("Mobile modal stays inside the viewport and does not clip the search field", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 540 });
  const modal = page.getByRole("dialog", { name: "本文を検索" });
  const modalRect = await modal.boundingBox();
  const fieldRect = await modal.locator(".body-search-field").boundingBox();
  const closeRect = await modal.getByRole("button", { name: "閉じる" }).boundingBox();
  expect(modalRect!.x).toBeGreaterThanOrEqual(0);
  expect(modalRect!.x + modalRect!.width).toBeLessThanOrEqual(375);
  expect(modalRect!.y + modalRect!.height).toBeLessThanOrEqual(540);
  expect(fieldRect!.x).toBeGreaterThan(modalRect!.x);
  expect(fieldRect!.x + fieldRect!.width).toBeLessThan(modalRect!.x + modalRect!.width);
  expect(closeRect!.y).toBeGreaterThanOrEqual(modalRect!.y);
  await modal.getByRole("searchbox", { name: "本文を検索" }).fill("Searchable");
  await expect(modal.locator(".body-search-result")).toHaveCount(100);
  await expect(modal.getByRole("searchbox", { name: "本文を検索" })).toBeVisible();
});
});

test.describe("custom-code-editor", () => {
async function newSite(page: Page, name: string) {
  await page.addInitScript(() => localStorage.setItem("tsumu-help-seen-v1", "1"));
  const response = await page.request.post("/api/sites", { data: { name } });
  expect(response.ok()).toBeTruthy();
  const { site } = (await response.json()) as { site: { id: string } };
  await page.goto("/sites/" + site.id);
}

test("site head/body, page head/end, and raw HTML modals edit per-field with syntax highlighting without executing HTML", async ({ page }) => {
  await newSite(page, "Custom code per field");
  await page.locator('[data-tutorial="left-tab-site"]').click();
  const siteSection = page.locator('[data-tutorial="site-code"]');
  await siteSection.locator(".sec-title").click();
  await expect(siteSection.locator(".sec-head .code-editor-button")).toHaveCount(0);
  await expect(siteSection.locator(".code-field-heading .code-editor-button")).toHaveCount(2);
  await siteSection.getByRole("button", { name: "head内コード: コードエディタで編集" }).click();
  const dialog = page.getByRole("dialog", { name: /head内コード.*コードエディタ/ });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".custom-code-tabs")).toHaveCount(0);
  const source = '<style>.hero { color: red; }</style><script>const answer = "ok";</script>';
  await dialog.getByRole("textbox", { name: "head内コード" }).fill(source);
  await expect(dialog.locator(".code-token-tag").first()).toBeVisible();
  await expect(dialog.locator(".code-token-property")).toContainText("color");
  await expect(dialog.locator(".code-token-keyword")).toContainText("const");
  expect(await dialog.locator(".custom-code-highlight code").evaluate(el => el.textContent)).toBe(source + "\n");
  const box = await dialog.boundingBox();
  const viewport = page.viewportSize()!;
  expect(box!.width).toBeGreaterThan(viewport.width * 0.8);
  expect(box!.height).toBeGreaterThan(viewport.height * 0.8);
  await dialog.getByRole("button", { name: "適用" }).click();

  await expect(page.locator("#site-head-code")).toHaveValue(source);
  await expect(page.locator("#site-body-code")).toHaveValue("");
  await siteSection.getByRole("button", { name: "body末尾コード: コードエディタで編集" }).click();
  const bodyDialog = page.getByRole("dialog", { name: /body末尾コード.*コードエディタ/ });
  await bodyDialog.getByRole("textbox", { name: "body末尾コード" }).fill("<script>window.x = 1</script>");
  await bodyDialog.getByRole("button", { name: "キャンセル" }).click();
  await expect(page.locator("#site-body-code")).toHaveValue("");
  await expect(page.locator("#site-head-code")).toHaveValue(source);

  const pageSection = page.locator('[data-tutorial="page-code"]');
  await pageSection.locator(".sec-title").click();
  await expect(pageSection.locator(".sec-head .code-editor-button")).toHaveCount(0);
  await pageSection.getByRole("button", { name: "先頭コード（このページのみ）: コードエディタで編集" }).click();
  const pageDialog = page.getByRole("dialog");
  await pageDialog.getByRole("textbox", { name: "先頭コード（このページのみ）" }).fill("<meta name='test' content='head'>");
  await pageDialog.getByRole("button", { name: "適用" }).click();
  await pageSection.getByRole("button", { name: "末尾コード（このページのみ）: コードエディタで編集" }).click();
  await pageDialog.getByRole("textbox", { name: "末尾コード（このページのみ）" }).fill("<script>window.test = 1</script>");
  await pageDialog.getByRole("button", { name: "適用" }).click();
  await expect(pageSection.locator('[id$="-top"]')).toHaveValue("<meta name='test' content='head'>");
  await expect(pageSection.locator('[id$="-end"]')).toHaveValue("<script>window.test = 1</script>");

  await pageSection.locator(".seg").getByRole("button", { name: "HTML", exact: true }).click();
  await page.getByRole("button", { name: "切り替える", exact: true }).click();
  await pageSection.getByRole("button", { name: "HTMLコード: コードエディタで編集" }).click();
  const rawDialog = page.getByRole("dialog", { name: /HTMLコード.*コードエディタ/ });
  const html = "<!doctype html>\n<html><body><img src=x data-onerror=example><!-- note --><script>const x = 1</script></body></html>";
  await rawDialog.getByRole("textbox", { name: "HTMLコード" }).fill(html);
  await expect(rawDialog.locator(".custom-code-highlight img")).toHaveCount(0);
  await expect(rawDialog.locator(".custom-code-highlight script")).toHaveCount(0);
  expect(await rawDialog.locator(".custom-code-highlight code").evaluate(el => el.textContent)).toBe(html + "\n");
  await rawDialog.getByRole("button", { name: "適用" }).click();
  await expect(pageSection.locator('[id$="-rawhtml"]')).toHaveValue(html);
});
});

test.describe("editor-escape-scope", () => {
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
      loader: "tsx", sourcefile: "editor-escape-browser.tsx", resolveDir: resolve_2("."),
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
});
