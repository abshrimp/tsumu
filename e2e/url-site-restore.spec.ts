import { expect, test, type Page } from "@playwright/test";
import JSZip from "jszip";
import { createInitialDoc, makeBox } from "../lib/presets";
import type { SiteDoc } from "../lib/types";
import { DOC_STORAGE_KEY, siteKey } from "../lib/site";

const gif = Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64");
const importUrl = "https://example.com/editable-site";

function sample(): SiteDoc {
  const doc = createInitialDoc();
  doc.siteName = "Editable imported site";
  const pageId = doc.pageOrder[0];
  doc.nodes.imported = {
    ...makeBox(), id: "imported", name: "Original block",
    text: { content: "Original editable heading", heading: 1 },
    attrId: "original",
  };
  doc.nodes.photo = {
    ...makeBox(), id: "photo", name: "Photo", type: "image",
    image: { src: "/api/assets/file?path=assets%2Foutdated.gif",
      assetId: "cover", alt: "Cover", width: 1, height: 1 },
  };
  doc.pages[pageId].children.push("imported", "photo");
  doc.pages[pageId].pageScripts = [{
    id: "load", trigger: "load", pos: { x: 0, y: 0 },
    steps: [{ id: "split", kind: "split", source: "a,b", sep: ",", into: "parts" }],
  }];
  doc.assets.cover = { id: "cover", name: "cover.gif", path: "assets/outdated.gif",
    mimeType: "image/gif", width: 1, height: 1 };
  return doc;
}

async function sourceBytes(doc: SiteDoc, type: "zip" | "doc", includeAsset = true): Promise<Buffer> {
  if (type === "doc") return Buffer.from(JSON.stringify(doc));
  const zip = new JSZip();
  zip.file("project/_tsumu/doc.json", JSON.stringify(doc));
  if (includeAsset) zip.file("project/public/assets/cover.gif", gif);
  return zip.generateAsync({ type: "nodebuffer" });
}

async function localImport(page: Page, type: "zip" | "doc", includeAsset = true) {
  const doc = sample();
  const bytes = await sourceBytes(doc, type, includeAsset);
  await page.route("**/api/sites", (route) => route.fulfill({ status: 503, json: {} }));
  await page.route("**/api/sites/*", (route) => route.fulfill({ status: 503, json: {} }));
  await page.route("**/api/doc?*", (route) => route.fulfill({ status: 503, json: {} }));
  await page.route("**/api/status", (route) => route.fulfill({
    json: { auth: false, db: false, assets: false, user: null },
  }));
  await page.route("**/api/assets/file?*", (route) => route.fulfill({ status: 404, json: {} }));
  await page.route("**/api/assets", (route) => route.fulfill({ status: 503, json: {} }));
  await page.route("**/api/import-source?*", (route) => route.fulfill({
    contentType: "application/octet-stream", body: bytes,
  }));
  await page.goto("/?" + type + "=" + encodeURIComponent(importUrl));
  await expect(page).toHaveURL(/\/sites\/[a-z0-9-]+$/);
  const saved = await page.evaluate(() => {
    const id = location.pathname.split("/").pop()!;
    const raw = localStorage.getItem("tsumu-doc-v1:" + id);
    const list = JSON.parse(localStorage.getItem("tsumu-sites-v1") || "[]");
    return { doc: raw ? JSON.parse(raw) : null, id, list };
  });
  expect(saved.doc).not.toBeNull();
  expect(saved.doc.siteName).toBe("Editable imported site");
  expect(saved.doc.nodes.imported.text.content).toBe("Original editable heading");
  expect(saved.doc.nodes.photo.image.assetId).toBe("cover");
  expect(saved.doc.pages[doc.pageOrder[0]].pageScripts[0].steps[0].kind).toBe("split");
  expect(saved.list.filter((record: any) => record.id === saved.id)).toHaveLength(1);
  await expect(page.locator(".app")).toBeVisible();
  return saved;
}

for (const type of ["zip", "doc"] as const) {
  test("Local " + type + " URL creates an editable site, persists it and does not repeat on reload", async ({ page }) => {
    const restored = await localImport(page, type);
    if (type === "zip") {
      expect(restored.doc.assets.cover.id).toBe("cover");
      expect(restored.doc.assets.cover.dataUrl).toMatch(/^data:image\/gif;base64/);
      expect(restored.doc.nodes.photo.image.src).toContain("data:image/gif");
    }
    // The existing site loader must read the restored document on a fresh page.
    await page.reload();
    await expect(page).toHaveURL(/\/sites\/[a-z0-9-]+$/);
    expect(await page.evaluate((id) =>
      JSON.parse(localStorage.getItem("tsumu-doc-v1:" + id)!).nodes.imported.name,
      restored.id)).toBe("Original block");
    await page.goto("/");
    await expect(page.locator(".home-card")).toHaveCount(1);
  });
}

test("Missing ZIP media does not abort import and shows a warning inside the editor", async ({ page }) => {
  const result = await localImport(page, "zip", false);
  expect(result.doc.assets.cover.id).toBe("cover");
  await expect(page.getByText("アセットを一部復元できませんでした")).toBeVisible();
  await expect(page.getByText(/cover\.gif/)).toBeVisible();
});

test("Invalid archive does not create a partial site and a reload cannot duplicate the attempt", async ({ page }) => {
  await page.route("**/api/sites", (route) => route.fulfill({ status: 503, json: {} }));
  await page.route("**/api/import-source?*", (route) => route.fulfill({
    contentType: "application/octet-stream", body: Buffer.from("not a zip"),
  }));
  await page.goto("/?zip=" + encodeURIComponent(importUrl));
  await expect(page.locator(".home-notice.is-error")).toContainText("サイトを復元できませんでした");
  expect(await page.evaluate(() => localStorage.getItem("tsumu-sites-v1"))).toBeNull();
  expect(new URL(page.url()).search).toBe("");
  await page.reload();
  await expect(page.locator(".home-card")).toHaveCount(0);
});

test("Server-backed JSON import submits the full SiteDoc during atomic site creation", async ({ page }) => {
  const doc = sample();
  doc.assets.cover.dataUrl = "data:image/gif;base64," + gif.toString("base64");
  delete doc.assets.cover.path;
  let posted: any = null;
  let siteRequests = 0;
  await page.route("**/api/sites", async (route) => {
    if (route.request().method() === "POST") {
      siteRequests++;
      posted = route.request().postDataJSON();
      await route.fulfill({ json: { site: {
        id: "restored-server", name: posted.name, repo: null,
        branch: "main", previewBranch: "preview", siteUrl: null, previewUrl: null,
        createdAt: Date.now(), updatedAt: Date.now(),
      } } });
    } else await route.fulfill({ json: { sites: [] } });
  });
  await page.route("**/api/sites/restored-server", (route) => route.fulfill({ json: {
    site: { id: "restored-server", name: doc.siteName },
  } }));
  await page.route("**/api/doc?*", (route) => route.fulfill({ json: {
    exists: true, doc: posted?.importDoc, rev: "1", savedAt: 1,
  } }));
  await page.route("**/api/import-source?*", (route) => route.fulfill({
    contentType: "application/octet-stream", body: Buffer.from(JSON.stringify(doc)),
  }));
  await page.goto("/?doc=" + encodeURIComponent(importUrl));
  await expect(page).toHaveURL(/\/sites\/restored-server$/);
  expect(siteRequests).toBe(1);
  expect(posted.importDoc.siteName).toBe(doc.siteName);
  expect(posted.importDoc.nodes.imported.text.content).toBe("Original editable heading");
  await page.reload();
  expect(siteRequests).toBe(1);
});
