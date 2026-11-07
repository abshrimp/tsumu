import { expect, test } from "@playwright/test";

// Official CI runs native browser coverage; all publication requests are mocked.
// No GitHub publication or real hosting update occurs.
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
      await route.fulfill({ json: { sha: "asset" } });
    } else if (body.expected?.branch !== branch || body.expectedHead !== head) {
      await route.fulfill({ status: 409, json: { error: "公開先の設定または内容が変更されました。画面を閉じて開き直し、公開先と変更内容を確認してから、もう一度お試しください" } });
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
  // Exercise each guard independently: the other precondition stays unchanged.
  if (drift === "destination") branch = "release";
  else head = fresh;
  await page.getByRole("button", { name: "上書きして公開", exact: true }).click();
  await expect(page.locator(".pub-modal")).toContainText("公開先の設定または内容が変更されました");
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
}

for (const drift of ["destination", "head"] as const) {
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
    const conflictMessage = "公開先の設定または内容が変更されました。画面を閉じて開き直し、公開先と変更内容を確認してから、もう一度お試しください";
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
    const confirmation = page.getByRole("dialog", { name: "公開サイトをこの版に戻しますか？" });
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
    // Cancel proves merely reopening or choosing a fresh version cannot publish.
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
