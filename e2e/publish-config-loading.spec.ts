import { expect, test } from "@playwright/test";

// 公開のエンドポイントは模擬する。これらのテストは、GitHub に決して書き込まない。
for (const state of ["token", "repo", "configured", "error"] as const) {
  test(`Publish controls stay hidden until GitHub configuration resolves: ${state}`, async ({ page }) => {
    let releaseConfig: (() => void) | undefined;
    let publishRequests = 0;
    await page.route("**/api/publish?*", async (route) => {
      if (route.request().method() !== "GET") {
        publishRequests++;
        await route.fulfill({ status: 500, json: { error: "Unexpected publish request" } });
        return;
      }
      await new Promise<void>((resolve) => { releaseConfig = resolve; });
      if (state === "error") {
        await route.fulfill({ status: 503, json: { error: "Unavailable" } });
        return;
      }
      const configured = state === "configured";
      await route.fulfill({ json: {
        configured, unset: configured ? null : state, previewEnabled: false,
        production: { repo: configured ? "example/site" : null, branch: "main", url: null, error: configured ? null : "Not configured" },
        test: { repo: configured ? "example/site" : null, branch: "preview", url: null, error: "Disabled" },
      } });
    });

    await page.addInitScript(() => localStorage.setItem("tsumu-help-seen-v1", "1"));
    const response = await page.request.post("/api/sites", { data: { name: "Publish configuration gate" } });
    expect(response.ok()).toBeTruthy();
    const { site } = await response.json();
    await page.goto(`/sites/${site.id}`);
    await expect(page.locator('[data-tutorial="canvas"]').getByText("見出しをここに").first()).toBeVisible();
    await page.locator('[data-tutorial="publish"]').click();

    const modal = page.locator(".pub-modal");
    await expect(modal).toBeVisible();
    await expect.poll(() => Boolean(releaseConfig)).toBe(true);
    await expect(modal.getByRole("status")).toContainText("公開先を確認しています");
    await expect(modal.locator(".pub-export-options")).toHaveCount(0);
    await expect(modal.locator(".pub-cards")).toHaveCount(0);
    await expect(modal.locator(".modal-desc")).toHaveCount(0);

    releaseConfig?.();
    if (state === "configured") {
      await expect(modal.locator(".pub-export-options")).toBeVisible();
      await expect(modal.getByRole("button", { name: "本番に公開", exact: true })).toBeVisible();
    } else if (state === "error") {
      await expect(modal).toContainText("公開先の設定を読み込めませんでした");
    } else {
      await expect(modal).toContainText(state === "token"
        ? "GitHubへの公開が設定されていません" : "公開先が設定されていません");
    }
    await expect(modal.getByRole("status")).toHaveCount(0);
    if (state !== "configured") {
      await expect(modal.locator(".pub-export-options")).toHaveCount(0);
      await expect(modal.locator(".pub-cards")).toHaveCount(0);
    }
    expect(publishRequests).toBe(0);
  });
}
