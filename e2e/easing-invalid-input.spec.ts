import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import { resolve } from "node:path";

const bundle = build({
  stdin: {
    contents: `
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { loadLocale } from "./lib/i18n";
void loadLocale().then(async () => {
const { EasingCurve, EasingEditorModal } = await import("./components/MotionEditors");
function Fixture() {
  const [value, setValue] = useState("ease");
  const [open, setOpen] = useState(true);
  return <>
    <EasingCurve value={value} />
    <output id="saved">{value}</output>
    <button id="reopen" onClick={() => setOpen(true)}>Open easing</button>
    {open && <EasingEditorModal value={value} duration={1} onClose={() => setOpen(false)}
      onApply={(next) => { setValue(next); setOpen(false); }} />}
  </>;
}
createRoot(document.getElementById("app")).render(<Fixture />);
});`,
    resolveDir: resolve("."), loader: "tsx", sourcefile: "easing-input-fixture.tsx",
  },
  bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
  define: { "process.env.NODE_ENV": '"development"' },
}).then(result => result.outputFiles[0].text);

for (const value of ["constructor", "__proto__", "steps(3, jump-end, ignored)"]) {
  test(`raw easing ${value} survives apply and reopening without errors`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.setContent('<div id="app"></div>');
    await page.addStyleTag({ path: "app/globals.css" });
    await page.addScriptTag({ content: await bundle });
    const input = page.locator('.ee-modal input.mono');
    await input.fill(value);
    await input.press("Tab");
    await expect(page.getByText("グラフで表せない値です。この値のまま使えます。", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "適用", exact: true }).click();
    await expect(page.locator("#saved")).toHaveText(value);
    await page.locator("#reopen").click();
    await expect(input).toHaveValue(value);
    await input.fill("ease-out");
    await input.press("Tab");
    await page.getByRole("button", { name: "適用", exact: true }).click();
    await expect(page.locator("#saved")).toHaveText("ease-out");
    expect(errors).toEqual([]);
  });
}
