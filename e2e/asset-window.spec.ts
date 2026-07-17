import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { assetWindowBundle } from "../tests/helpers/asset-window-browser";

let bundle: string;
let imageRequests: Set<string>;
const css = readFileSync("app/globals.css", "utf8");
const id = (index: number) => `library_asset_${String(index).padStart(6, "0")}`;
const card = (page: Page, index: number) => page.locator(`[data-asset-id="${id(index)}"]`);
const frame = (page: Page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
async function scroll(page: Page, top: number | "bottom") {
  await page.locator(".asset-panel .panel-body").evaluate((el, top) => { el.scrollTop = top === "bottom" ? el.scrollHeight : top; }, top);
  await frame(page);
}
async function bounded(page: Page) {
  await expect.poll(() => page.locator(".asset-card").count()).toBeLessThan(40);
}
test.beforeAll(async () => { bundle = await assetWindowBundle(); });
test.beforeEach(async ({ page }) => {
  imageRequests = new Set();
  page.on("request", (r) => { if (r.url().includes("/api/assets/file")) imageRequests.add(r.url()); });
  await page.route("http://asset-window.test/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith("/sites/")) return route.fulfill({ contentType: "text/html", body: `<!doctype html><html lang="ja"><head><style>${css}</style></head><body><div id="app"></div></body></html>` });
    if (url.pathname === "/api/assets/file") return route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900"><rect width="1200" height="900" fill="lightblue"/></svg>' });
    if (route.request().method() === "POST") return route.fulfill({ json: { path: "assets/uploaded.svg" } });
    return route.fulfill({ json: { others: [], assets: false, ok: true } });
  });
  await page.goto("http://asset-window.test/sites/synthetic");
  await page.addScriptTag({ content: bundle });
  await expect(card(page, 0)).toBeVisible();
});

test("Virtualizing 5,000 images limits DOM nodes and requests to the viewport while keeping the end reachable", async ({ page }) => {
  await bounded(page);
  expect(await page.locator(".asset-card").first().getAttribute("aria-setsize")).toBe("5000");
  await expect.poll(() => imageRequests.size).toBeLessThan(40);
  await scroll(page, "bottom");
  await expect(card(page, 4999)).toBeVisible();
  await bounded(page);
  const box = await card(page, 4999).boundingBox();
  const previous = await card(page, 4997).boundingBox();
  const width = await page.locator(".panel-body").evaluate((el) => el.clientWidth);
  expect(box!.y - previous!.y).toBeCloseTo((width - 34) / 2 * 3 / 4 + 50, 0);
  await scroll(page, 0);
  await expect(card(page, 0)).toBeVisible();
});

test("Searching and clearing a search from a deep scroll position still finds every asset", async ({ page }) => {
  await scroll(page, "bottom");
  const search = page.locator(".asset-search input");
  await search.fill("Photo 004999");
  await expect(page.locator(".asset-card")).toHaveCount(1);
  await expect(card(page, 4999)).toBeVisible();
  await search.press("Escape");
  await expect(card(page, 0)).toBeVisible();
  await bounded(page);
  await search.fill("Photo 004");
  await expect(page.locator(".asset-count")).toContainText("1000 / 5000");
  await expect(card(page, 4000)).toBeVisible();
  await bounded(page);
  await search.fill("missing");
  await expect(page.locator(".asset-card")).toHaveCount(0);
  await page.getByRole("button", { name: "検索をクリア" }).click();
  await expect(card(page, 0)).toBeVisible();
});

test("Reveal requests remove the filter and scroll to an asset that was not rendered", async ({ page }) => {
  await page.locator(".asset-search input").fill("Photo 000001");
  await page.evaluate((id) => (window as any).assetEditor.getState().revealAsset(id), id(4500));
  await expect(page.locator(".asset-search input")).toHaveValue("");
  await expect(card(page, 4500)).toBeVisible();
  await expect(card(page, 4500)).toHaveClass(/is-revealed/);
  await bounded(page);
});

test("Reopening a tab restores scroll, and resizing does not overlap rows", async ({ page }) => {
  await scroll(page, 20000);
  const before = await page.locator(".panel-body").evaluate((el) => el.scrollTop);
  await page.evaluate(() => (window as any).setAssetPanelOpen(false));
  await expect(page.locator(".asset-panel")).toHaveCount(0);
  await page.evaluate(() => (window as any).setAssetPanelOpen(true));
  await expect(page.locator(".asset-panel")).toBeVisible();
  await expect.poll(() => page.locator(".panel-body").evaluate((el) => el.scrollTop)).toBeCloseTo(before, 0);
  await page.locator("#asset-host").evaluate((el) => { el.style.width = "380px"; el.style.height = "500px"; });
  await frame(page);
  await scroll(page, "bottom");
  await expect(card(page, 4999)).toBeVisible();
  const a = await card(page, 4997).boundingBox(), b = await card(page, 4999).boundingBox();
  expect(b!.y).toBeGreaterThan(a!.y + a!.height);
  await bounded(page);
});

test("Offscreen focus and Tab/Shift+Tab retain the logical navigation order", async ({ page }) => {
  await card(page, 0).locator(".asset-thumb").focus();
  await scroll(page, "bottom");
  await expect(card(page, 0).locator(".asset-thumb")).toBeFocused();
  await card(page, 0).getByRole("button", { name: "削除", exact: true }).evaluate((el: HTMLElement) => el.focus({ preventScroll: true }));
  await page.keyboard.press("Tab");
  await expect(card(page, 1).locator(".asset-thumb")).toBeFocused();
  await expect(card(page, 1)).toBeVisible();
  await page.keyboard.press("Shift+Tab");
  await expect(card(page, 0).getByRole("button", { name: "削除", exact: true })).toBeFocused();
  await scroll(page, "bottom");
  await card(page, 4999).getByRole("button", { name: "削除", exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(page.locator("#after")).toBeFocused();
  await scroll(page, 0);
  await card(page, 0).locator(".asset-thumb").focus();
  await page.keyboard.press("Shift+Tab");
  await expect(page.locator(".asset-clean")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(card(page, 0).locator(".asset-thumb")).toBeFocused();
  await page.locator("#after").focus();
  await page.keyboard.press("Shift+Tab");
  await expect(card(page, 4999).getByRole("button", { name: "削除", exact: true })).toBeFocused();
  await expect(card(page, 4999)).toBeVisible();
  await bounded(page);
});

test("Scrolling during rename preserves the input, Enter saves, and Escape cancels", async ({ page }) => {
  await card(page, 0).hover();
  await card(page, 0).getByRole("button", { name: "名前を変更" }).click();
  const input = card(page, 0).locator(".asset-rename");
  await input.fill("Edited");
  await scroll(page, "bottom");
  await expect(input).toHaveValue("Edited");
  await page.keyboard.press("Enter");
  await page.locator(".asset-search input").fill("Edited");
  await expect(card(page, 0).locator(".asset-name")).toHaveText("Edited.png");
  await card(page, 0).hover();
  await card(page, 0).getByRole("button", { name: "名前を変更" }).click();
  await input.fill("Cancelled");
  await input.press("Escape");
  await expect(card(page, 0).locator(".asset-name")).toHaveText("Edited.png");
});

test("An actively dragged card remains mounted and passes its asset ID to the canvas", async ({ page }) => {
  await card(page, 0).locator(".asset-thumb").evaluate((el) => {
    const transfer = new DataTransfer();
    el.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: transfer }));
    (window as any).assetDrag = { id: transfer.getData("application/x-tsumu-asset"), effect: transfer.effectAllowed };
  });
  await scroll(page, "bottom");
  await expect(card(page, 0)).toHaveCount(1);
  expect(await page.evaluate(() => (window as any).assetDrag.id)).toBe(id(0));
  await card(page, 0).locator(".asset-thumb").dispatchEvent("dragend");
  await expect(card(page, 0)).toHaveCount(0);
  await bounded(page);
});

test("Replacing an offscreen image uses the latest preview and insertion source", async ({ page }) => {
  await page.evaluate((id) => {
    const s = (window as any).assetEditor.getState(), d = structuredClone(s.doc);
    d.assets[id].path = "assets/replaced.png"; s.applyRemoteDoc(d); s.revealAsset(id);
  }, id(4999));
  await expect(card(page, 4999).locator("img")).toHaveAttribute("src", "/api/assets/file?path=assets%2Freplaced.png");
  await card(page, 4999).locator(".asset-thumb").click();
  expect(await page.evaluate(() => Object.values((window as any).assetEditor.getState().doc.nodes).map((n: any) => n.image?.src)))
    .toContain("/api/assets/file?path=assets%2Freplaced.png");
});

test("Deleting the last row does not leave an empty viewport, and newly dropped images remain discoverable", async ({ page }) => {
  await scroll(page, "bottom");
  await card(page, 4999).hover();
  await card(page, 4999).getByRole("button", { name: "削除", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "削除", exact: true }).click();
  await expect(card(page, 4999)).toHaveCount(0);
  await expect(card(page, 4998)).toBeVisible();
  await page.locator(".asset-panel").evaluate((el) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"/>'], "Dropped.svg", { type: "image/svg+xml" }));
    el.dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer: transfer }));
  });
  await page.locator(".asset-search input").fill("Dropped");
  await expect(page.locator(".asset-name")).toHaveText("Dropped.svg");
  await expect(page.locator(".asset-thumb img")).toHaveAttribute("src", "/api/assets/file?path=assets%2Fuploaded.svg");
});
