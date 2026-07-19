import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import { resolve } from "node:path";

for (const color of ["#1234", "#12345678"]) test(`opacity-only edit preserves ${color} RGB`, async ({ page }) => {
  await page.route("http://color-control.test/", route => route.fulfill({ contentType: "text/html", body: '<div id="app"></div>' }));
  await page.goto("http://color-control.test/");
  const bundle = await build({
    stdin: { contents: `
      import React, { useState } from "react";
      import { createRoot } from "react-dom/client";
      import { FillControl } from "./components/controls";
      function Fixture() {
        const [value, setValue] = useState(${JSON.stringify(color)});
        return <><FillControl value={value} onChange={setValue} /><output>{value}</output></>;
      }
      createRoot(document.getElementById("app")).render(<Fixture />);
    `, resolveDir: resolve("."), loader: "tsx" },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
  });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const hex = page.locator(".fill-main input");
  await expect(hex).toHaveValue(color.length === 5 ? "112233" : "123456");
  await hex.focus(); await hex.blur();
  await expect(page.locator("output")).toHaveText(color);
  const opacity = page.locator(".fill-alpha input");
  await opacity.fill("50"); await opacity.blur();
  await expect(page.locator("output")).toHaveText(color.length === 5 ? "rgba(17, 34, 51, 0.5)" : "rgba(18, 52, 86, 0.5)");
});
