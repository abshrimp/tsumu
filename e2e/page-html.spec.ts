import { expect, test } from "@playwright/test";
import { buildSync } from "esbuild";
import { resolve } from "node:path";
import { PAGE_HTML_COMPONENT } from "../lib/generator/templates";

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
