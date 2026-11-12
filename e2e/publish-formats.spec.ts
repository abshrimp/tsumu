import { expect, test } from "@playwright/test";
import { makeBox } from "../lib/presets";
import type { SiteDoc } from "../lib/types";

test("GitHub Push publishes the selected Vue file tree, not the Next.js tree", async ({ page }) => {
  const messages: Array<{ action: string; site?: string; exportOptions?: { framework: string; language: string; style: string }; files?: Record<string, string>; path?: string }> = [];
  // 横取りした API は、ブラウザの保存領域ではなく、サイトごとに保存する設定を再現する。
  const saved = new Map<string, { framework: string; language: string; style: string }>();
  await page.route("**/api/publish**", async (route) => {
    if (route.request().method() === "GET") {
      const siteId = new URL(route.request().url()).searchParams.get("site") ?? "";
      await route.fulfill({ json: {
        configured: true, unset: null, previewEnabled: false,
        lastExportOptions: saved.get(siteId) ?? { framework: "nextjs", language: "typescript", style: "css" },
        production: { repo: "example/project", branch: "main", url: null, error: null },
        test: { repo: "example/project", branch: "", url: null, error: "Disabled" },
      } });
      return;
    }
    const body = route.request().postDataJSON();
    messages.push(body);
    if (body.action === "tree") await route.fulfill({
      json: { head: null, blobs: {}, manifest: {}, generated: null },
    });
    else if (body.action === "upload") await route.fulfill({ json: { sha: "a".repeat(40) } });
    else if (body.action === "commit") {
      saved.set(body.site, body.exportOptions);
      await route.fulfill({ json: { ok: true, commitUrl: "https://example.com/commit", optionsSaved: true } });
    }
    else await route.fulfill({ status: 400, json: { error: "Unexpected action" } });
  });
  await page.addInitScript(() => localStorage.setItem("tsumu-help-seen-v1", "1"));
  const response = await page.request.post("/api/sites", { data: { name: "Multi-format Push" } });
  expect(response.ok()).toBe(true);
  const { site } = await response.json();
  const doc: SiteDoc = {
    schemaVersion: 1, siteName: "Push formats",
    pageOrder: ["home"],
    pages: {
      home: { id: "home", name: "Home", slug: "", title: "Home", description: "",
        children: ["heading"] },
    },
    nodes: { heading: { ...makeBox(), id: "heading", text: { content: "見出しをここに", heading: 1 } } },
    assets: {},
  };
  expect((await page.request.put("/api/doc?site=" + site.id, { data: doc })).ok()).toBe(true);
  await page.goto("/sites/" + site.id);
  await expect(page.locator('[data-tutorial="canvas"]').getByText("見出しをここに").first()).toBeVisible();
  await page.locator('[data-tutorial="publish"]').click();
  const modal = page.locator(".pub-modal");
  await expect(modal).toBeVisible();
  await modal.getByRole("button", { name: "フレームワーク" }).click();
  await page.getByRole("button", { name: "Vue 3 + Vite" }).click();
  await expect(modal.locator(".modal-desc")).toContainText("Vue 3 + Vite");
  await modal.getByRole("button", { name: "本番に公開", exact: true }).click();
  await expect(page.getByText("公開先の設定を確認してください")).toBeVisible();
  await page.getByRole("button", { name: "この形式でPushする" }).click();
  await expect(modal).toContainText("GitHubへPushしました");

  const paths = [
    ...Object.keys(messages.find((msg) => msg.action === "commit")?.files ?? {}),
    ...messages.filter((msg) => msg.action === "upload").map((msg) => msg.path!),
  ];
  expect(paths).toContain("src/App.vue");
  expect(paths).toContain("vite.config.ts");
  expect(paths).not.toContain("next.config.mjs");
  expect(paths).toContain("_tsumu/doc.json");
  expect(messages.map((m) => m.action)).toContain("commit");
  expect(messages.find((m) => m.action === "commit")?.exportOptions).toEqual({ framework: "vue", language: "typescript", style: "css" });
  expect(await page.evaluate(() => Object.keys(localStorage).filter(key => key.includes("publish-options")))).toEqual([]);

  // 選択肢を覚えるのは、GitHub への公開に成功したときだけ。再読み込みしても残る。
  await modal.getByRole("button", { name: "閉じる" }).click();
  await page.reload();
  await expect(page.locator('[data-tutorial="canvas"]').getByText("見出しをここに").first()).toBeVisible();
  await page.locator('[data-tutorial="publish"]').click();
  await expect(modal.getByRole("button", { name: "フレームワーク" })).toContainText("Vue 3 + Vite");

  // 公開せずに選択を変えても、最後に公開したときの設定を上書きしてはならない。
  await modal.getByRole("button", { name: "フレームワーク" }).click();
  await page.getByRole("button", { name: "React + Vite" }).click();
  await modal.getByRole("button", { name: "閉じる" }).click();
  await page.locator('[data-tutorial="publish"]').click();
  await expect(modal.getByRole("button", { name: "フレームワーク" })).toContainText("Vue 3 + Vite");
  await modal.getByRole("button", { name: "閉じる" }).click();

  // 別のサイトが、このサイトの公開の設定を引き継いではならない。
  const another = await page.request.post("/api/sites", { data: { name: "Different publish target" } });
  expect(another.ok()).toBe(true);
  const { site: otherSite } = await another.json();
  await page.goto("/sites/" + otherSite.id);
  await expect(page.locator('[data-tutorial="canvas"]').getByText("見出しをここに").first()).toBeVisible();
  await page.locator('[data-tutorial="publish"]').click();
  await expect(page.locator(".pub-modal").getByRole("button", { name: "フレームワーク" })).toContainText("Next.js");
});
