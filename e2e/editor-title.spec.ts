import { expect, test } from "@playwright/test";
import { editorTitleBundle, editorTitleHydrationHtml } from "../tests/helpers/editor-title";

let bundle: string;
test.beforeAll(async () => { bundle = await editorTitleBundle(); });

for (const source of ["server", "local"] as const) {
  test(`遅れて届く共通メタデータが${source === "server" ? "サーバー" : "ブラウザ保存"}のサイト名を上書きしない`, async ({ page }) => {
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
    // Next と同じく、メタデータを別の Suspense 境界で遅れて確定させる。
    await page.evaluate(() => (window as any).finishMetadata());
    await expect.poll(() => page.evaluate(() => (window as any).metadataReady)).toBe(true);
    await expect(page).toHaveTitle(title);
    await expect(page.locator("head title")).toHaveCount(1);
    expect(errors).toEqual([]);
  });
}

test("エディタのエラーと再試行でもサイト名のタイトルを保つ", async ({ page }) => {
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
  await page.getByRole("button", { name: "もう一度表示する", exact: true }).click();
  await expect(page.locator("[data-editor-ready]")).toBeVisible();
  await expect(page.locator(".safe-page")).toHaveCount(0);
  await expect(page).toHaveTitle("Recovery title | Tsumu");
  await expect(page.locator("head title")).toHaveCount(1);
  expect(await page.evaluate(() => document.querySelector("title") === (window as any).titleBeforeError)).toBe(true);
  expect(await page.evaluate(() => (window as any).titleCaughtErrors)).toEqual(["title fixture editor failure"]);
  expect(errors).toEqual([]);
});

test("SSR の既定タイトルを重複や hydration エラーなしでサイト名に更新する", async ({ page }) => {
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
