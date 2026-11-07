import { test, expect } from "@playwright/test";
import { pageKindBundle } from "../tests/helpers/page-kind-confirmation";
import { buildSync } from "../tests/helpers/bundle";
import { resolve } from "node:path";
import { PAGE_HTML_COMPONENT } from "../lib/generator/templates";

test.describe("page-kind-confirmation", () => {
let bundle: string;
test.beforeAll(async () => { bundle = await pageKindBundle(); });
test.beforeEach(async ({ page }) => {
  await page.route("**/api/**", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user: null }) }));
  await page.goto("/robots.txt");
  await page.setContent('<div id="app"></div>');
  await page.addScriptTag({ content: bundle });
  // 普段は閉じている欄を、利用者と同じ手順で開く。
  await page.getByRole("button", { name: "カスタムコード", exact: true }).click();
  await expect(page.getByRole("button", { name: "HTML", exact: true })).toBeVisible();
});

test("page settings clearly distinguish editable HTML conversion and raw HTML loading", async ({ page }) => {
  await expect(page.getByRole("button", { name: "HTMLを変換して読み込む", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "HTMLとアセットのZIPを変換して読み込む", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "HTML", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "切り替える", exact: true }).click();
  await expect(page.getByRole("button", { name: "HTMLをそのまま読み込む", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "HTMLとアセットのZIPをそのまま読み込む", exact: true })).toBeVisible();
});

// The complete kind/interruption matrix is covered by the store-level tests.
// Keep browser cases for distinct dialog, focus, navigation, and collaboration behavior.
const browserInterruptions = {
  // Store tests cover the complete matrix; sample distinct browser outcomes here.
  html: ["page-return", "unmount", "cancel", "unrelated"],
  redirect: ["undo-redo", "delete", "unrelated"],
} as const;

for (const kind of ["html", "redirect"] as const) {
  for (const interruption of browserInterruptions[kind]) {
    test(`Changing ${kind} while confirmation is pending handles ${interruption}`, async ({ page }) => {
      await page.evaluate(() => (window as any).pageKindEditor.getState().updatePage("p", { title: "Undo this" }));
      await page.getByRole("button", { name: kind === "html" ? "HTML" : "リダイレクト", exact: true }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.evaluate((interruption: string) => {
        const state = () => (window as any).pageKindEditor.getState();
        if (["rawHtml", "redirectTo", "rewriteTo", "delete", "unrelated"].includes(interruption)) {
          const remote = structuredClone(state().doc);
          if (interruption === "rawHtml") remote.pages.p.rawHtml = "<p>Collaborator content</p>";
          if (interruption === "redirectTo") remote.pages.p.redirectTo = "/remote-redirect";
          if (interruption === "rewriteTo") remote.pages.p.rewriteTo = "/remote-rewrite";
          if (interruption === "delete") { delete remote.pages.p; remote.pageOrder = ["q"]; }
          if (interruption === "unrelated") {
            Object.assign(remote.pages.p, { name: "Renamed", title: "SEO update", description: "Description update" });
            remote.nodes.a.text.content = "Collaborator element edit";
            remote.pages.q.name = "Other page";
          }
          state().applyRemoteDoc(remote);
        }
        if (interruption.startsWith("undo")) state().undo();
        if (interruption === "undo-redo") state().redo();
        if (interruption === "restore") state().restoreDoc({ ...structuredClone(state().doc), siteName: "Restored" });
        if (interruption.startsWith("page")) state().setActivePage("q");
        if (interruption === "unmount") (window as any).hidePagePanel();
      }, interruption);
      if (interruption === "page-return") {
        await expect(page.locator('[data-tutorial="tutorial-page-name"]')).toHaveValue("Q");
        await page.evaluate(() => (window as any).pageKindEditor.getState().setActivePage("p"));
        await expect(page.locator('[data-tutorial="tutorial-page-name"]')).toHaveValue("P");
      }
      if (interruption === "unmount") await expect(page.locator(".panel-r")).toHaveCount(0);
      const before = await page.evaluate(() => { const { doc, past, future } = (window as any).pageKindEditor.getState(); return { doc, past, future }; });
      await page.getByRole("dialog").getByRole("button", { name: interruption === "cancel" ? "キャンセル" : "切り替える", exact: true }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      const after = await page.evaluate(() => { const { doc, past, future } = (window as any).pageKindEditor.getState(); return { doc, past, future }; });
      if (interruption === "unrelated") {
        expect(after.doc.pages.p).toEqual({ ...before.doc.pages.p, rawHtml: kind === "html" ? "" : null, redirectTo: kind === "redirect" ? "" : undefined, rewriteTo: undefined });
        expect(after.doc.nodes).toEqual(before.doc.nodes);
        expect(after.doc.pages.q).toEqual(before.doc.pages.q);
        expect(after.past.length).toBe(before.past.length + 1);
        await page.evaluate(() => (window as any).pageKindEditor.getState().undo());
        expect(await page.evaluate(() => (window as any).pageKindEditor.getState().doc)).toEqual(before.doc);
        await page.evaluate(() => (window as any).pageKindEditor.getState().redo());
        expect(await page.evaluate(() => (window as any).pageKindEditor.getState().doc)).toEqual(after.doc);
      } else expect(after).toEqual(before);
    });
  }
}

const browserTransitions = [
  ["normal", "html"], ["html", "redirect"], ["redirect", "normal"], ["rewrite", "normal"],
] as const;
for (const [from, to] of browserTransitions) {
  test(`Approved ${from} to ${to} transitions are applied`, async ({ page }) => {
    await page.evaluate(from => {
      const s = (window as any).pageKindEditor.getState();
      const doc = structuredClone(s.doc);
      Object.assign(doc.pages.p, from === "html" ? { rawHtml: "<p>Approved old HTML</p>" } : from === "redirect" ? { redirectTo: "/old" } : from === "rewrite" ? { rewriteTo: "/old" } : {});
      s.replaceDoc(doc);
    }, from);
    const before = await page.evaluate(() => (window as any).pageKindEditor.getState().doc);
    await page.getByRole("button", { name: to === "normal" ? "通常" : to === "html" ? "HTML" : "リダイレクト", exact: true }).click();
    if (to !== "normal") await page.getByRole("dialog").getByRole("button", { name: "切り替える", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const after = await page.evaluate(() => (window as any).pageKindEditor.getState().doc);
    expect(after.pages.p.rawHtml).toBe(to === "html" ? "" : null);
    expect(after.pages.p.redirectTo).toBe(to === "redirect" ? "" : undefined);
    expect(after.pages.p.rewriteTo).toBeUndefined();
    expect(after.pages.p.children).toEqual(before.pages.p.children);
    expect(after.nodes).toEqual(before.nodes);
    await page.evaluate(() => (window as any).pageKindEditor.getState().undo());
    expect(await page.evaluate(() => (window as any).pageKindEditor.getState().doc)).toEqual(before);
    await page.evaluate(() => (window as any).pageKindEditor.getState().redo());
    expect(await page.evaluate(() => (window as any).pageKindEditor.getState().doc)).toEqual(after);
  });
}
});

test.describe("page-form-accessibility", () => {
test("page settings, element inspector, and site settings fields have stable identifiers and associated labels", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("tsumu-help-seen-v1", "1"));
  const response = await page.request.post("/api/sites", { data: { name: "Form accessibility" } });
  expect(response.ok()).toBeTruthy();
  const { site } = (await response.json()) as { site: { id: string } };

  await page.goto(`/sites/${site.id}`);
  const pageSettings = page.locator('[data-tutorial="page-settings"]');
  await expect(pageSettings).toBeVisible();
  await expect(pageSettings.getByRole("textbox", { name: "名前", exact: true })).toBeVisible();
  await expect(pageSettings.getByRole("textbox", { name: /^URL/ })).toBeVisible();
  await expect(pageSettings.getByRole("combobox", { name: "言語", exact: true })).toBeVisible();

  const audit = (locator: import("@playwright/test").Locator) => locator.evaluate((root) => {
    const labels = [...root.querySelectorAll("label")]
      .filter((label) => !label.control)
      .map((label) => label.textContent?.trim() ?? "");
    const fields = [...root.querySelectorAll("input, select, textarea")];
    const unnamedFields = fields.filter((field) => !field.id && !field.getAttribute("name"))
      .map((field) => field.outerHTML.slice(0, 180));
    const ids = fields.map((field) => field.id).filter(Boolean);
    return {
      labels,
      unnamedFields,
      duplicateIds: ids.filter((id, index) => ids.indexOf(id) !== index),
    };
  });

  expect(await audit(pageSettings)).toEqual({ labels: [], unnamedFields: [], duplicateIds: [] });

  await page.locator('[data-tutorial="layers-panel"]').getByText("ボタン", { exact: true }).click();
  await page.locator('[data-tutorial="right-tab-settings"]').click();
  const inspector = page.locator('[data-tutorial="settings-panel"]');
  await expect(inspector).toBeVisible();
  expect(await audit(inspector)).toEqual({ labels: [], unnamedFields: [], duplicateIds: [] });

  await page.locator('[data-tutorial="left-tab-site"]').click();
  const siteSettings = page.locator('[data-tutorial="site-settings"]');
  await expect(siteSettings).toBeVisible();
  expect(await audit(siteSettings)).toEqual({ labels: [], unnamedFields: [], duplicateIds: [] });
});

test("Site and page language settings accept suggested and custom values and survive saving", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem("tsumu-help-seen-v1", "1"));
  const response = await page.request.post("/api/sites", { data: { name: "Custom languages" } });
  expect(response.ok()).toBeTruthy();
  const { site } = await response.json();
  await page.goto(`/sites/${site.id}`);
  await expect(page.getByText("サーバー保存済み")).toBeVisible();
  await page.locator('[data-tutorial="left-tab-site"]').click();

  const siteSettings = page.locator('[data-tutorial="site-basics"]');
  const siteSelect = siteSettings.getByRole("combobox", { name: "言語", exact: true });
  const siteCode = siteSettings.getByRole("textbox", { name: "カスタム言語コード" });
  const readDoc = async () => (await (await page.request.get(`/api/doc?site=${site.id}`)).json()).doc;

  await expect(siteSelect).toHaveValue("ja");
  await siteSelect.selectOption({ label: "カスタム…" });
  await siteCode.fill(" pt-BR ");
  await siteCode.press("Enter");
  await expect(siteCode).toHaveValue("pt-BR");
  await expect.poll(async () => (await readDoc()).lang).toBe("pt-BR");

  for (const invalid of ["", "en_US", "not a language", "<script>"]) {
    await siteCode.fill(invalid);
    await siteCode.press("Enter");
    await expect(siteCode).toHaveAttribute("aria-invalid", "true");
    await expect(siteSettings.getByRole("alert")).toContainText("変更は保存されていません");
    expect((await readDoc()).lang).toBe("pt-BR");
  }
  await siteCode.press("Escape");
  await expect(siteCode).toHaveValue("pt-BR");
  await expect(siteSettings.getByRole("alert")).toHaveCount(0);

  await siteSelect.selectOption("en");
  await expect(siteCode).toHaveCount(0);
  await expect.poll(async () => (await readDoc()).lang).toBe("en");
  await page.locator('[data-tutorial="undo"]').click();
  await expect(siteCode).toHaveValue("pt-BR");

  const pageSettings = page.locator('[data-tutorial="page-settings"]');
  const pageSelect = pageSettings.getByRole("combobox", { name: "言語", exact: true });
  const pageCode = pageSettings.getByRole("textbox", { name: "カスタム言語コード" });
  await expect(pageSelect).toHaveValue("");
  await expect(pageSelect.locator('option[value=""]')).toHaveText("サイトと同じ（pt-BR）");
  await pageSelect.selectOption({ label: "カスタム…" });
  await pageCode.fill("en-US");
  await pageCode.press("Enter");
  await expect.poll(async () => { const doc = await readDoc(); return doc.pages[doc.pageOrder[0]].lang; }).toBe("en-US");

  // 既存の独自の言語の値は、再読み込みした後も編集できる。
  await page.reload();
  await expect(page.getByText("サーバー保存済み")).toBeVisible();
  await page.locator('[data-tutorial="left-tab-site"]').click();
  await expect(siteCode).toHaveValue("pt-BR");
  await expect(pageCode).toHaveValue("en-US");
  await pageSelect.selectOption("");
  await expect(pageCode).toHaveCount(0);
  await expect.poll(async () => { const doc = await readDoc(); return doc.pages[doc.pageOrder[0]].lang; }).toBeUndefined();
  expect((await readDoc()).lang).toBe("pt-BR");
  expect(errors).toEqual([]);
});
});

test.describe("page-html", () => {
// 実際のハイドレーションを試すため、実際に書き出したコンポーネントを React と一緒にバンドルする。
const buildFixture = () => buildSync({
  stdin: {
    contents: `
${PAGE_HTML_COMPONENT.replace("export default function PageHtml", "function PageHtml")}
import { createElement, StrictMode, useEffect as useReadyEffect } from "react";
import { hydrateRoot } from "react-dom/client";

const htmlFor = (name) => '<script>window.recorded.push(' + JSON.stringify(name) + '); document.getElementById("marquee").textContent = "WELCOME WELCOME";<\\/script>';
const inertFor = (name) => htmlFor(name).replace("<script>", '<script data-tsumu-deferred="" type="application/x-tsumu-deferred">');
function App({ name }) {
  useReadyEffect(() => { window.ready = name; }, [name]);
  return createElement("main", null,
    createElement("span", { id: "marquee" }, "WELCOME"),
    createElement(PageHtml, { html: htmlFor(name), staticHtml: inertFor(name) }));
}
const tree = (name) => createElement(StrictMode, null, createElement(App, { name }));
const root = hydrateRoot(document.getElementById("app"), tree("a"), {
  onRecoverableError: (error) => window.hydrationErrors.push(error.message),
});
window.renderHtml = (name) => root.render(tree(name));
`,
    loader: "tsx",
    sourcefile: "page-html-browser.tsx",
    resolveDir: resolve(__dirname, ".."),
  },
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"development"' },
}).outputFiles[0].text;

test("Page-level scripts do not run twice during hydration and run on subsequent HTML changes", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  // An imported script must not modify server-rendered React text before hydration.
  await page.setContent(`
    <script>window.recorded = []; window.hydrationErrors = [];</script>
    <div id="app"><main><span id="marquee">WELCOME</span><div style="display:contents"><script data-tsumu-deferred="" type="application/x-tsumu-deferred">window.recorded.push("a"); document.getElementById("marquee").textContent = "WELCOME WELCOME";</script></div></main></div>
  `);
  expect(await page.evaluate(() => (window as any).recorded)).toEqual([]);
  expect(await page.locator("#marquee").textContent()).toBe("WELCOME");

  await page.addScriptTag({ content: buildFixture() });
  await expect.poll(() => page.evaluate(() => (window as any).ready)).toBe("a");
  await expect.poll(() => page.evaluate(() => (window as any).recorded)).toEqual(["a"]);
  expect(await page.locator("#marquee").textContent()).toBe("WELCOME WELCOME");
  // StrictMode's effect replay must not run the initial script twice.
  expect(await page.evaluate(() => (window as any).recorded)).toEqual(["a"]);

  const expected = ["a"];
  for (const name of ["b", "a", "c"]) {
    await page.evaluate((value) => (window as any).renderHtml(value), name);
    await expect.poll(() => page.evaluate(() => (window as any).ready)).toBe(name);
    expected.push(name);
    await expect.poll(() => page.evaluate(() => (window as any).recorded)).toEqual(expected);
  }
  expect(await page.evaluate(() => (window as any).hydrationErrors)).toEqual([]);
  expect(errors).toEqual([]);
});
});
