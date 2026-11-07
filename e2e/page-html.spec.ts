import { expect, test } from "@playwright/test";
import { buildSync } from "esbuild";
import { resolve } from "node:path";
import { PAGE_HTML_COMPONENT } from "../lib/generator/templates";

// Bundle the actual exported component with React to test real hydration.
const bundle = buildSync({
  stdin: {
    contents: `
${PAGE_HTML_COMPONENT.replace("export default function PageHtml", "function PageHtml")}
import { createElement, StrictMode, useEffect as useReadyEffect } from "react";
import { hydrateRoot } from "react-dom/client";

const htmlFor = (name) => '<script>window.recorded.push(' + JSON.stringify(name) + ')<\\/script>';
function App({ name }) {
  useReadyEffect(() => { window.ready = name; }, [name]);
  return createElement(PageHtml, { html: htmlFor(name) });
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
  // Like server-delivered HTML, the initial script runs while the page is loading.
  await page.setContent(`
    <script>window.recorded = []; window.hydrationErrors = [];</script>
    <div id="app"><div style="display:contents"><script>window.recorded.push("a")</script></div></div>
  `);
  expect(await page.evaluate(() => (window as any).recorded)).toEqual(["a"]);
  await page.addScriptTag({ content: bundle });
  await expect.poll(() => page.evaluate(() => (window as any).ready)).toBe("a");
  // StrictMode may rerun the initial effect but must not rerun already-executed HTML scripts.
  expect(await page.evaluate(() => (window as any).recorded)).toEqual(["a"]);

  const expected = ["a"];
  for (const name of ["b", "a", "c"]) {
    await page.evaluate((value) => (window as any).renderHtml(value), name);
    await expect.poll(() => page.evaluate(() => (window as any).ready)).toBe(name);
    expected.push(name);
    expect(await page.evaluate(() => (window as any).recorded)).toEqual(expected);
  }
  expect(await page.evaluate(() => (window as any).hydrationErrors)).toEqual([]);
  expect(errors).toEqual([]);
});
