import { expect, test } from "@playwright/test";
import { makeBox } from "../lib/presets";
import type { SiteDoc } from "../lib/types";

test("GitHub Push publishes the selected Vue file tree, not the Next.js tree", async ({ page }) => {
  const messages: Array<{ action: string; files?: Record<string, string>; path?: string }> = [];
  await page.route("**/api/publish**", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: {
        configured: true, unset: null, previewEnabled: false,
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
    else if (body.action === "commit") await route.fulfill({
      json: { ok: true, commitUrl: "https://example.com/commit" },
    });
    else await route.fulfill({ status: 400, json: { error: "Unexpected action" } });
  });
  await page.addInitScript(() => localStorage.setItem("tsumu-help-seen-v1", "1"));
  const response = await page.request.post("/api/sites", { data: { name: "Multi-format Push" } });
  expect(response.ok()).toBe(true);
  const { site } = await response.json();
  const doc: SiteDoc = {
    siteName: "Push formats",
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
  expect(paths).toContain("_site-data/doc.json");
  expect(messages.map((m) => m.action)).toContain("commit");
});
