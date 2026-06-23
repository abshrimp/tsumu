import { expect, test, type Route } from "@playwright/test";

// 公開 API はすべてモックし、実際の画面で通信の完了順だけを入れ替える。
// GitHub への公開・ロールバックは行わない。
test("テスト公開の遅い履歴応答が本番の履歴とロールバック先に混ざらない", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const production: Route[] = [];
  const preview: Route[] = [];
  const rollbacks: unknown[] = [];
  const commits = (label: string) => ({ head: `${label}-head`, commits: [
    { sha: `${label}-old`, message: `${label} commit`, date: "2026-11-01T00:00:00Z", url: `https://example.com/${label}` },
  ] });
  const respond = (route: Route, body: unknown) => route.fulfill({ json: body });
  await page.route("**/api/publish?*", (route) => respond(route, {
    configured: true, previewEnabled: true,
    production: { repo: "example/site", branch: "main", url: null, error: null },
    test: { repo: "example/site", branch: "preview", url: null, error: null },
  }));
  await page.route("**/api/publish/history**", async (route) => {
    if (route.request().method() === "POST") {
      rollbacks.push(route.request().postDataJSON());
      await respond(route, { ok: true });
    } else {
      const target = new URL(route.request().url()).searchParams.get("target");
      (target === "production" ? production : preview).push(route);
    }
  });
  await page.addInitScript(() => localStorage.setItem("tsumu-help-seen-v1", "1"));
  const response = await page.request.post("/api/sites", { data: { name: "History race" } });
  expect(response.ok()).toBeTruthy();
  const { site } = await response.json();
  await page.goto(`/sites/${site.id}`);
  await expect(page.locator('[data-tutorial="canvas"]').getByText("見出しをここに").first()).toBeVisible();
  await page.locator('[data-tutorial="publish"]').click();
  await page.getByRole("button", { name: "公開履歴・ロールバック" }).click();
  await expect.poll(() => production.length).toBe(1);
  await respond(production[0], commits("initial-production"));
  await expect(page.getByText("initial-production commit", { exact: false })).toBeVisible();

  await page.getByRole("button", { name: "テストサイト", exact: true }).click();
  await expect.poll(() => preview.length).toBe(1);
  await page.getByRole("button", { name: "本番サイト", exact: true }).click();
  await expect.poll(() => production.length).toBe(2);
  await respond(production[1], commits("latest-production"));
  await expect(page.getByText("latest-production commit", { exact: false })).toBeVisible();

  const staleResponse = page.waitForResponse((res) => res.url().includes("/api/publish/history") && new URL(res.url()).searchParams.get("target") === "test");
  await respond(preview[0], commits("preview"));
  await (await staleResponse).finished();
  // fetch の完了後の React 描画まで待つ。
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(page.getByText("latest-production commit", { exact: false })).toBeVisible();
  await expect(page.getByText("preview commit", { exact: false })).toHaveCount(0);
  await page.getByRole("button", { name: "サイトを戻す", exact: true }).click();
  await page.getByRole("button", { name: "この版に戻す", exact: true }).click();
  await expect.poll(() => rollbacks).toEqual([{ site: site.id, target: "production", sha: "latest-production-old" }]);
  await expect.poll(() => production.length).toBe(3);
  await respond(production[2], commits("after-rollback"));
  await expect(page.getByText("ロールバックしました", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
