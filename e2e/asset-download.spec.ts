import { expect, test } from "@playwright/test";
import { assetConfirmationBundle, candidate, spare } from "../tests/helpers/asset-confirmation";

let bundle: string;
test.beforeAll(async () => { bundle = await assetConfirmationBundle(); });
test.beforeEach(async ({ page }) => {
  await page.route("http://asset-download.test/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith("/sites/")) return route.fulfill({
      contentType: "text/html",
      body: '<html><body><div id="app"></div></body></html>',
    });
    if (url.pathname === "/api/assets/file") return route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>',
    });
    return route.fulfill({ json: {} });
  });
  await page.goto("http://asset-download.test/sites/original");
  await page.addScriptTag({ content: bundle });
});
const failure = "アセットをダウンロードできませんでした";
const button = (id: string) => `[data-asset-id="${id}"] [data-tip="ダウンロード"]`;

for (const status of [403, 404, 500, 502]) {
  test(`HTTP ${status} shows an error without downloading JSON, then retry saves original bytes/name`, async ({ page }) => {
    const downloads: string[] = [], errors: string[] = [];
    page.on("download", (download) => downloads.push(download.suggestedFilename()));
    page.on("pageerror", (error) => errors.push(error.message));
    let failing = true;
    await page.route("**/api/assets/file?**", (route) => {
      if (route.request().resourceType() !== "fetch") return route.fallback();
      return failing
        ? route.fulfill({ status, json: { error: "synthetic storage error" } })
        : route.fulfill({ contentType: "image/png", body: Buffer.from([0, 1, 2, 255]) });
    });
    await page.locator(button(candidate.id)).click();
    await expect(page.getByText(failure, { exact: true })).toBeVisible();
    expect(downloads).toEqual([]);
    expect(page.context().pages()).toHaveLength(1);
    failing = false;
    const completed = page.waitForEvent("download");
    await page.locator(button(candidate.id)).click();
    const download = await completed;
    expect(download.suggestedFilename()).toBe(candidate.name);
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks)).toEqual(Buffer.from([0, 1, 2, 255]));
    await expect(page.getByText(failure, { exact: true })).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

for (const interrupt of ["newer-download", "unmount", "replace-doc"] as const) {
  test(`late HTTP error after ${interrupt} does not appear`, async ({ page }) => {
    let release!: () => Promise<void>;
    let started!: () => void;
    const pending = new Promise<void>((resolve) => { started = resolve; });
    await page.route("**/api/assets/file?**", (route) => {
      if (route.request().resourceType() !== "fetch" || !route.request().url().includes(encodeURIComponent(candidate.path!))) return route.fallback();
      release = () => route.fulfill({ status: 404, json: { error: "missing" } });
      started();
    });
    await page.locator(button(candidate.id)).click();
    await pending;
    if (interrupt === "newer-download") {
      const downloaded = page.waitForEvent("download");
      await page.locator(button(spare.id)).click();
      await downloaded;
    } else {
      await page.evaluate((interrupt) => {
        if (interrupt === "unmount") (window as any).closeAssetPanel();
        else {
          const state = (window as any).assetEditor.getState();
          state.replaceDoc(structuredClone(state.doc));
        }
      }, interrupt);
    }
    const response = page.waitForResponse((r) => r.status() === 404);
    await release();
    await (await response).finished();
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(page.getByText(failure, { exact: true })).toHaveCount(0);
  });
}
