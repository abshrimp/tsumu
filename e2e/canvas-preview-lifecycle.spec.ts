import { expect, test, type Page } from "@playwright/test";
import { build } from "esbuild";
import { resolve } from "node:path";
import { makeText } from "../lib/presets";
import type { DocNode, SiteDoc } from "../lib/types";

const node = (id: string): DocNode => ({
  ...makeText(id), id, attrId: id,
  scripts: [{ id: `${id}-click`, trigger: "click", pos: { x: 0, y: 0 }, steps: [
    { id: `${id}-state`, kind: "set-state", target: id, state: "clicked" },
  ] }],
});
const doc: SiteDoc = {
  schemaVersion: 1, siteName: "Canvas preview visits", assets: {},
  nodes: { a: node("a"), b: node("b"), delay: {
    ...makeText("Delayed navigation"), id: "delay", scripts: [{
      id: "delayed", trigger: "click", pos: { x: 0, y: 0 }, steps: [
        { id: "wait", kind: "wait", seconds: 1 },
        { id: "navigate", kind: "open-page", pageId: "html" },
      ],
    }],
  } },
  pageOrder: ["a", "b", "html", "redirect", "rewrite"],
  pages: Object.fromEntries(["a", "b", "html", "redirect", "rewrite"].map(id => [id, {
    id, name: id, slug: id, title: "", description: "", children: id === "a" ? ["a", "delay"] : id === "b" ? ["b"] : [],
    ...(id === "html" ? { rawHtml: "<p>HTML</p>" } : {}),
    ...(id === "redirect" ? { redirectTo: "/a" } : {}),
    ...(id === "rewrite" ? { rewriteTo: "https://example.test/" } : {}),
    pageScripts: [{ id: `${id}-load`, trigger: "load", pos: { x: 0, y: 0 }, steps: [
      { id: `${id}-loaded`, kind: "set-state", target: id, state: "loaded" },
    ] }],
  }])),
};

let bundle: string;
test.beforeAll(async () => {
  bundle = (await build({
    stdin: {
      contents: `
import React from "react";
import { createRoot } from "react-dom/client";
import Canvas from "./components/Canvas";
import { useEditor } from "./lib/store";
import { loadLocale } from "./lib/i18n";
import css from "./app/globals.css";
const style = document.createElement("style"); style.textContent = css; document.head.append(style);
useEditor.getState().replaceDoc(${JSON.stringify(doc)});
useEditor.getState().setActivePage("a");
useEditor.getState().setCustomWidth(600);
useEditor.getState().setZoom(1);
useEditor.getState().setMode("preview");
window.previewEditor = useEditor;
loadLocale().then(() => createRoot(document.getElementById("app")).render(<React.StrictMode><Canvas /></React.StrictMode>));
`, sourcefile: "canvas-preview-fixture.tsx", resolveDir: resolve("."), loader: "tsx",
    },
    loader: { ".css": "text" }, bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
  })).outputFiles[0].text;
});

async function openPage(page: Page, id: string) {
  await page.evaluate(id => (window as any).previewEditor.getState().setActivePage(id), id);
}
const signal = (page: Page, id: string) => page.locator(`.cv-root [data-node="${id}"]`);

for (const locale of ["ja-JP", "en-US"]) test.describe(`preview lifecycle (${locale})`, () => {
  test.use({ locale });
  test.beforeEach(async ({ page }) => {
    await page.setContent('<html><body><div id="app"></div></body></html>');
    await page.addScriptTag({ content: bundle });
    await expect(signal(page, "a")).toHaveAttribute("data-site-state", "loaded");
  });

  test("each page visit runs load scripts and retains click handlers", async ({ page }) => {
    for (const id of ["b", "a"]) {
      await openPage(page, id);
      await expect(signal(page, id)).toHaveAttribute("data-site-state", "loaded");
      await signal(page, id).click();
      await expect(signal(page, id)).toHaveAttribute("data-site-state", "clicked");
    }
  });

  for (const special of ["html", "redirect", "rewrite"]) test(`scripts survive ${special} frame replacement`, async ({ page }) => {
    await openPage(page, special);
    await expect(page.locator(".cv-root")).toHaveCount(0);
    // Also enter preview while there is no visual frame to attach to.
    await page.evaluate(() => (window as any).previewEditor.getState().setMode("design"));
    await page.evaluate(() => (window as any).previewEditor.getState().setMode("preview"));
    await openPage(page, "a");
    await expect(signal(page, "a")).toHaveAttribute("data-site-state", "loaded");
    await signal(page, "a").click();
    await expect(signal(page, "a")).toHaveAttribute("data-site-state", "clicked");
  });

  test("a departed page's delayed script cannot navigate the current page", async ({ page }) => {
    await page.clock.install();
    await signal(page, "delay").click();
    await openPage(page, "b");
    await page.clock.runFor(1500);
    expect(await page.evaluate(() => (window as any).previewEditor.getState().activePageId)).toBe("b");
    await expect(signal(page, "b")).toBeVisible();
  });

  test("same-page updates do not replay load; page-kind undo restores scripts", async ({ page }) => {
    await signal(page, "a").click();
    await page.evaluate(() => {
      const s = (window as any).previewEditor.getState();
      s.updatePage("a", { title: "New title" }); s.setBreakpoint("sm");
    });
    await expect(signal(page, "a")).toHaveAttribute("data-site-state", "clicked");
    await page.evaluate(() => (window as any).previewEditor.getState().updatePage("a", { rawHtml: "<p>HTML</p>" }));
    await expect(page.locator(".cv-root")).toHaveCount(0);
    await page.evaluate(() => (window as any).previewEditor.getState().undo());
    await expect(signal(page, "a")).toHaveAttribute("data-site-state", "loaded");
  });
});
