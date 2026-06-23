import { expect, test } from "@playwright/test";
import { buildSync } from "esbuild";
import { resolve } from "node:path";
import { PAGE_HTML_COMPONENT } from "../lib/generator/templates";

// 書き出すコンポーネントそのものと React を束ね、実際のハイドレーションを確かめる。
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

test("ページ専用スクリプトはハイドレーションで重複せず、その後の HTML 変更では動く", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  // サーバーから届いた HTML と同じく、最初のスクリプトは HTML の読み込み中に動く。
  await page.setContent(`
    <script>window.recorded = []; window.hydrationErrors = [];</script>
    <div id="app"><div style="display:contents"><script>window.recorded.push("a")</script></div></div>
  `);
  expect(await page.evaluate(() => (window as any).recorded)).toEqual(["a"]);
  await page.addScriptTag({ content: bundle });
  await expect.poll(() => page.evaluate(() => (window as any).ready)).toBe("a");
  // StrictMode が初回の effect を再実行しても、ブラウザが実行済みの HTML は動かさない。
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
