import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import { resolve } from "node:path";

test("editing the switch thumb shadow preserves its geometry and supports undo", async ({ page }) => {
  await page.route("http://shadow-control.test/", route => route.fulfill({ contentType: "text/html", body: '<div id="app"></div>' }));
  await page.goto("http://shadow-control.test/");
  const bundle = await build({
    stdin: { contents: `
      import React from "react";
      import { createRoot } from "react-dom/client";
      import StylePanel from "./components/StylePanel";
      import { makeSwitch, createInitialDoc } from "./lib/presets";
      import { useEditor } from "./lib/store";
      const preset = makeSwitch();
      const thumb = Object.values(preset.nodes).find(n => n.styles.base?.default?.boxShadow);
      const doc = createInitialDoc(); doc.nodes = { [thumb.id]: thumb };
      doc.pages[doc.pageOrder[0]].children = [thumb.id];
      useEditor.getState().replaceDoc(doc); useEditor.getState().select(thumb.id);
      window.shadowEditor = useEditor; window.thumbId = thumb.id;
      createRoot(document.getElementById("app")).render(<StylePanel nodeId={thumb.id} />);
    `, resolveDir: resolve("."), loader: "tsx" },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
  });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const geometry = page.locator(".fx-card .grid4 input");
  for (const [i, value] of ["0", "1", "2", "0"].entries()) await expect(geometry.nth(i)).toHaveValue(value);
  const color = page.locator(".fx-card .fill-main input");
  await color.fill("123456"); await color.blur();
  const shadow = () => page.evaluate(() => (window as any).shadowEditor.getState().doc.nodes[(window as any).thumbId].styles.base.default.boxShadow);
  await expect.poll(shadow).toBe("0px 1px 2px 0px rgba(18, 52, 86, 0.25)");
  await page.evaluate(() => (window as any).shadowEditor.getState().undo());
  await expect.poll(shadow).toBe("0 1px 2px rgba(0, 0, 0, 0.25)");
});
