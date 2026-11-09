import { expect, test } from "@playwright/test";
import { generateProject } from "../lib/generator";
import { emptyDest } from "../lib/site";
import { browserDoc, setBrowserDoc } from "./helpers/browser-doc";
import { storageKey } from "../lib/storage-keys";
import { copySiteStorageBundle } from "../tests/helpers/copy-site-storage";
import { encodedCssAssetDoc, emptyAssetDestination, picture, type CssLocation } from "../tests/helpers/encoded-css-assets";

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
