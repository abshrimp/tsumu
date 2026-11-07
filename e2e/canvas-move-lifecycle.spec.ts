import { test, expect, type Page } from "@playwright/test";
import { canvasMoveBundle, canvasMoveDoc } from "../tests/helpers/canvas-move";
import { readEditorCss } from "../tests/helpers/editor-css";
import { build } from "../tests/helpers/bundle";
import { resolve } from "node:path";
import { makeText } from "../lib/presets";
import { type DocNode, type SiteDoc } from "../lib/types";
import { aspectRatioDoc } from "../tests/helpers/aspect-ratio";

test.describe("canvas-move-lifecycle", () => {
const node = (page: Page, id: string) => page.locator(`.cv-root [data-node="${id}"]`);
const snapshot = (page: Page) => page.evaluate(() => {
  const s = (window as any).canvasMoveEditor.getState();
  return { doc: s.doc, past: s.past, future: s.future };
});
async function point(page: Page, id: string, after = false) {
  const rect = (await node(page, id).boundingBox())!;
  return { x: rect.x + rect.width / 2, y: rect.y + (after ? rect.height - 5 : 10) };
}
async function pointer(page: Page, type: string, { id = 1, buttons = 1, x, y }: { id?: number; buttons?: number; x?: number; y?: number } = {}) {
  const p = x === undefined || y === undefined ? await point(page, "c", true) : { x, y };
  await page.evaluate(({ type, id, buttons, p }) => window.dispatchEvent(new PointerEvent(type, {
    bubbles: true, pointerId: id, pointerType: "touch", button: 0, buttons, clientX: p.x, clientY: p.y,
  })), { type, id, buttons, p });
}
async function start(page: Page, id = "a") {
  const p = await point(page, id);
  await node(page, id).dispatchEvent("pointerdown", { pointerId: 1, pointerType: "touch", button: 0, buttons: 1, clientX: p.x, clientY: p.y });
  await pointer(page, "pointermove");
  await expect(node(page, id)).toHaveCSS("opacity", "0.35");
  await expect(page.locator(".move-line")).toBeVisible();
}
async function cleared(page: Page) {
  await expect(page.locator(".move-line")).toHaveCount(0);
  await expect.poll(() => page.locator(".canvas-inner > style").allTextContents()).not.toContainEqual(expect.stringContaining("cursor: grabbing"));
}
async function mouseDrag(page: Page, from: string, to: string) {
  const p = await point(page, from), q = await point(page, to, true);
  await page.mouse.move(p.x, p.y); await page.mouse.down();
  await page.mouse.move(q.x, q.y, { steps: 5 });
  await expect(node(page, from)).toHaveCSS("opacity", "0.35");
}
const order = (page: Page) => page.locator(".cv-root > [data-node]").evaluateAll((els) => els.map((el) => el.getAttribute("data-node")));

test.describe("Canvas movement fixture", () => {
  test.use({ hasTouch: true });
  let bundle: string;
  test.beforeAll(async () => { bundle = await canvasMoveBundle(); });
  test.beforeEach(async ({ page }) => {
    await page.setContent('<html><body><div id="app"></div></body></html>');
    await page.addScriptTag({ content: bundle });
    await expect(node(page, "c")).toBeVisible();
  });

  // Node covers all synthetic interruption events. Exercise keyboard and React
  // cleanup here alongside the trusted touch cancellation below.
  for (const end of ["escape", "unmount"] as const) {
    test(`${end} clears the drag and preserves document, undo, and redo through a late release`, async ({ page }) => {
      await page.evaluate(() => {
        const s = (window as any).canvasMoveEditor.getState(); s.updatePage("p", { title: "Undoable" }); s.undo();
      });
      const before = await snapshot(page);
      await start(page);
      const release = await point(page, "c", true);
      if (end === "escape") await page.keyboard.press("Escape");
      else await page.evaluate(() => (window as any).showCanvas(false));
      await cleared(page);
      await pointer(page, "pointermove", release); await pointer(page, "pointerup", { ...release, buttons: 0 });
      expect(await snapshot(page)).toEqual(before);
      if (end === "unmount") await page.evaluate(() => (window as any).showCanvas(true));
      await expect(node(page, "a")).toHaveCSS("opacity", "1");
      await start(page); await pointer(page, "pointerup", { buttons: 0 });
      await cleared(page); expect(await order(page)).toEqual(["b", "c", "a"]);
      const moved = await snapshot(page); expect(moved.past).toHaveLength(before.past.length + 1); expect(moved.future).toHaveLength(0);
      await page.evaluate(() => (window as any).canvasMoveEditor.getState().undo()); expect((await snapshot(page)).doc).toEqual(before.doc);
      await page.evaluate(() => (window as any).canvasMoveEditor.getState().redo()); expect((await snapshot(page)).doc).toEqual(moved.doc);
    });
  }

  // Keep cases that replace the displayed page, document or editing surface.
  // The Node suite checks the full store matrix for pending and active drags.
  for (const change of ["page", "remote", "replace", "mode"] as const) {
    test(`${change} invalidates the pending drop before the owner releases`, async ({ page }) => {
      await page.evaluate(() => (window as any).canvasMoveEditor.getState().updatePage("p", { title: "Changed" }));
      await start(page);
      const release = await point(page, "c", true);
      await page.evaluate((change) => {
        const s = (window as any).canvasMoveEditor.getState();
        if (change === "page") s.setActivePage("q");
        if (change === "replace") s.replaceDoc(structuredClone(s.doc));
        if (change === "remote") { const doc = structuredClone(s.doc); doc.nodes.b.name = "Remote"; s.applyRemoteDoc(doc); }
        if (change === "mode") s.setMode("preview");
      }, change);
      await cleared(page);
      const interrupted = await snapshot(page);
      await pointer(page, "pointermove", release); await pointer(page, "pointerup", { ...release, buttons: 0 });
      expect(await snapshot(page)).toEqual(interrupted);
      expect(interrupted.doc.pages.p.children).toEqual(["a", "b", "c"]);
    });
  }

  test("other pointers cannot replace, move, cancel, or commit the owner", async ({ page }) => {
    const before = await snapshot(page); await start(page);
    const line = await page.locator(".move-line").getAttribute("style");
    const p = await point(page, "b");
    await node(page, "b").dispatchEvent("pointerdown", { pointerId: 2, pointerType: "touch", button: 0, buttons: 1, clientX: p.x, clientY: p.y });
    for (const type of ["pointermove", "pointercancel", "pointerup"]) {
      await pointer(page, type, { id: 2, buttons: 0, ...p });
      await expect(node(page, "a")).toHaveCSS("opacity", "0.35");
      expect(await page.locator(".move-line").getAttribute("style")).toBe(line); expect(await snapshot(page)).toEqual(before);
    }
    await pointer(page, "pointerup", { buttons: 0 });
    await cleared(page); expect(await order(page)).toEqual(["b", "c", "a"]);
    expect((await snapshot(page)).past).toHaveLength(1);
  });

  for (const multiple of [false, true]) test(`real mouse ${multiple ? "multiple" : "single"} movement remains one reversible edit from hover style`, async ({ page }) => {
    await page.evaluate((multiple) => {
      const s = (window as any).canvasMoveEditor.getState();
      if (multiple) s.selectMany(["a", "b"], "a"); else s.select("b");
      s.setStyleState("hover");
    }, multiple);
    const before = await snapshot(page);
    await mouseDrag(page, "a", "c"); await page.mouse.up(); await cleared(page);
    expect(await order(page)).toEqual(multiple ? ["c", "a", "b"] : ["b", "c", "a"]);
    const moved = await snapshot(page); expect(moved.past).toHaveLength(1);
    await page.evaluate(() => (window as any).canvasMoveEditor.getState().undo()); expect((await snapshot(page)).doc).toEqual(before.doc);
    await page.evaluate(() => (window as any).canvasMoveEditor.getState().redo()); expect((await snapshot(page)).doc).toEqual(moved.doc);
  });

  test("a browser-generated touch cancellation removes the drag before a late release", async ({ page }) => {
    const before = await snapshot(page);
    const p = await point(page, "a");
    const touch = await page.context().newCDPSession(page);
    await page.evaluate(() => {
      (window as any).touchCancels = [];
      window.addEventListener("pointercancel", (e) => (window as any).touchCancels.push({ trusted: e.isTrusted, id: e.pointerId }));
    });
    await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: p.x, y: p.y, id: 7 }] });
    await touch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: p.x + 8, y: p.y, id: 7 }] });
    await expect(node(page, "a")).toHaveCSS("opacity", "0.35");
    await touch.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
    await cleared(page);
    const cancelled = await page.evaluate(() => (window as any).touchCancels);
    expect(cancelled).toHaveLength(1); expect(cancelled[0].trusted).toBe(true);
    await pointer(page, "pointerup", { id: cancelled[0].id, buttons: 0 });
    expect(await snapshot(page)).toEqual(before);
    await mouseDrag(page, "a", "c"); await page.mouse.up();
    expect(await order(page)).toEqual(["b", "c", "a"]); expect((await snapshot(page)).past).toHaveLength(1);
  });

  test("selected overlay follows a flow-layout shift without an idle frame polling loop", async ({ page }) => {
    await page.evaluate(() => (window as any).canvasMoveEditor.getState().select("c"));
    const overlay = page.locator(".sel-overlay");
    await expect(overlay).toBeVisible();
    const original = await overlay.boundingBox();
    expect(original).not.toBeNull();

    // 前の兄弟を変えると、"c" 自身は変えずに "c" が動く。
    await page.evaluate(() =>
      (window as any).canvasMoveEditor.getState().setStyleProps("a", { height: "250px" })
    );
    await expect.poll(async () => (await overlay.boundingBox())?.y ?? 0)
      .toBeGreaterThan(original!.y + 80);

    // 大きさを直接変えた場合も、ResizeObserver が選択の表示を正確に保つ。
    await page.evaluate(() =>
      (window as any).canvasMoveEditor.getState().setStyleProps("c", { height: "210px" })
    );
    await expect.poll(async () => (await overlay.boundingBox())?.height ?? 0)
      .toBeGreaterThan(original!.height + 80);
  });
});

test("the real Editor Ctrl+Z during a mouse drag cannot be overwritten by releasing it", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem("tsumu-help-seen-v1", "1"));
  const created = await page.request.post("/api/sites", { data: { name: "Canvas undo lifecycle" } });
  expect(created.ok()).toBeTruthy();
  const { site } = await created.json();
  expect((await page.request.put(`/api/doc?site=${site.id}`, { data: canvasMoveDoc() })).ok()).toBeTruthy();
  await page.goto(`/sites/${site.id}`);
  await expect(node(page, "c")).toBeVisible();
  await expect(page.locator('[data-tutorial="save-status"]')).toContainText("サーバー保存済み");
  await mouseDrag(page, "a", "c"); await page.mouse.up();
  expect(await order(page)).toEqual(["b", "c", "a"]);
  await mouseDrag(page, "b", "a");
  await page.keyboard.press("ControlOrMeta+z"); await cleared(page);
  expect(await order(page)).toEqual(["a", "b", "c"]);
  await page.mouse.up(); await cleared(page);
  expect(await order(page)).toEqual(["a", "b", "c"]);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  expect(await order(page)).toEqual(["b", "c", "a"]);
  await page.keyboard.press("ControlOrMeta+z");
  expect(await order(page)).toEqual(["a", "b", "c"]);
  expect(errors).toEqual([]);
});
});

test.describe("canvas-preview-lifecycle", () => {
const node = (id: string): DocNode => ({
  ...makeText(id), id, attrId: id,
  scripts: [{ id: `${id}-click`, trigger: "click", steps: [
    { id: `${id}-state`, kind: "set-state", target: id, state: "clicked" },
  ] }],
});
const doc: SiteDoc = {
  schemaVersion: 1, siteName: "Canvas preview visits", assets: {},
  nodes: { a: node("a"), b: node("b"), delay: {
    ...makeText("Delayed navigation"), id: "delay", scripts: [{
      id: "delayed", trigger: "click", steps: [
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
    pageScripts: [{ id: `${id}-load`, trigger: "load", steps: [
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
const css = ${JSON.stringify(readEditorCss())};
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

test.describe("preview lifecycle", () => {
  test.beforeEach(async ({ page }) => {
    // この準備は、翻訳した UI を読み込み、クッキーを書く。そのため、中身の見えない about:blank の
    // ページではなく、HTTP のオリジンを使う。robots.txt なら、競合するアプリのスクリプトが無い。
    await page.goto("/robots.txt");
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
    // 取り付ける表示用のフレームが無い間にも、プレビューに入る。
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
});

test.describe("layers-virtualization", () => {
async function layersBundle() {
  const doc = canvasMoveDoc();
  const source = doc.nodes.a;
  const ids = Array.from({ length: 1200 }, (_, i) => `node_${i}`);
  doc.nodes = Object.fromEntries(ids.map((id, i) => [
    id, { ...source, id, name: `Element ${i}`, children: [] },
  ]));
  doc.pages.p.children = ids;
  return (await build({
    stdin: {
      contents: `
import React from "react";
import { createRoot } from "react-dom/client";
import { LayersTab } from "./components/left-panel/LayersTab";
import { useEditor } from "./lib/store";
const css = ${JSON.stringify(readEditorCss())};
const style = document.createElement("style");
style.textContent = css;
document.head.append(style);
useEditor.getState().replaceDoc(${JSON.stringify(doc)});
useEditor.getState().setActivePage("p");
window.layersEditor = useEditor;
createRoot(document.getElementById("app")).render(
  <React.StrictMode><LayersTab /></React.StrictMode>
);
`,
      loader: "tsx",
      sourcefile: "layers-perf-browser.tsx",
      resolveDir: resolve("."),
    },
    loader: { ".css": "text" },
    bundle: true, write: false, format: "iife", platform: "browser",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
  })).outputFiles[0].text;
}

test.describe("large hierarchy layers", () => {
  let bundle: string;
  test.beforeAll(async () => { bundle = await layersBundle(); });
  test.beforeEach(async ({ page }) => {
    await page.setContent('<html><body><div id="app" style="height: 420px; width: 320px; display: flex; flex-direction: column"></div></body></html>');
    await page.addScriptTag({ content: bundle });
    await expect(page.locator('.layer-row[data-layer="node_0"]')).toBeVisible();
  });

  test("renders only a viewport-sized number of rows and reveals a distant selection", async ({ page }) => {
    await expect.poll(() => page.locator(".layer-row[data-layer]").count()).toBeLessThan(80);
    await page.evaluate(() => (window as any).layersEditor.getState().select("node_1100"));
    await expect(page.locator('.layer-row[data-layer="node_1100"]')).toBeVisible();
    await expect.poll(() => page.locator(".layer-row[data-layer]").count()).toBeLessThan(80);
  });

  test("shift range selection includes rows outside the mounted viewport", async ({ page }) => {
    await page.evaluate(() => (window as any).layersEditor.getState().select("node_100"));
    await expect(page.locator('.layer-row[data-layer="node_100"]')).toBeVisible();
    await page.locator(".panel-body").evaluate((el) => { el.scrollTop = 900 * 28; });
    const target = page.locator('.layer-row[data-layer="node_900"]');
    await expect(target).toBeVisible();
    await target.click({ modifiers: ["Shift"] });
    const selected = await page.evaluate(() => (window as any).layersEditor.getState().selectedIds as string[]);
    expect(selected).toHaveLength(801);
    expect(selected[0]).toBe("node_100");
    expect(selected.at(-1)).toBe("node_900");
  });
});
});

test.describe("aspect-ratio-collab", () => {
test("Removing a breakpoint in another editor does not let an in-progress aspect ratio overwrite shared styles", async ({ page: a, browser }, testInfo) => {
  const other = await browser.newContext({
    baseURL: String(testInfo.project.use.baseURL), locale: "ja-JP", viewport: { width: 1440, height: 900 },
  });
  try {
    await a.addInitScript(() => localStorage.setItem("tsumu-help-seen-v1", "1"));
    const created = await a.request.post("/api/sites", { data: { name: "Aspect-ratio collaboration" } });
    expect(created.ok()).toBeTruthy();
    const { site } = await created.json();
    const api = `/api/doc?site=${site.id}`;
    const initial = await (await a.request.get(api)).json();
    const fixture = aspectRatioDoc();
    const seeded = await a.request.put(`${api}${initial.rev ? `&base=${initial.rev}` : ""}`, { data: fixture });
    expect(seeded.ok()).toBeTruthy();
    const events = a.waitForRequest((request) => request.url().includes("/api/collab/events"));
    await a.goto(`/sites/${site.id}`);
    await expect(a.getByText("サーバー保存済み")).toBeVisible();
    await events;
    await a.locator('[data-tutorial="layers-panel"] .layer-name').filter({ hasText: /^a$/ }).click();
    await a.locator('[data-tutorial="breakpoint-sm"]').click();
    await a.locator('[data-tip="最小・最大サイズと縦横比"]').click();
    const ratio = a.locator('input[placeholder="例: 16 / 9"]');
    await expect(ratio).toHaveValue("16 / 9");

    const b = await other.newPage();
    await b.addInitScript(() => localStorage.setItem("tsumu-help-seen-v1", "1"));
    await b.goto(`/sites/${site.id}`);
    await expect(b.getByText("サーバー保存済み")).toBeVisible();
    await b.locator('[data-tutorial="left-tab-site"]').click();
    const remove = b.getByRole("button", { name: "スマホを削除", exact: true });
    await expect(remove).toBeVisible();
    await ratio.fill("4 / 3");
    await ratio.evaluate((input) => { (window as any).previousRatioInput = input; });
    await remove.click();
    await expect(b.getByText("サーバー保存済み")).toBeVisible();
    await expect(a.locator('[data-tutorial="breakpoint-sm"]')).toHaveCount(0, { timeout: 20_000 });
    await expect(ratio).toHaveValue("16 / 9");
    expect(await a.evaluate(() => (window as any).previousRatioInput.isConnected)).toBe(false);
    await ratio.focus();
    await a.keyboard.press("Enter");
    const canvas = a.locator('.cv-root [data-node="a"]');
    await expect(canvas).toHaveCSS("aspect-ratio", "16 / 9");
    // API が保存したノードのスタイルは、すべてブレークポイントを削除する前の値と同じまま。
    expect((await (await a.request.get(api)).json()).doc.nodes).toEqual(fixture.nodes);

    await ratio.fill("3 / 2");
    await a.keyboard.press("Enter");
    await expect(canvas).toHaveCSS("aspect-ratio", "3 / 2");
    await expect.poll(async () => (await (await a.request.get(api)).json()).doc.nodes.a.styles.base.default.aspectRatio).toBe("3 / 2");
    await a.getByRole("button", { name: "元に戻す", exact: true }).click();
    await expect(ratio).toHaveValue("16 / 9");
    await expect(canvas).toHaveCSS("aspect-ratio", "16 / 9");
    await expect.poll(async () => (await (await a.request.get(api)).json()).doc.nodes.a.styles.base.default.aspectRatio).toBe("16 / 9");
    await a.getByRole("button", { name: "やり直す", exact: true }).click();
    await expect(ratio).toHaveValue("3 / 2");
    await expect(canvas).toHaveCSS("aspect-ratio", "3 / 2");
    await expect.poll(async () => (await (await a.request.get(api)).json()).doc.nodes.a.styles.base.default.aspectRatio).toBe("3 / 2");
    expect((await (await a.request.get(api)).json()).doc.nodes.b).toEqual(fixture.nodes.b);
  } finally {
    await other.close();
  }
});
});
