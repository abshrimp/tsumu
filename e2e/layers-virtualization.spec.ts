import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import { resolve } from "node:path";
import { canvasMoveDoc } from "../tests/helpers/canvas-move";

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
import css from "./app/globals.css";
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
