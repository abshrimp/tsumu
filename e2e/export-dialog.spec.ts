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

test("compatibility errors never appear alongside the success check", async ({ page }) => {
  const modal = await openExport(page);
  await modal.getByRole("button", { name: "フレームワーク" }).click();
  await page.getByRole("button", { name: "React + Vite" }).click();
  await modal.getByRole("button", { name: "出力範囲" }).click();
  await page.getByRole("button", { name: "現在のページ" }).click();
  // A compatible page may show warnings; switching to a selection with no
  // selected node must always show the failure and never a positive check.
  await modal.getByRole("button", { name: "選択したコンポーネント" }).click();
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
