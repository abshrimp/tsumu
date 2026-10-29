import { expect, test } from "@playwright/test";
import { generateProject } from "../lib/generator";
import { createInitialDoc } from "../lib/presets";
import { emptyDest } from "../lib/site";
import { storageKey } from "../lib/storage-keys";
import { copySiteStorageBundle } from "../tests/helpers/copy-site-storage";
import { emptyAssetDestination, encodedCssAssetDoc, picture, type CssLocation } from "../tests/helpers/encoded-css-assets";
import { browserDoc, deleteBrowserDoc, setBrowserDoc } from "./helpers/browser-doc";

let defaultBundle: string;
test.beforeAll(async () => { defaultBundle = await copySiteStorageBundle(); });

test("copy dialog preserves unreadable IndexedDB documents across failure modes and allows retry", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("http://tsumu-copy.test/**", route => {
    if (new URL(route.request().url()).pathname === "/api/sites") return route.fulfill({ status: 503, json: {} });
    return route.fulfill({ contentType: "text/html", body: '<html><body><div id="app"></div></body></html>' });
  });
  await page.goto("http://tsumu-copy.test/sites/source");
  const doc = createInitialDoc();
  doc.siteName = "Keep this title";
  doc.customHeadHtml = "<!-- Destination content -->";
  const good = JSON.stringify(doc);
  await page.evaluate(site => {
    localStorage.setItem("tsumu-lang", "ja");
    localStorage.setItem("tsumu-sites-v1", JSON.stringify([site]));
    const state = window as any;
    state.failCopyRead = false;
    const get = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = function(key) {
      if (this.name === "documents" && key === "destination" && state.failCopyRead) {
        throw new DOMException("Read unavailable", "UnknownError");
      }
      return get.call(this, key);
    };
  }, { ...emptyDest(), id: "destination", name: "Destination", createdAt: 1, updatedAt: 1 });
  await page.addScriptTag({ content: defaultBundle });
  const button = page.locator(".copy-site-item");
  await expect(button.locator(".copy-site-name")).toHaveText("Destination");

  for (const failure of ["read", "json", "shape", "dangling", "breakpoints", "missing"] as const) {
    const bad = failure === "breakpoints"
      ? JSON.stringify({ ...doc, breakpoints: [{ id: "custom", label: "Custom", maxWidth: 800 }] })
      : failure === "json" ? '{"siteName":"recoverable"'
      : failure === "shape" ? JSON.stringify({ ...doc, pageOrder: [] })
      : failure === "dangling" ? JSON.stringify({
          ...doc,
          pages: { ...doc.pages, [doc.pageOrder[0]]: { ...doc.pages[doc.pageOrder[0]], children: ["missing-node"] } },
        })
      : failure === "missing" ? null : good;
    if (bad === null) {
      await deleteBrowserDoc(page, "destination");
    } else {
      await setBrowserDoc(page, "destination", bad);
    }
    await page.evaluate(fail => { (window as any).failCopyRead = fail; }, failure === "read");
    await button.click();
    await expect(page.locator(".copy-site-error")).toContainText(
      failure === "breakpoints" ? "画面幅の設定が違う" : "コピー先のサイトの編集データを読み込めませんでした"
    );
    await expect(page.locator(".copy-site-done")).toHaveCount(0);
    await page.evaluate(() => { (window as any).failCopyRead = false; });
    expect(await browserDoc(page, "destination")).toBe(bad);
  }

  await setBrowserDoc(page, "destination", good);
  await button.click();
  await expect(page.locator(".copy-site-done")).toContainText("Destination");
  const saved = JSON.parse((await browserDoc(page, "destination"))!);
  expect(saved.siteName).toBe(doc.siteName);
  expect(saved.customHeadHtml).toBe(doc.customHeadHtml);
  expect(saved.pageOrder.length).toBeGreaterThan(doc.pageOrder.length);
  expect(errors).toEqual([]);
});

for (const location of ["node.styles", "node.customCss", "page.bodyStyles"] as CssLocation[]) {
  test(`Copied pages include images referenced by CSS escapes in ${location}`, async ({ page }) => {
    const source = encodedCssAssetDoc(location, location !== "page.bodyStyles");
    const bundle = await copySiteStorageBundle(source);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("http://css-copy.test/**", (route) => {
      if (new URL(route.request().url()).pathname === "/api/sites") return route.fulfill({ status: 503, json: {} });
      return route.fulfill({ contentType: "text/html", body: '<html><body><div id="app"></div></body></html>' });
    });
    await page.goto("http://css-copy.test/sites/source");
    const destination = emptyAssetDestination();
    await page.evaluate(({ listKey, site }) => {
      localStorage.setItem("tsumu-lang", "ja");
      localStorage.setItem(listKey, JSON.stringify([site]));
    }, { listKey: storageKey("sites-v1"), site: { ...emptyDest(), id: "destination", name: "Destination", createdAt: 1, updatedAt: 1 } });
    await setBrowserDoc(page, "destination", JSON.stringify(destination));
    await page.addScriptTag({ content: bundle });
    await expect(page.locator(".copy-site-name")).toHaveText("Destination");
    await page.locator(".copy-site-item").click();
    await expect(page.locator(".copy-site-done")).toContainText("Destination");
    const saved = JSON.parse((await browserDoc(page, "destination"))!);
    expect(saved.pages.dest).toEqual(destination.pages.dest);
    expect(saved.pageOrder).toHaveLength(2);
    expect(Object.keys(saved.assets)).toEqual([picture.id]);
    expect(saved.assets[picture.id]).toEqual(picture);
    if (location !== "page.bodyStyles") expect(Object.keys(saved.components).sort()).toEqual(["inner", "outer"]);
    const exported = generateProject(saved);
    expect(exported.remoteAssets).toEqual({ "public/assets/hero.png": picture.path });
    expect(exported.files["styles/site.css"]).toContain("/assets/hero.png");
    expect(exported.files["styles/site.css"]).not.toContain("api/assets/file");
    expect(errors).toEqual([]);
  });
}
