import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import { resolve } from "node:path";
import { parseColor } from "../components/controls";

let compiledColorBundle: Promise<string> | undefined;

async function colorControlBundle(initialColor: string) {
  compiledColorBundle ??= build({
    stdin: { contents: `
      import React, { useState } from "react";
      import { createRoot } from "react-dom/client";
      import { FillControl } from "./components/controls";
      function Fixture() {
        const [value, setValue] = useState(window.__initialColor);
        return <><FillControl value={value} onChange={setValue} /><output>{value}</output></>;
      }
      createRoot(document.getElementById("app")).render(<Fixture />);
    `, resolveDir: resolve("."), loader: "tsx" },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
  }).then(result => result.outputFiles[0].text);
  return `window.__initialColor = ${JSON.stringify(initialColor)};\n` + await compiledColorBundle;
}

for (const color of ["#1234", "#12345678"]) test(`opacity-only edit preserves ${color} RGB`, async ({ page }) => {
  await page.route("http://color-control.test/", route => route.fulfill({ contentType: "text/html", body: '<div id="app"></div>' }));
  await page.goto("http://color-control.test/");
  await page.addScriptTag({ content: await colorControlBundle(color) });
  const hex = page.locator(".fill-main input");
  await expect(hex).toHaveValue(color.length === 5 ? "112233" : "123456");
  await hex.focus(); await hex.blur();
  await expect(page.locator("output")).toHaveText(color);
  const opacity = page.locator(".fill-alpha input");
  await opacity.fill("50"); await opacity.blur();
  await expect(page.locator("output")).toHaveText(color.length === 5 ? "rgba(17, 34, 51, 0.5)" : "rgba(18, 52, 86, 0.5)");
});

for (const [value, hex, alpha] of [
  ["red", "#ff0000", 1],
  ["hsl(120 100% 50% / 0.5)", "#00ff00", 0.5],
] as const) {
  test(`color picker preserves native CSS color ${value}`, async ({ page }) => {
    expect(await page.evaluate(parseColor, value)).toEqual({ hex, alpha });
  });
}
