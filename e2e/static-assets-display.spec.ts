import { expect, test } from "@playwright/test";
import { createInitialDoc } from "../lib/presets";

test("static ZIP assets have file thumbnails, correct types and download behavior", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("tsumu-lang", "ja");
    localStorage.setItem("tsumu-help-seen-v1", "1");
  });
  await page.route("**/api/sites**", route => route.fulfill({ status: 503, json: {} }));
  await page.route("**/api/doc**", route => route.fulfill({ status: 503, json: {} }));
  await page.route("**/api/assets", route => route.fulfill({ status: 503, json: {} }));

  const doc = createInitialDoc();
  const binary = (mime: string, content: string) =>
    "data:" + mime + ";base64," + Buffer.from(content).toString("base64");
  doc.assets = {
    css: { id: "css", name: "app.css", width: 0, height: 0, mimeType: "text/css",
      dataUrl: binary("text/css", "body{color:red}") },
    js: { id: "js", name: "app.js", width: 0, height: 0, mimeType: "text/javascript",
      dataUrl: binary("text/javascript", "window.example=true;") },
    font: { id: "font", name: "font.woff2", width: 0, height: 0, mimeType: "font/woff2",
      dataUrl: binary("font/woff2", "fixture") },
    json: { id: "json", name: "data.json", width: 0, height: 0, mimeType: "application/json",
      dataUrl: binary("application/json", '{"ok":true}') },
  };
  await page.goto("/");
  await expect(page.getByRole("button", { name: "インポート", exact: true })).toBeEnabled();
  await page.getByLabel("ZIP・doc.json・HTMLファイルを選択").setInputFiles({
    name: "doc.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(doc)),
  });
  await expect(page).toHaveURL(/\/sites\/[a-z0-9-]+$/, { timeout: 30000 });
  await expect(page.locator(".app")).toBeVisible({ timeout: 30000 });
  await page.locator('[data-tutorial="left-tab-assets"]').click();
  for (const [id, ext, type] of [
    ["css", "CSS", "CSS"],
    ["js", "JS", "JavaScript"],
    ["font", "WOFF2", "フォント"],
    ["json", "JSON", "JSON"],
  ]) {
    const card = page.locator('[data-asset-id="' + id + '"]');
    await expect(card.locator(".asset-thumb.is-static")).toBeVisible();
    await expect(card.locator(".asset-static-extension")).toHaveText(ext);
    await expect(card.locator(".asset-dim")).toContainText(type);
    await expect(card.locator(".asset-thumb img")).toHaveCount(0);
  }
  const download = page.waitForEvent("download");
  await page.locator('[data-asset-id="css"] .asset-thumb').click();
  expect((await download).suggestedFilename()).toBe("app.css");
});
