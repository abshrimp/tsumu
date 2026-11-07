import { expect, test, type Page } from "@playwright/test";
import JSZip from "jszip";
import { createInitialDoc, makeImage } from "../lib/presets";
import { DOC_STORAGE_KEY } from "../lib/site";
import { storageKey } from "../lib/storage-keys";

const zipUrl = "https://downloads.example.test/site.zip";
const docUrl = "https://downloads.example.test/doc.json";
const listKey = storageKey("sites-v1");

function siteDoc(name: string, addAsset = false) {
  const doc = createInitialDoc();
  doc.siteName = name;
  doc.customHeadHtml = '<meta name="editable-import" content="yes">';
  if (addAsset) {
    doc.assets["stable-image-id"] = {
      id: "stable-image-id", name: "logo.svg", width: 16, height: 16,
      mimeType: "image/svg+xml", path: "assets/old-key",
    };
    const image = makeImage();
    image.id = "restored-image";
    image.image!.assetId = "stable-image-id";
    doc.nodes[image.id] = image;
    doc.pages[doc.pageOrder[0]].children.push(image.id);
  }
  return doc;
}

async function zipSite() {
  const doc = siteDoc("Restored ZIP site", true);
  const zip = new JSZip();
  const root = zip.folder("website")!;
  root.file("_tsumu/doc.json", JSON.stringify(doc));
  root.file("_tsumu/assets.json", JSON.stringify({
    version: 1, assets: { "stable-image-id": "public/assets/logo.svg" },
  }));
  root.file("public/assets/logo.svg",
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6"/></svg>');
  root.file("index.html", "<html><body>Do not parse exported HTML</body></html>");
  return { doc, buffer: await zip.generateAsync({ type: "nodebuffer" }) };
}

async function localMode(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("tsumu-lang", "ja");
    localStorage.setItem("tsumu-help-seen-v1", "1");
  });
  await page.route("**/api/sites**", r => r.fulfill({ status: 503, json: {} }));
  await page.route("**/api/doc**", r => r.fulfill({ status: 503, json: {} }));
  await page.route("**/api/assets", r => r.fulfill({ status: 503, json: {} }));
}

async function localState(page: Page) {
  return page.evaluate(({ listKey, docKey }) => {
    const sites = JSON.parse(localStorage.getItem(listKey) || "[]");
    const first = sites[0];
    return {
      sites,
      doc: first ? JSON.parse(localStorage.getItem(docKey + ":" + first.id) || "null") : null,
    };
  }, { listKey, docKey: DOC_STORAGE_KEY });
}

test("ZIP URL creates a local editable site with preserved assets and survives reload", async ({ page }) => {
  await localMode(page);
  const { doc, buffer } = await zipSite();
  let downloads = 0;
  await page.route("**/api/import-source", async (route) => {
    downloads++;
    expect(route.request().postDataJSON()).toEqual({ kind: "zip", url: zipUrl });
    await route.fulfill({ status: 200, contentType: "application/octet-stream", body: buffer });
  });
  await page.goto("/?zip=" + encodeURIComponent(zipUrl));
  await expect(page).toHaveURL(/\/sites\/[a-z0-9-]+$/, { timeout: 30000 });
  await expect(page.locator(".app")).toBeVisible({ timeout: 30000 });
  let value = await localState(page);
  expect(value.sites).toHaveLength(1);
  expect(value.doc.siteName).toBe(doc.siteName);
  expect(value.doc.customHeadHtml).toBe(doc.customHeadHtml);
  expect(value.doc.pages).toEqual(doc.pages);
  expect(value.doc.nodes).toEqual(doc.nodes);
  expect(value.doc.assets["stable-image-id"].id).toBe("stable-image-id");
  expect(value.doc.assets["stable-image-id"].dataUrl).toMatch(/^data:image\/svg\+xml;base64,/);
  expect(value.doc.assets["stable-image-id"].path).toBeFalsy();
  await page.reload();
  await expect(page.locator(".app")).toBeVisible({ timeout: 30000 });
  value = await localState(page);
  expect(value.sites).toHaveLength(1);
  expect(value.doc.siteName).toBe(doc.siteName);
  expect(downloads).toBe(1);
});

test("doc.json URL without assets still creates the site and warns once", async ({ page }) => {
  await localMode(page);
  const doc = siteDoc("JSON import without assets", true);
  const kinds: string[] = [];
  await page.route("**/api/import-source", async (route) => {
    const input = route.request().postDataJSON();
    kinds.push(input.kind);
    if (input.kind === "doc") {
      await route.fulfill({ contentType: "application/octet-stream", body: Buffer.from(JSON.stringify(doc)) });
    } else {
      await route.fulfill({ status: 502, json: { error: "Asset not found" } });
    }
  });
  await page.goto("/?doc=" + encodeURIComponent(docUrl));
  await expect(page).toHaveURL(/\/sites\/[a-z0-9-]+$/, { timeout: 30000 });
  await expect(page.locator(".app")).toBeVisible({ timeout: 30000 });
  const state = await localState(page);
  expect(state.sites).toHaveLength(1);
  expect(state.doc.assets["stable-image-id"].id).toBe("stable-image-id");
  expect(state.doc.assets["stable-image-id"].path).toBeUndefined();
  expect(kinds).toEqual(["doc", "asset"]);
  await expect(page.getByRole("alertdialog")).toContainText("一部のアセットを復元できませんでした");
  await page.reload();
  await expect(page.locator(".app")).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  expect((await localState(page)).sites).toHaveLength(1);
});

test("doc.json URL uses server APIs to persist editable document before navigating", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("tsumu-lang", "ja"));
  const doc = siteDoc("Server-imported document");
  const id = "imported-server-id";
  let created = 0;
  let saved: any = null;
  await page.route("**/api/sites**", async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (path === "/api/sites" && req.method() === "GET") {
      await route.fulfill({ json: { sites: [] } }); return;
    }
    if (path === "/api/sites" && req.method() === "POST") {
      created++;
      await route.fulfill({ json: { site: { id, name: doc.siteName } } }); return;
    }
    if (path === "/api/sites/" + id && req.method() === "GET") {
      await route.fulfill({ json: { site: { id, name: doc.siteName } } }); return;
    }
    await route.fulfill({ status: 400, json: { error: "Unexpected site request" } });
  });
  await page.route("**/api/doc?**", async (route) => {
    if (route.request().method() === "PUT") {
      saved = JSON.parse(route.request().postData() || "{}");
      await route.fulfill({ json: { ok: true, rev: "1", savedAt: 1 } });
    } else {
      await route.fulfill({ json: { exists: true, doc: saved, rev: "1", savedAt: 1 } });
    }
  });
  await page.route("**/api/import-source", r => r.fulfill({
    contentType: "application/octet-stream", body: Buffer.from(JSON.stringify(doc)),
  }));
  await page.goto("/?doc=" + encodeURIComponent(docUrl));
  await expect(page).toHaveURL(/\/sites\/imported-server-id$/, { timeout: 30000 });
  await expect(page.locator(".app")).toBeVisible({ timeout: 30000 });
  expect(created).toBe(1);
  expect(saved).toMatchObject({
    siteName: doc.siteName, customHeadHtml: doc.customHeadHtml,
    pages: doc.pages, nodes: doc.nodes,
  });
  await page.reload();
  await expect(page.locator(".app")).toBeVisible({ timeout: 30000 });
  expect(created).toBe(1);
});

test("failed download creates no site; retry succeeds without duplicates", async ({ page }) => {
  await localMode(page);
  const doc = siteDoc("Recovered after retry");
  let unavailable = true, attempts = 0;
  await page.route("**/api/import-source", async (route) => {
    attempts++;
    if (unavailable) await route.fulfill({ status: 502, json: { error: "一時的に取得できませんでした。" } });
    else await route.fulfill({
      contentType: "application/octet-stream", body: Buffer.from(JSON.stringify(doc)),
    });
  });
  await page.goto("/?doc=" + encodeURIComponent(docUrl));
  await expect(page.getByRole("alert")).toContainText("一時的に取得できませんでした。");
  expect((await localState(page)).sites).toHaveLength(0);
  unavailable = false;
  await page.getByRole("button", { name: "再試行" }).click();
  await expect(page).toHaveURL(/\/sites\/[a-z0-9-]+$/, { timeout: 30000 });
  await expect(page.locator(".app")).toBeVisible({ timeout: 30000 });
  expect((await localState(page)).sites).toHaveLength(1);
  expect(attempts).toBe(2);
});
