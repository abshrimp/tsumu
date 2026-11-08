import { expect, test, type Route } from "@playwright/test";
import { makeBox } from "../lib/presets";
import type { SiteDoc } from "../lib/types";

// 公開のエンドポイントは模擬する。これらのテストは、GitHub に決して書き込まない。
test("Netlify connection errors stay readable on mobile and can be retried", async ({ page }) => {
  await page.route("**/api/publish?*", async route => {
    await route.fulfill({ json: {
      provider: "netlify", configured: true, unset: null, previewEnabled: true,
      production: { repo: null, branch: "main", url: null, error: null },
      test: { repo: null, branch: "preview", url: null, error: null },
    } });
  });
  let failures = 0;
  await page.route("**/api/publish/netlify/operations", async route => {
    failures++;
    await route.fulfill({ status: 502, json: { error: "Netlify request failed (HTTP 503)." } });
  });
  await page.addInitScript(() => {
    localStorage.setItem("tsumu-help-seen-v1", "1");
    localStorage.setItem("tsumu-netlify-account-v1", JSON.stringify({
      token: "browser-token-1234567890", userId: "user-12345678", email: "visitor@example.test",
    }));
  });
  const response = await page.request.post("/api/sites", { data: { name: "Netlify connection error" } });
  expect(response.ok()).toBeTruthy();
  const { site } = await response.json();
  await page.setViewportSize({ width: 375, height: 700 });
  await page.goto(`/sites/${site.id}`);
  await expect(page.locator('[data-tutorial="canvas"]').getByText("見出しをここに").first()).toBeVisible();
  await page.locator('[data-tutorial="publish"]').click();
  const modal = page.locator(".netlify-pub-modal");
  await expect(modal.getByRole("alert")).toContainText("Netlifyへのリクエストが完了しませんでした");
  const close = modal.getByRole("button", { name: "閉じる", exact: true });
  const connect = modal.getByRole("button", { name: "Netlifyに接続", exact: true });
  const retry = modal.getByRole("button", { name: "再試行", exact: true });
  await expect(close).toBeVisible();
  await expect(connect).toBeVisible();
  await expect(retry).toBeVisible();
  const dialogBox = await modal.boundingBox();
  expect(dialogBox).not.toBeNull();
  for (const button of [close, connect, retry]) {
    const box = await button.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(dialogBox!.x);
    expect(box!.x + box!.width).toBeLessThanOrEqual(dialogBox!.x + dialogBox!.width);
  }
  await retry.click();
  await expect.poll(() => failures).toBe(2);
  await expect(modal.getByRole("alert")).toContainText("Netlifyへのリクエストが完了しませんでした");
  await close.click();
  await expect(modal).toHaveCount(0);
});

test("Netlify publishes generated ZIP to the selected team and reuses the project", async ({ page }) => {
  await page.route("**/api/publish?*", async route => {
    await route.fulfill({ json: {
      provider: "netlify", configured: true, unset: null, previewEnabled: true,
      production: { repo: null, branch: "main", url: null, error: null },
      test: { repo: null, branch: "preview", url: null, error: null },
    } });
  });
  let created = 0;
  let deployed = 0;
  const projectId = "project-12345678";
  const teamId = "team-12345678";
  await page.route("**/api/publish/netlify/operations", async route => {
    const body = route.request().postDataJSON();
    expect(body.token).toBe("browser-token-1234567890");
    if (body.action === "account") {
      await route.fulfill({ json: {
        user: { id: "user-12345678", email: "visitor@example.test" },
        teams: [{ id: teamId, slug: "visitor-team", name: "Visitor team" }],
      } });
    } else if (body.action === "create") {
      created++;
      expect(body).toMatchObject({ target: "production", teamSlug: "visitor-team" });
      await route.fulfill({ json: { id: projectId, url: "https://visitor-site.netlify.app", teamId } });
    } else {
      await route.fulfill({ status: 400, json: { error: "Unexpected Netlify operation" } });
    }
  });
  await page.route("**/api/publish/netlify/deploy", async route => {
    deployed++;
    const headers = route.request().headers();
    expect(headers["content-type"]).toBe("application/zip");
    expect(headers["x-netlify-access-token"]).toBe("browser-token-1234567890");
    expect(headers["x-netlify-project-id"]).toBe(projectId);
    expect(headers["x-netlify-team-id"]).toBe(teamId);
    const archive = route.request().postDataBuffer();
    expect(archive).not.toBeNull();
    expect(archive!.subarray(0, 2).toString()).toBe("PK");
    await route.fulfill({ json: {
      provider: "netlify", id: "deploy-12345678", state: "ready",
      deploymentUrl: "https://deploy-12345678--visitor-site.netlify.app",
      siteUrl: "https://visitor-site.netlify.app",
    } });
  });
  await page.addInitScript(() => {
    localStorage.setItem("tsumu-help-seen-v1", "1");
    localStorage.setItem("tsumu-netlify-account-v1", JSON.stringify({
      token: "browser-token-1234567890", userId: "user-12345678", email: "visitor@example.test",
    }));
  });
  const response = await page.request.post("/api/sites", { data: { name: "Netlify production flow" } });
  expect(response.ok()).toBeTruthy();
  const { site } = await response.json();
  await page.goto(`/sites/${site.id}`);
  await expect(page.locator('[data-tutorial="canvas"]').getByText("見出しをここに").first()).toBeVisible();
  for (let count = 1; count <= 2; count++) {
    await page.locator('[data-tutorial="publish"]').click();
    const modal = page.locator(".netlify-pub-modal");
    await expect(modal.getByRole("button", { name: "本番に公開" })).toBeVisible();
    await modal.getByRole("button", { name: "本番に公開" }).click();
    await expect(modal).toContainText("Netlifyへのデプロイを受け付けました");
    await expect(modal.getByRole("link", { name: "サイトを開く" })).toHaveAttribute("href", "https://visitor-site.netlify.app");
    await modal.getByRole("button", { name: "閉じる", exact: true }).click();
    await expect(modal).toHaveCount(0);
    expect(created).toBe(1);
    expect(deployed).toBe(count);
  }
});

test("Publish controls stay hidden until GitHub configuration resolves across token, repo, error, and configured states", async ({ page }) => {
  let releaseConfig: (() => void) | undefined;
  const releaseGate = () => releaseConfig?.();
  let currentState: "token" | "repo" | "error" | "configured" = "token";
  let publishRequests = 0;
  await page.route("**/api/publish?*", async (route) => {
    if (route.request().method() !== "GET") {
      publishRequests++;
      await route.fulfill({ status: 500, json: { error: "Unexpected publish request" } });
      return;
    }
    const state = currentState;
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

  const modal = page.locator(".pub-modal");
  for (const state of ["token", "repo", "error", "configured"] as const) {
    releaseConfig = undefined;
    currentState = state;
    await page.locator('[data-tutorial="publish"]').click();
    await expect(modal).toBeVisible();
    await expect.poll(() => Boolean(releaseConfig)).toBe(true);
    await expect(modal.getByRole("status")).toContainText("公開先を確認しています");
    await expect(modal.locator(".pub-export-options")).toHaveCount(0);
    await expect(modal.locator(".pub-cards")).toHaveCount(0);
    await expect(modal.locator(".modal-desc")).toHaveCount(0);

    releaseGate();
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
    if (state === "error") await page.keyboard.press("Escape");
    else await modal.getByRole("button", { name: "閉じる", exact: true }).click();
    await expect(modal).toHaveCount(0);
  }
  expect(publishRequests).toBe(0);
});

test("GitHub Push publishes the selected Vue file tree, not the Next.js tree", async ({ page }) => {
  const messages: Array<{ action: string; site?: string; exportOptions?: { framework: string; language: string; style: string }; files?: Record<string, string>; path?: string }> = [];
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

test("A delayed test-publish history response does not contaminate production history or rollback targets", async ({ page }) => {
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
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(page.getByText("latest-production commit", { exact: false })).toBeVisible();
  await expect(page.getByText("preview commit", { exact: false })).toHaveCount(0);
  await page.getByRole("button", { name: "サイトを戻す", exact: true }).click();
  await page.getByRole("button", { name: "この版に戻す", exact: true }).click();
  await expect.poll(() => rollbacks).toEqual([{ site: site.id, target: "production", sha: "latest-production-old", expectedHead: "latest-production-head", expected: { site: site.id, target: "production", repo: "example/site", branch: "main", productionBranch: "main" } }]);
  await expect.poll(() => production.length).toBe(3);
  await respond(production[2], commits("after-rollback"));
  await expect(page.getByText("ロールバックしました", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

for (const drift of ["destination", "head"] as const) {
  test(`${drift} drift fails closed, then reopening requires a fresh plan and confirmation`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    const old = "a".repeat(40), fresh = "b".repeat(40);
    let head = old;
    let branch = "main";
    const requests: any[] = [];
    let configurations = 0;
    await page.route("**/api/publish**", async route => {
      if (route.request().method() === "GET") {
        configurations++;
        await route.fulfill({ json: { configured: true, previewEnabled: true,
          production: { repo: "example/site", branch, url: null, error: null },
          test: { repo: "example/site", branch: "preview", url: null, error: null },
        } });
        return;
      }
      const body = route.request().postDataJSON(); requests.push(body);
      if (body.action === "tree") {
        await route.fulfill({ json: { head, blobs: { "app/page.tsx": "manual-edit" }, manifest: {}, generated: {} } });
      } else if (body.action === "upload") {
        await route.fulfill({ json: { sha: "asset".padEnd(40, "0") } });
      } else if (body.expected?.branch !== branch || body.expectedHead !== head) {
        await route.fulfill({ status: 409, json: { error: "公開先の設定か内容が変わりました。この画面を閉じて開き直し、公開先と変更の内容を確認してから、もう一度試してください" } });
      } else {
        await route.fulfill({ json: { commitUrl: "https://example.com/commit" } });
      }
    });
    await page.addInitScript(() => localStorage.setItem("tsumu-help-seen-v1", "1"));
    const response = await page.request.post("/api/sites", { data: { name: "Publish preconditions" } });
    expect(response.ok()).toBeTruthy();
    const { site } = await response.json();
    await page.goto(`/sites/${site.id}`);
    await expect(page.locator('[data-tutorial="canvas"]').getByText("見出しをここに").first()).toBeVisible();
    await page.locator('[data-tutorial="publish"]').click();
    await page.getByRole("button", { name: "本番に公開", exact: true }).click();
    await expect(page.getByText("GitHub上の変更を上書きしますか？", { exact: true })).toBeVisible();
    if (drift === "destination") branch = "release";
    else head = fresh;
    await page.getByRole("button", { name: "上書きして公開", exact: true }).click();
    await expect(page.locator(".pub-modal")).toContainText("公開先の設定か内容が変わりました");
    await expect(page.getByRole("button", { name: "再試行", exact: true })).toBeDisabled();
    expect(requests.filter(r => r.action === "commit")).toHaveLength(1);
    expect(requests.find(r => r.action === "commit")).toMatchObject({ site: site.id, expectedHead: old, expected: { branch: "main", site: site.id } });
    await page.getByRole("button", { name: "閉じる", exact: true }).click();
    await page.locator('[data-tutorial="publish"]').click();
    await expect(page.locator(".pub-card.is-prod")).toContainText(branch);
    expect(configurations).toBe(2);
    await page.getByRole("button", { name: "本番に公開", exact: true }).click();
    await expect(page.getByText("GitHub上の変更を上書きしますか？", { exact: true })).toBeVisible();
    expect(requests.filter(r => r.action === "commit")).toHaveLength(1);
    await page.getByRole("button", { name: "上書きして公開", exact: true }).click();
    await expect(page.locator(".pub-modal")).toContainText("GitHubへPushしました");
    expect(requests.filter(r => r.action === "commit")).toHaveLength(2);
    expect(requests.filter(r => r.action === "commit")[1]).toMatchObject({ expectedHead: head, expected: { branch, productionBranch: branch } });
    expect(errors).toEqual([]);
  });

  test(`rollback ${drift} conflict clears stale history and requires reopening and reconfirmation`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    const originalHead = "a".repeat(40), advancedHead = "b".repeat(40);
    const originalVersion = "c".repeat(40), freshVersion = "d".repeat(40);
    let head = originalHead;
    let branch = "main";
    let changed = false;
    let succeeded = false;
    const rollbacks: any[] = [];
    const historyReads: { expected: any; head: string }[] = [];
    const conflictMessage = "公開先の設定か内容が変わりました。この画面を閉じて開き直し、公開先と変更の内容を確認してから、もう一度試してください";
    await page.route("**/api/publish**", async route => {
      const url = new URL(route.request().url());
      if (!url.pathname.endsWith("/history")) {
        expect(route.request().method()).toBe("GET");
        await route.fulfill({ json: { configured: true, previewEnabled: true,
          production: { repo: "example/site", branch, url: null, error: null },
          test: { repo: "example/site", branch: "preview", url: null, error: null },
        } });
        return;
      }
      if (route.request().method() === "GET") {
        const expected = JSON.parse(url.searchParams.get("expected") ?? "null");
        historyReads.push({ expected, head });
        if (expected?.branch !== branch) {
          await route.fulfill({ status: 409, json: { error: conflictMessage } });
          return;
        }
        await route.fulfill({ json: { head, commits: [{
          sha: changed ? freshVersion : originalVersion,
          message: succeeded ? "Confirmed rollback" : changed ? "Fresh history version" : "Stale history version",
          date: changed ? "2026-11-02T00:00:00Z" : "2026-11-01T00:00:00Z",
          url: "https://example.com/commit",
        }] } });
        return;
      }
      const body = route.request().postDataJSON();
      rollbacks.push(body);
      if (body.expected?.branch !== branch || body.expectedHead !== head) {
        await route.fulfill({ status: 409, json: { error: conflictMessage } });
      } else {
        succeeded = true;
        await route.fulfill({ json: { ok: true, commitUrl: "https://example.com/rollback" } });
      }
    });
    await page.addInitScript(() => localStorage.setItem("tsumu-help-seen-v1", "1"));
    const response = await page.request.post("/api/sites", { data: { name: `Rollback ${drift} conflict` } });
    expect(response.ok()).toBeTruthy();
    const { site } = await response.json();
    await page.goto(`/sites/${site.id}`);
    await expect(page.locator('[data-tutorial="canvas"]').getByText("見出しをここに").first()).toBeVisible();
    const openHistory = async () => {
      await page.locator('[data-tutorial="publish"]').click();
      await page.getByRole("button", { name: "公開履歴・ロールバック", exact: true }).click();
    };
    await openHistory();
    await expect(page.getByText("Stale history version", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "サイトを戻す", exact: true }).click();
    const confirmation = page.getByRole("dialog", { name: "公開したサイトをこの版に戻しますか？" });
    await expect(confirmation).toBeVisible();
    expect(rollbacks).toHaveLength(0);
    changed = true;
    if (drift === "destination") branch = "release";
    else head = advancedHead;
    await confirmation.getByRole("button", { name: "この版に戻す", exact: true }).click();
    const failure = page.getByRole("alertdialog", { name: "ロールバックできませんでした" });
    await expect(failure).toBeVisible();
    await expect(failure).toContainText(conflictMessage);
    await expect(page.getByRole("alertdialog", { name: "ロールバックしました", exact: true })).toHaveCount(0);
    await expect(page.locator(".hist-modal .hist-list")).toHaveCount(0);
    await expect(page.locator(".hist-modal")).toContainText(conflictMessage);
    expect(rollbacks).toHaveLength(1);
    expect(rollbacks[0]).toMatchObject({ sha: originalVersion, expectedHead: originalHead,
      expected: { site: site.id, target: "production", branch: "main", productionBranch: "main" } });
    expect(succeeded).toBe(false);
    expect(historyReads).toHaveLength(1);
    await failure.getByRole("button", { name: "OK", exact: true }).click();
    await page.locator(".hist-modal").getByRole("button", { name: "閉じる", exact: true }).click();

    await openHistory();
    await expect(page.getByText("Fresh history version", { exact: false })).toBeVisible();
    await expect(page.getByText("Stale history version", { exact: false })).toHaveCount(0);
    expect(historyReads).toHaveLength(2);
    expect(historyReads[1]).toMatchObject({ head, expected: { branch, productionBranch: branch } });
    expect(rollbacks).toHaveLength(1);
    await page.getByRole("button", { name: "サイトを戻す", exact: true }).click();
    await expect(confirmation).toBeVisible();
    expect(rollbacks).toHaveLength(1);
    await confirmation.getByRole("button", { name: "キャンセル", exact: true }).click();
    await expect(confirmation).toHaveCount(0);
    expect(rollbacks).toHaveLength(1);
    await page.getByRole("button", { name: "サイトを戻す", exact: true }).click();
    await confirmation.getByRole("button", { name: "この版に戻す", exact: true }).click();
    await expect(page.getByRole("alertdialog", { name: "ロールバックしました", exact: true })).toBeVisible();
    expect(rollbacks).toHaveLength(2);
    expect(rollbacks[1]).toMatchObject({ sha: freshVersion, expectedHead: head,
      expected: { site: site.id, target: "production", branch, productionBranch: branch } });
    expect(succeeded).toBe(true);
    expect(historyReads).toHaveLength(3);
    expect(errors).toEqual([]);
  });
}
