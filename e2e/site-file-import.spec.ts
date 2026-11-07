import { expect, test } from "@playwright/test";
import JSZip from "jszip";
import { createInitialDoc, makeImage } from "../lib/presets";
import { DOC_STORAGE_KEY } from "../lib/site";
import { storageKey } from "../lib/storage-keys";

const listKey = storageKey("sites-v1");

function fixture(withAsset = false) {
  const doc = createInitialDoc();
  doc.siteName = withAsset ? "ZIP imported site" : "JSON imported site";
  doc.customHeadHtml = '<meta name="test-import" content="ok">';
  if (withAsset) {
    doc.assets["original-logo"] = {
      id: "original-logo", name: "logo.svg", width: 16, height: 16,
      mimeType: "image/svg+xml", path: "assets/on-old-server",
    };
    const image = makeImage();
    image.id = "imported-image";
    image.image!.assetId = "original-logo";
    doc.nodes[image.id] = image;
    doc.pages[doc.pageOrder[0]].children.push(image.id);
  }
  return doc;
}
async function localMode(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    localStorage.setItem("tsumu-lang", "ja");
    localStorage.setItem("tsumu-help-seen-v1", "1");
  });
  await page.route("**/api/sites**", route => route.fulfill({ status: 503, json: {} }));
  await page.route("**/api/doc**", route => route.fulfill({ status: 503, json: {} }));
  await page.route("**/api/assets", route => route.fulfill({ status: 503, json: {} }));
}
async function getLocalSite(page: import("@playwright/test").Page) {
  return page.evaluate(({ listKey, docKey }) => {
    const list = JSON.parse(localStorage.getItem(listKey) || "[]");
    return { list, doc: list[0] ? JSON.parse(localStorage.getItem(docKey + ":" + list[0].id) || "null") : null };
  }, { listKey, docKey: DOC_STORAGE_KEY });
}

test("ZIP file picker imports an editable site with original asset IDs", async ({ page }) => {
  await localMode(page);
  const doc = fixture(true);
  const zip = new JSZip();
  const root = zip.folder("website")!;
  root.file("_tsumu/doc.json", JSON.stringify(doc));
  root.file("_tsumu/assets.json", JSON.stringify({
    version: 1, assets: { "original-logo": "public/assets/logo.svg" },
  }));
  root.file("public/assets/logo.svg",
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6"/></svg>');
  await page.goto("/");
  await page.getByLabel("ZIPまたはdoc.jsonファイルを選択").setInputFiles({
    name: "website.zip", mimeType: "application/zip",
    buffer: await zip.generateAsync({ type: "nodebuffer" }),
  });
  await expect(page).toHaveURL(/\/sites\/[a-z0-9-]+$/, { timeout: 30000 });
  await expect(page.locator(".app")).toBeVisible({ timeout: 30000 });
  const result = await getLocalSite(page);
  expect(result.list).toHaveLength(1);
  expect(result.doc.pages).toEqual(doc.pages);
  expect(result.doc.nodes).toEqual(doc.nodes);
  expect(result.doc.assets["original-logo"].id).toBe("original-logo");
  expect(result.doc.assets["original-logo"].dataUrl).toMatch(/^data:image\/svg\+xml;base64,/);
  await page.reload();
  await expect(page.locator(".app")).toBeVisible();
  expect((await getLocalSite(page)).list).toHaveLength(1);
});

test("dropping a JSON file imports a new editable site", async ({ page }) => {
  await localMode(page);
  const doc = fixture();
  await page.goto("/");
  const file = {
    name: "doc.json", mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(doc)),
  };
  const payload = { name: file.name, type: file.mimeType, data: Array.from(file.buffer) };
  await expect(page.locator(".home-import-drop")).toHaveCount(0);
  await page.evaluate((input) => {
    const target = document.querySelector(".home-top");
    if (!target) throw new Error("Home header missing");
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(input.data)], input.name, { type: input.type }));
    target.dispatchEvent(new DragEvent("dragenter", { bubbles: true, cancelable: true, dataTransfer: transfer }));
    target.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: transfer }));
  }, payload);
  await expect(page.locator(".home-drop-overlay")).toBeVisible();
  await page.evaluate((input) => {
    // Drop on a different part of the homepage, not on a dedicated drop target.
    const target = document.querySelector(".home-main");
    if (!target) throw new Error("Home content missing");
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(input.data)], input.name, { type: input.type }));
    target.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
  }, payload);
  await expect(page).toHaveURL(/\/sites\/[a-z0-9-]+$/, { timeout: 30000 });
  const imported = await getLocalSite(page);
  expect(imported.list).toHaveLength(1);
  expect(imported.doc.siteName).toBe(doc.siteName);
  expect(imported.doc.customHeadHtml).toBe(doc.customHeadHtml);
});


test("normal text drag on the homepage does not trigger file import", async ({ page }) => {
  await localMode(page);
  await page.goto("/");
  const prevented = await page.evaluate(() => {
    const target = document.querySelector(".home-top");
    if (!target) throw new Error("Home header missing");
    const transfer = new DataTransfer();
    transfer.setData("text/plain", "ordinary text");
    const event = new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: transfer });
    target.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(prevented).toBe(false);
  await expect(page.locator(".home-drop-overlay")).toHaveCount(0);
  expect((await getLocalSite(page)).list).toHaveLength(0);
});

test("invalid JSON is rejected without creating a site", async ({ page }) => {
  await localMode(page);
  await page.goto("/");
  await page.getByLabel("ZIPまたはdoc.jsonファイルを選択").setInputFiles({
    name: "doc.json", mimeType: "application/json", buffer: Buffer.from("{not-json"),
  });
  await expect(page.locator(".home-notice[role=alert]")).toBeVisible();
  expect((await getLocalSite(page)).list).toHaveLength(0);
});

test("local file import persists the SiteDoc on the server when configured", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("tsumu-lang", "ja"));
  const doc = fixture();
  let stored: unknown = null;
  const siteId = "imported-server-site";
  await page.route("**/api/sites**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/sites" && route.request().method() === "GET")
      return route.fulfill({ json: { sites: [] } });
    if (path === "/api/sites" && route.request().method() === "POST")
      return route.fulfill({ json: { site: { id: siteId, name: doc.siteName } } });
    if (path === "/api/sites/" + siteId && route.request().method() === "GET")
      return route.fulfill({ json: { site: { id: siteId, name: doc.siteName } } });
    return route.fulfill({ status: 400, json: { error: "Unexpected site API" } });
  });
  await page.route("**/api/doc?**", async route => {
    if (route.request().method() === "PUT") {
      stored = route.request().postDataJSON();
      return route.fulfill({ json: { ok: true, rev: "1", savedAt: 1 } });
    }
    return route.fulfill({ json: { exists: true, doc: stored, rev: "1", savedAt: 1 } });
  });
  await page.goto("/");
  await page.getByLabel("ZIPまたはdoc.jsonファイルを選択").setInputFiles({
    name: "site.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(doc)),
  });
  await expect(page).toHaveURL(/\/sites\/imported-server-site$/, { timeout: 30000 });
  await expect(page.locator(".app")).toBeVisible({ timeout: 30000 });
  expect(stored).toMatchObject({ siteName: doc.siteName, pages: doc.pages, nodes: doc.nodes });
});
