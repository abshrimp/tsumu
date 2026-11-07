import { test, expect } from "@playwright/test";
import { createInitialDoc } from "../lib/presets";
import { browserDoc } from "./helpers/browser-doc";
import { storageKey } from "../lib/storage-keys";

test.describe("mcp-connection-menu", () => {
test("MCP connection has its own editor menu dialog, not a Settings section", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("tsumu-help-seen-v1", "1"));
  const response = await page.request.post("/api/sites", { data: { name: "MCP menu" } });
  expect(response.ok()).toBeTruthy();
  const { site } = await response.json();

  await page.goto(`/sites/${site.id}`);
  await expect(page.locator('[data-tutorial="menu"] > button')).toBeVisible();
  await page.locator('[data-tutorial="menu"] > button').click();
  const menuItems = page.locator(".dd-menu .dd-item");
  await expect(menuItems.filter({ hasText: "MCP接続" })).toBeVisible();
  await menuItems.filter({ hasText: "MCP接続" }).click();

  await expect(page.locator(".modal-backdrop .modal > h2")).toHaveText("MCP接続");
  await expect(page.locator(".modal-backdrop .settings-sec h3")).toHaveText("AIと接続");
  await expect(page.getByRole("button", { name: "接続を開始" })).toBeVisible();
  await page.locator(".modal-backdrop .modal-actions button").click();
  await expect(page.locator(".modal-backdrop")).toHaveCount(0);

  await page.locator('[data-tutorial="menu"] > button').click();
  await page.locator(".dd-menu .dd-item").filter({ hasText: "設定" }).click();
  await expect(page.locator(".modal-backdrop .modal > h2")).toHaveText("設定");
  await expect(page.locator(".modal-backdrop").getByRole("heading", { name: "AIと接続" })).toHaveCount(0);
});
});

test.describe("mcp-draft-import", () => {
const draftId = "12345678-1234-4234-8234-123456789abc";
const secret = "s".repeat(43);
const receipt = "abcdef01-1234-4234-8234-abcdef012345";
const endpoint = "https://mcp.tsumu.ebii.net/drafts/" + draftId;

async function prepare(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    localStorage.setItem("tsumu-lang", "ja");
    localStorage.setItem("tsumu-help-seen-v1", "1");
  });
  await page.route("**/api/sites**", route => route.fulfill({ status: 503, json: {} }));
  await page.route("**/api/doc**", route => route.fulfill({ status: 503, json: {} }));
  await page.route("**/api/assets", route => route.fulfill({ status: 503, json: {} }));
}

test("one-time MCP URL imports a new editable site, then acknowledges deletion", async ({ page }) => {
  await prepare(page);
  const doc = createInitialDoc();
  doc.siteName = "AI-generated imported site";
  const styledNode = Object.values(doc.nodes).find(node => node.text?.heading === 1);
  expect(styledNode).toBeDefined();
  const baseStyles = styledNode!.styles.base?.default;
  expect(baseStyles).toBeDefined();
  baseStyles!.backgroundColor = "#183c32";
  baseStyles!.color = "#d9fa4a";
  let claims = 0, completions = 0;
  let releaseClaim!: () => void;
  const holdClaim = new Promise<void>(resolve => { releaseClaim = resolve; });
  await page.route(endpoint + "/claim", async route => {
    claims++;
    expect(route.request().headers()["authorization"]).toBe("Bearer " + secret);
    await holdClaim;
    await route.fulfill({ json: { doc: JSON.stringify(doc), receipt } });
  });
  await page.route(endpoint + "/complete", async route => {
    completions++;
    expect(route.request().postDataJSON()).toEqual({ receipt });
    await route.fulfill({ json: { ok: true } });
  });
  await page.goto("/#tsumu-import=" + draftId + "." + secret);
  await expect(page.locator(".home-import-overlay")).toBeVisible();
  await expect(page.locator(".home-import-overlay")).toHaveAttribute("aria-busy", "true");
  await expect(page.locator(".home-import-overlay .boot-card")).toBeVisible();
  await expect(page.locator(".home-import-overlay .boot-bar")).toBeVisible();
  releaseClaim();
  await expect(page).toHaveURL(/\/sites\/[a-z0-9-]+$/, { timeout: 30000 });
  await expect(page.locator(".app")).toBeVisible({ timeout: 30000 });
  expect(claims).toBe(1);
  expect(completions).toBe(1);
  const list = await page.evaluate(key => JSON.parse(localStorage.getItem(key) || "[]") as { id: string; name: string }[], storageKey("sites-v1"));
  expect(list).toHaveLength(1);
  const imported = JSON.parse((await browserDoc(page, list[0].id)) || "null");
  expect(imported.siteName).toBe(doc.siteName);
  expect(imported.nodes[styledNode!.id].styles.base.default.backgroundColor).toBe("#183c32");
  expect(imported.nodes[styledNode!.id].styles.base.default.color).toBe("#d9fa4a");
});

test("invalid MCP draft does not create a site or acknowledge deletion", async ({ page }) => {
  await prepare(page);
  let completions = 0;
  await page.route(endpoint + "/claim", route => route.fulfill({ json: { doc: "{bad-json", receipt } }));
  await page.route(endpoint + "/complete", route => {
    completions++;
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto("/#tsumu-import=" + draftId + "." + secret);
  await expect(page.locator(".home-notice.is-error")).toBeVisible({ timeout: 30000 });
  expect(completions).toBe(0);
  const list = await page.evaluate(key => JSON.parse(localStorage.getItem(key) || "[]") as unknown[], storageKey("sites-v1"));
  expect(list).toHaveLength(0);
  expect(new URL(page.url()).hash).toBe("");
});
});
