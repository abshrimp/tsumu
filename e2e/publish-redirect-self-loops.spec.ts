import { expect, test } from "@playwright/test";
import JSZip from "jszip";
import { createInitialDoc } from "../lib/presets";

// 公開先の読み取りだけを模擬する。GitHub への公開は一度も行わない。
test("大文字だけ違う転送を公開・書き出し前に止め、別のパスへの修正後は書き出せる", async ({ page }) => {
  const errors: string[] = [];
  const publishWrites: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/publish**", async route => {
    if (route.request().method() !== "GET") {
      publishWrites.push(route.request().method());
      await route.fulfill({ status: 500, json: { error: "Unexpected publication request" } });
      return;
    }
    await route.fulfill({ json: { configured: true, previewEnabled: true,
      production: { repo: "example/site", branch: "main", url: null, error: null },
      test: { repo: "example/site", branch: "preview", url: null, error: null },
    } });
  });
  await page.addInitScript(() => localStorage.setItem("tsumu-help-seen-v1", "1"));
  const response = await page.request.post("/api/sites", { data: { name: "Redirect check" } });
  expect(response.ok()).toBeTruthy();
  const { site } = await response.json();
  const doc = createInitialDoc();
  doc.siteName = "Redirect check";
  doc.pages.about = { id: "about", name: "About us", slug: "about", title: "About us", description: "", children: [] };
  doc.pages.old = { id: "old", name: "Old URL", slug: "legacy-about", title: "", description: "", children: [], redirectTo: "/about?from=old#team" };
  doc.pageOrder.push("about", "old");
  expect((await page.request.put(`/api/doc?site=${site.id}`, { data: doc })).ok()).toBeTruthy();
  await page.goto(`/sites/${site.id}`);
  await expect(page.getByText("サーバー保存済み")).toBeVisible();
  await page.locator(".hdr-page .dd").click();
  await page.locator(".dd-menu .dd-item").filter({ hasText: /^Old URL/ }).click();
  await page.locator('[data-tutorial="left-tab-site"]').click();
  const slug = page.locator('[data-tutorial="tutorial-page-slug"]');
  await expect(slug).toHaveValue("legacy-about");
  await slug.fill("About");
  await slug.press("Enter");
  await expect(slug).toHaveValue("About");
  await expect.poll(async () => (await (await page.request.get(`/api/doc?site=${site.id}`)).json()).doc.pages.old.slug).toBe("About");

  await page.locator('[data-tutorial="publish"]').click();
  await expect(page.locator(".pub-modal .check-list .is-error")).toContainText("転送が繰り返される");
  await expect(page.locator(".pub-modal .check-list .is-error")).toContainText("Old URL");
  for (const name of ["本番に公開", "テストに公開"]) {
    await expect(page.getByRole("button", { name, exact: true })).toBeDisabled();
  }
  await page.locator(".pub-modal").getByRole("button", { name: "閉じる", exact: true }).click();
  const openExport = async () => {
    await page.getByRole("button", { name: "メニュー（書き出し・履歴・設定）", exact: true }).click();
    await page.getByRole("button", { name: "zipでエクスポート", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Next.jsプロジェクトとして書き出し" })).toBeVisible();
  };
  await openExport();
  await expect(page.locator(".modal .check-list .is-error")).toContainText("転送が繰り返される");
  await expect(page.getByRole("button", { name: "zipをダウンロード", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "キャンセル", exact: true }).click();

  // 大文字の通常ページを禁止せず、転送元だけを別のパスへ直せば解除される。
  await slug.fill("old-about");
  await slug.press("Enter");
  await expect(slug).toHaveValue("old-about");
  await page.locator('[data-tutorial="publish"]').click();
  await expect(page.locator(".pub-modal .check-list .is-error")).toHaveCount(0);
  for (const name of ["本番に公開", "テストに公開"]) {
    await expect(page.getByRole("button", { name, exact: true })).toBeEnabled();
  }
  await page.locator(".pub-modal").getByRole("button", { name: "閉じる", exact: true }).click();
  await openExport();
  await expect(page.locator(".modal .check-list .is-error")).toHaveCount(0);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "zipをダウンロード", exact: true }).click();
  const stream = await (await download).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const zip = await JSZip.loadAsync(Buffer.concat(chunks));
  const configPath = Object.keys(zip.files).find(name => name.endsWith("next.config.mjs"))!;
  expect(configPath).toBeTruthy();
  const config = await zip.file(configPath)!.async("string");
  expect(config).toContain('"source": "/old-about"');
  expect(config).toContain('"destination": "/about?from=old#team"');
  expect(Object.keys(zip.files).some(name => name.endsWith("app/about/page.tsx"))).toBe(true);
  expect(publishWrites).toEqual([]);
  expect(errors).toEqual([]);
});
