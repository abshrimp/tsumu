import { expect, test } from "@playwright/test";
import { createInitialDoc } from "../lib/presets";
import JSZip from "jszip";
import { readFile } from "node:fs/promises";

async function openExport(page: import("@playwright/test").Page) {
  await page.addInitScript(() => localStorage.setItem("tsumu-help-seen-v1", "1"));
  const result = await page.request.post("/api/sites", { data: { name: "Export UI" } });
  expect(result.ok()).toBeTruthy();
  const { site } = await result.json();
  const doc = createInitialDoc();
  doc.siteName = "Export UI";
  // The starter site has a dynamic route unsupported by non-Next.js formats.
  // Hide it only in this download-focused fixture; keep the restriction intact.
  for (const item of Object.values(doc.pages)) {
    if (/\[[^\]]+\]/.test(item.slug)) item.unpublished = true;
  }
  expect((await page.request.put("/api/doc?site=" + site.id, { data: doc })).ok()).toBeTruthy();
  await page.goto("/sites/" + site.id);
  await expect(page.locator('[data-tutorial="canvas"]').getByText("見出しをここに").first()).toBeVisible();
  await page.getByRole("button", { name: "メニュー（書き出し・履歴・設定）" }).click();
  await page.getByRole("button", { name: "zipでエクスポート" }).click();
  const modal = page.locator(".export-modal");
  await expect(modal).toBeVisible();
  return modal;
}

test("export options use Tsumu controls and descriptions reflect the framework", async ({ page }) => {
  const modal = await openExport(page);
  await expect(modal.locator("select#export-format")).toHaveCount(0);
  await expect(modal.getByText("フレームワーク", { exact: true })).toBeVisible();
  await expect(modal.getByText("言語", { exact: true })).toBeVisible();
  await expect(modal.getByText("スタイル", { exact: true })).toBeVisible();
  await expect(modal.getByText("出力範囲", { exact: true })).toBeVisible();
  await expect(modal.locator(".modal-desc")).toContainText("npm run dev");

  await modal.getByRole("button", { name: "フレームワーク" }).click();
  await page.getByRole("button", { name: "HTML / CSS / JavaScript" }).click();
  await expect(modal.locator(".modal-desc")).toContainText("index.html");
  await expect(modal.locator(".modal-desc")).not.toContainText("npm run build");
  await expect(modal.locator(".modal-desc .kbd")).toHaveCount(0);
  await expect(modal.getByRole("button", { name: "言語" })).toContainText("JavaScript");
  await expect(modal.getByRole("button", { name: "スタイル" })).toContainText("CSS");
  await expect(modal.getByRole("button", { name: "出力範囲" })).toContainText("プロジェクト全体");

  await modal.getByRole("button", { name: "出力範囲" }).click();
  await page.getByRole("button", { name: "選択したコンポーネント" }).click();
  await expect(modal.locator(".check-list li.is-error")).toContainText(["書き出すコンポーネントを選択してください。"]);
  await expect(modal.locator(".check-ok")).toHaveCount(0);
  await expect(modal.getByRole("button", { name: "zipをダウンロード" })).toBeDisabled();
});

test("export settings use a compact grid and stack on narrow screens", async ({ page }) => {
  const modal = await openExport(page);
  const grid = modal.locator(".export-option-grid");
  await expect(grid).toHaveCSS("display", "grid");
  await expect(grid).toHaveCSS("grid-template-columns", /\\d+px \\d+px/);
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(grid).toHaveCSS("grid-template-columns", /\\d+px/);
  const columns = await grid.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length);
  expect(columns).toBe(1);
  const overflow = await modal.evaluate((element) => element.scrollWidth > element.clientWidth);
  expect(overflow).toBe(false);
});

test("compatibility errors never appear alongside the success check", async ({ page }) => {
  const modal = await openExport(page);
  await modal.getByRole("button", { name: "フレームワーク" }).click();
  await page.getByRole("button", { name: "React + Vite" }).click();
  await modal.getByRole("button", { name: "出力範囲" }).click();
  await page.getByRole("button", { name: "現在のページ" }).click();
  // A compatible page may show warnings; switching to a selection with no
  // selected node must always show the failure and never a positive check.
  await modal.getByRole("button", { name: "出力範囲" }).click();
  await page.getByRole("button", { name: "選択したコンポーネント" }).click();
  await expect(modal.locator(".check-list li.is-error")).toHaveCount(1);
  await expect(modal.locator(".check-ok")).toHaveCount(0);
});


test("JavaScript export downloads an actual JSX ZIP through the browser", async ({ page }) => {
  const modal = await openExport(page);
  await modal.getByRole("button", { name: "フレームワーク" }).click();
  await page.getByRole("button", { name: "React + Vite" }).click();
  await modal.getByRole("button", { name: "言語" }).click();
  await page.getByRole("button", { name: "JavaScript", exact: true }).click();
  const downloadButton = modal.getByRole("button", { name: "zipをダウンロード" });
  await expect(downloadButton).toBeEnabled();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    downloadButton.click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/react-javascript\.zip$/);
  const zipPath = await download.path();
  expect(zipPath).not.toBeNull();
  const zip = await JSZip.loadAsync(await readFile(zipPath!));
  const paths = Object.keys(zip.files);
  expect(paths.some((p) => p.endsWith("/src/App.jsx"))).toBe(true);
  expect(paths.some((p) => p.endsWith("/src/App.tsx"))).toBe(false);
  expect(paths.some((p) => p.endsWith("/jsconfig.json"))).toBe(true);
});

test("native HTML export downloads ready-to-open HTML, CSS and JavaScript without package tooling", async ({ page }) => {
  const modal = await openExport(page);
  await expect(modal.locator(".modal-desc .kbd")).toContainText("npm install && npm run dev");
  await modal.getByRole("button", { name: "フレームワーク" }).click();
  await page.getByRole("button", { name: "HTML / CSS / JavaScript" }).click();
  await expect(modal.locator(".modal-desc")).toContainText("index.html");
  await expect(modal.locator(".modal-desc .kbd")).toHaveCount(0);
  const downloadButton = modal.getByRole("button", { name: "zipをダウンロード" });
  await expect(downloadButton).toBeEnabled();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    downloadButton.click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/html-javascript\.zip$/);
  const zipPath = await download.path();
  expect(zipPath).not.toBeNull();
  const zip = await JSZip.loadAsync(await readFile(zipPath!));
  const names = Object.keys(zip.files);
  const index = names.find((p) => p.endsWith("/index.html"));
  expect(index).toBeTruthy();
  const html = await zip.file(index!)!.async("text");
  expect(html).toContain("<!doctype html>");
  expect(html).toContain("styles/site.css");
  expect(names.some((p) => p.endsWith("/styles/site.css"))).toBe(true);
  expect(names.some((p) => p.endsWith("/package.json"))).toBe(false);
  expect(names.some((p) => p.endsWith("/next.config.mjs"))).toBe(false);
});

test("single HTML format downloads an actual HTML file with inline CSS and scripts", async ({ page }) => {
  const modal = await openExport(page);
  await modal.getByRole("button", { name: "フレームワーク" }).click();
  await page.getByRole("button", { name: "単一のHTML" }).click();
  await modal.getByRole("button", { name: "出力範囲" }).click();
  await expect(page.getByRole("button", { name: "プロジェクト全体", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "現在のページ" }).click();
  await modal.getByRole("button", { name: "出力範囲" }).click();
  await page.getByRole("button", { name: "現在のページ" }).click();
  await expect(modal.locator(".modal-desc")).toContainText("HTMLファイル");
  await expect(modal.getByRole("button", { name: "言語" })).toContainText("JavaScript");
  await expect(modal.getByRole("button", { name: "スタイル" })).toContainText("CSS");
  const downloadButton = modal.getByRole("button", { name: "HTMLをダウンロード" });
  await expect(downloadButton).toBeEnabled();
  const [download] = await Promise.all([page.waitForEvent("download"), downloadButton.click()]);
  expect(download.suggestedFilename()).toMatch(/\.html$/);
  const html = await readFile((await download.path())!, "utf8");
  expect(html).toContain("<!doctype html>");
  expect(html).toContain("<style>");
  expect(html).toContain("data-page-plan");
  expect(html).not.toMatch(/<script[^>]*\bsrc=["'](?!data:)/);
  expect(html).not.toMatch(/<link[^>]*rel="stylesheet"/);
  // Internal data markers may contain the product name. External scripts and CSS must not remain.
});

test("Vue project format downloads the actual Vue SFC and Vite config", async ({ page }) => {
  const modal = await openExport(page);
  await modal.getByRole("button", { name: "フレームワーク" }).click();
  await page.getByRole("button", { name: "Vue 3 + Vite" }).click();
  await modal.getByRole("button", { name: "出力範囲" }).click();
  await page.getByRole("button", { name: "現在のページ" }).click();
  const downloadButton = modal.getByRole("button", { name: "zipをダウンロード" });
  await expect(downloadButton).toBeEnabled();
  const [download] = await Promise.all([page.waitForEvent("download"), downloadButton.click()]);
  const zip = await JSZip.loadAsync(await readFile((await download.path())!));
  const names = Object.keys(zip.files);
  expect(names.some((name) => name.endsWith("/src/App.vue"))).toBe(true);
  expect(names.some((name) => name.endsWith("/vite.config.ts"))).toBe(true);
  expect(names.some((name) => name.endsWith("/next.config.mjs"))).toBe(false);
});

test("single HTML preserves deferred script order and keeps data attributes inert", async ({ page }) => {
  const { toSingleHtmlProject } = await import("../lib/generator/single-html");
  const { files } = await toSingleHtmlProject({
    files: {
      "index.html": '<!doctype html><head><script defer src="late.js"></script></head>' +
        '<body><div id=target></div><script data-src=unexpected.js></script></body>',
      "late.js": 'document.getElementById("target").textContent = document.readyState',
      "unexpected.js": 'document.documentElement.dataset.unexpected = "yes"',
    },
    binaries: {}, remoteAssets: {},
  });
  const resources: string[] = [];
  await page.route("**/*", route => {
    if (route.request().isNavigationRequest()) return route.fulfill({ contentType: "text/html", body: files["index.html"] });
    resources.push(route.request().url());
    return route.abort();
  });
  await page.goto("http://single.example.test/");
  await expect(page.locator("#target")).toHaveText("interactive");
  expect(await page.locator("html").getAttribute("data-unexpected")).toBeNull();
  expect(resources).toEqual([]);
});

test("single HTML runs a nested module graph offline with native module identity", async ({ page }) => {
  const { toSingleHtmlProject } = await import("../lib/generator/single-html");
  const source = {
    "index.html": '<!doctype html><body><p></p><script type=module src="./js/entry.mjs"></script>',
    "js/entry.mjs": 'import { first } from "./sub/reexport.js"; import { id } from "./a.js";' +
      'const other = await import("./b.js");' +
      'document.querySelector("p").textContent = [first === id, id !== other.id, "</script>"].join(" ");',
    "js/sub/reexport.js": 'export { id as first } from "../a.js";',
    "js/a.js": "export const id = {};",
    "js/b.js": "export const id = {};",
  };
  const { files } = await toSingleHtmlProject({ files: source, remoteAssets: {}, binaries: {} });
  const requests: string[] = [];
  await page.route("**/*", route => {
    if (route.request().isNavigationRequest()) return route.fulfill({ contentType: "text/html", body: files["index.html"] });
    requests.push(route.request().url());
    return route.abort();
  });
  await page.goto("http://single.example.test/");
  await expect(page.locator("p")).toHaveText("true true </script>");
  expect(requests).toEqual([]);
});
