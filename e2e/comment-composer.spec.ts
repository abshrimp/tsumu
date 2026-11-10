import { expect, test, type Page } from "@playwright/test";

async function openSite(page: Page, seeded = true) {
  await page.addInitScript(() => localStorage.setItem("tsumu-help-seen-v1", "1"));
  const created = await page.request.post("/api/sites", { data: { name: "Comment composer lifecycle" } });
  expect(created.ok()).toBeTruthy(); const { site } = await created.json();
  // Read a newly created site's document only after the editor finishes its initial save.
  await page.goto(`/sites/${site.id}`); await expect(page.getByText("サーバー保存済み")).toBeVisible();
  const saved = await page.request.get(`/api/doc?site=${site.id}`); expect(saved.ok()).toBeTruthy();
  const { doc } = await saved.json(); expect(doc).toBeDefined();
  if (seeded) expect((await page.request.post(`/api/comments?site=${site.id}`, { data: {
    action: "create", id: `composer_${site.id}`, pageId: doc.pageOrder[0], nodeId: null, x: .5, y: .5, bp: "base", body: "Original discussion",
  } })).ok()).toBeTruthy();
  await page.getByRole("button", { name: "コメント", exact: true }).click();
  if (seeded) await page.locator(".cm-item").click();
  return site.id as string;
}
const detail = (page: Page) => page.getByRole("region", { name: "コメントの詳細", exact: true });
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }

for (const success of [true, false]) test(`a pending reply stays readable but not editable, and ${success ? "clears after success" : "retains text after failure"}`, async ({ page }) => {
  await openSite(page); const captured = deferred(); const release = deferred();
  await page.route("**/api/comments?*", async route => {
    if (route.request().method() !== "POST") return route.continue();
    const response = success ? await route.fetch() : null; captured.resolve(); await release.promise;
    if (response) await route.fulfill({ response }); else await route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: "Save failed" }) });
  });
  try {
    const reply = detail(page).getByPlaceholder("返信", { exact: true }); await reply.fill("Pending reply");
    await detail(page).getByRole("button", { name: "返信", exact: true }).click(); await captured.promise;
    await expect(reply).toHaveAttribute("readonly", "");
    await reply.focus(); await page.keyboard.type("must not replace the pending reply");
    await expect(reply).toHaveValue("Pending reply");
    release.resolve();
    await expect(reply).not.toHaveAttribute("readonly", "");
    await expect(reply).toHaveValue(success ? "" : "Pending reply");
    await reply.fill("Next reply draft"); await expect(reply).toHaveValue("Next reply draft");
  } finally { release.resolve(); }
});

test("cancel and reopen an edit while saving retains the new editing session", async ({ page }) => {
  await openSite(page); const captured = deferred(); const release = deferred(); const delivered = deferred(); let first = true;
  await page.route("**/api/comments?*", async route => {
    if (route.request().method() !== "POST" || !first) return route.continue();
    first = false; const response = await route.fetch(); captured.resolve(); await release.promise;
    await route.fulfill({ response }); delivered.resolve();
  });
  const edit = async () => {
    await detail(page).getByRole("button", { name: "コメントの操作", exact: true }).click();
    await page.getByText("コメントを編集", { exact: true }).click();
  };
  try {
    await edit(); await detail(page).getByPlaceholder("コメント", { exact: true }).fill("First saved edit");
    await detail(page).getByRole("button", { name: "保存", exact: true }).click(); await captured.promise;
    await detail(page).getByRole("button", { name: "キャンセル", exact: true }).click();
    await edit(); const editor = detail(page).getByPlaceholder("コメント", { exact: true }); await editor.fill("New unsent edit");
    release.resolve(); await delivered.promise;
    await expect(editor).toHaveValue("New unsent edit");
    await detail(page).getByRole("button", { name: "保存", exact: true }).click();
    await expect(detail(page).locator(".cm-msg-body")).toHaveText("New unsent edit");
  } finally { release.resolve(); }
});

test("IME Escape and modified Enter do not cancel or submit a new comment draft", async ({ page }) => {
  const site = await openSite(page, false);
  await page.locator(".cm-catcher").click({ position: { x: 120, y: 120 } });
  const input = detail(page).getByPlaceholder("コメントを書く", { exact: true }); await input.fill("日本語の下書き");
  await input.dispatchEvent("keydown", { key: "Escape", isComposing: true });
  await expect(input).toHaveValue("日本語の下書き");
  await input.dispatchEvent("keydown", { key: "Enter", ctrlKey: true, isComposing: true });
  await expect(input).toHaveValue("日本語の下書き");
  expect((await (await page.request.get(`/api/comments?site=${site}`)).json()).threads).toHaveLength(0);
  await input.press("Escape"); await expect(input).toHaveCount(0);
  await page.locator(".cm-catcher").click({ position: { x: 120, y: 120 } });
  await expect(input).toHaveValue("");
});

test("a site deleted while posting a new discussion keeps the unsent text", async ({ page }) => {
  const site = await openSite(page, false);
  await page.locator(".cm-catcher").click({ position: { x: 120, y: 120 } });
  const input = detail(page).getByPlaceholder("コメントを書く", { exact: true });
  await input.fill("Keep this unsent new comment");
  await page.route("**/api/comments?*", async route => {
    if (route.request().method() !== "POST") return route.continue();
    // After submission begins, simulate another tab deleting the site just before the actual comments API request.
    expect((await page.request.delete(`/api/sites/${site}`)).ok()).toBeTruthy();
    await route.continue();
  });
  const failed = page.waitForResponse(response => response.url().includes("/api/comments?") && response.request().method() === "POST");
  await detail(page).getByRole("button", { name: "投稿", exact: true }).click();
  const response = await failed;
  expect(response.status()).toBe(404);
  expect((await response.json()).code).toBe("comment_site_missing");
  await expect(input).toHaveValue("Keep this unsent new comment");
  await expect(input).not.toHaveAttribute("readonly", "");
  await expect(page.getByText("サイトが見つかりません", { exact: true })).toBeVisible();
  expect((await page.request.get(`/api/sites/${site}`)).status()).toBe(404);
  expect((await (await page.request.get(`/api/comments?site=${site}`)).json()).threads).toHaveLength(0);
});


test("oversized comments stay editable and are rejected without silently truncating", async ({ page }) => {
  const site = await openSite(page); const reply = detail(page).getByPlaceholder("返信", { exact: true });
  const long = "x".repeat(5001); await reply.fill(long);
  await expect(detail(page).getByRole("alert")).toContainText("5000文字以内");
  await expect(detail(page).getByRole("button", { name: "返信", exact: true })).toBeDisabled();
  await expect(reply).toHaveValue(long);
  const rejected = await page.request.post(`/api/comments?site=${site}`, { data: { action: "reply", threadId: `composer_${site}`, id: `too_long_${site}`, body: long } });
  expect(rejected.status()).toBe(400);
  expect((await (await page.request.get(`/api/comments?site=${site}`)).json()).threads[0].messages).toHaveLength(1);
  await reply.fill(long.slice(0, 5000)); await detail(page).getByRole("button", { name: "返信", exact: true }).click();
  await expect(reply).toHaveValue("");
  const stored = await (await page.request.get(`/api/comments?site=${site}`)).json();
  expect(stored.threads[0].messages[1].body).toHaveLength(5000);
});


test("Escape closes a reply discussion without discarding its draft", async ({ page }) => {
  const site = await openSite(page);
  const reply = detail(page).getByPlaceholder("返信", { exact: true });
  await reply.fill("Keep this reply draft");
  await reply.dispatchEvent("keydown", { key: "Escape", isComposing: true });
  await expect(reply).toHaveValue("Keep this reply draft");
  await reply.press("Escape");
  await expect(detail(page)).toHaveCount(0);
  await expect(page.locator(".cm-panel")).toBeVisible();
  await page.locator(".cm-item").click();
  await expect(reply).toHaveValue("Keep this reply draft");
  const stored = await (await page.request.get(`/api/comments?site=${site}`)).json();
  expect(stored.threads[0].messages).toHaveLength(1);
});
