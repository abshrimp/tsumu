import { expect, test } from "@playwright/test";
import { editorTitleBundle, editorTitleHydrationHtml } from "../tests/helpers/editor-title";

let bundle: string;
test.beforeAll(async () => { bundle = await editorTitleBundle(); });

for (const source of ["server", "local"] as const) {
  test(`Late shared metadata does not overwrite the ${source === "server" ? "server" : "local-storage"} site title`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setContent('<html><head></head><body><div id="app"></div></body></html>');
    await page.evaluate((source) => {
      const state = window as any;
      state.titleLocalSites = [{ id: "title-test", name: "Local title" }];
      state.titleFetch = async () => Response.json(
        source === "server" ? { site: { name: "Server title" } } : { error: "unavailable" },
        { status: source === "server" ? 200 : 503 },
      );
    }, source);
    await page.addScriptTag({ content: bundle });
    const title = `${source === "server" ? "Server" : "Local"} title | Tsumu`;
    await expect(page.locator("[data-editor-ready]")).toBeVisible();
    await expect(page).toHaveTitle(title);
    // Next.js と同じように、メタデータは後から、別の Suspense の境界で解決する。
    await page.evaluate(() => (window as any).finishMetadata());
    await expect.poll(() => page.evaluate(() => (window as any).metadataReady)).toBe(true);
    await expect(page).toHaveTitle(title);
    await expect(page.locator("head title")).toHaveCount(1);
    expect(errors).toEqual([]);
  });
}

test("Editor errors and retries preserve the site name in the page title", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setContent('<html><head></head><body><div id="app"></div></body></html>');
  await page.evaluate(() => {
    (window as any).titleFetch = async () => Response.json({ site: { name: "Recovery title" } });
  });
  await page.addScriptTag({ content: bundle });
  await expect(page.locator("[data-editor-ready]")).toBeVisible();
  await expect(page).toHaveTitle("Recovery title | Tsumu");
  await page.evaluate(() => {
    (window as any).titleBeforeError = document.querySelector("title");
    (window as any).failTitleEditor();
  });
  await expect(page.locator(".safe-page")).toBeVisible();
  await expect(page.locator("[data-editor-ready]")).toHaveCount(0);
  await expect(page).toHaveTitle("Recovery title | Tsumu");
  await page.evaluate(() => (window as any).finishMetadata());
  await expect.poll(() => page.evaluate(() => (window as any).metadataReady)).toBe(true);
  await expect(page).toHaveTitle("Recovery title | Tsumu");
  await page.evaluate(() => { (window as any).titleEditorFailed = false; });
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.locator("[data-editor-ready]")).toBeVisible();
  await expect(page.locator(".safe-page")).toHaveCount(0);
  await expect(page).toHaveTitle("Recovery title | Tsumu");
  await expect(page.locator("head title")).toHaveCount(1);
  expect(await page.evaluate(() => document.querySelector("title") === (window as any).titleBeforeError)).toBe(true);
  expect(await page.evaluate(() => (window as any).titleCaughtErrors)).toEqual(["title fixture editor failure"]);
  expect(errors).toEqual([]);
});

test("SSR's default title changes to the site name without duplicates or hydration errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setContent(await editorTitleHydrationHtml());
  await expect(page).toHaveTitle("Tsumu");
  await expect(page.locator("head title")).toHaveCount(1);
  await page.evaluate(() => {
    (window as any).titleHydrate = true;
    (window as any).titleFetch = async () => Response.json({ site: { name: "Hydrated title" } });
  });
  await page.addScriptTag({ content: bundle });
  await expect(page.locator("[data-editor-ready]")).toBeVisible();
  await expect(page).toHaveTitle("Hydrated title | Tsumu");
  await expect(page.locator("head title")).toHaveCount(1);
  expect(await page.evaluate(() => (window as any).titleHydrationErrors)).toEqual([]);
  expect(errors).toEqual([]);
});
