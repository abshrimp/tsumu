import { expect, test, type Page } from "@playwright/test";
import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { commentTargetDoc } from "../tests/helpers/comment-targets";

async function openLargeSite(page: Page, count = 1001) {
  await page.addInitScript(() => localStorage.setItem("tsumu-help-seen-v1", "1"));
  const created = await page.request.post("/api/sites", { data: { name: "Comment pagination" } });
  expect(created.ok()).toBeTruthy();
  const { site } = await created.json();
  const current = await (await page.request.get(`/api/doc?site=${site.id}`)).json();
  expect((await page.request.put(`/api/doc?site=${site.id}${current.rev ? `&base=${current.rev}` : ""}`, { data: commentTargetDoc() })).ok()).toBeTruthy();
  // Seed only the disposable database configured in playwright.config.ts. API reads and every UI mutation remain real.
  const db = new DatabaseSync(resolve(".e2e-data/tsumu.db"));
  const id = (n: number) => `paged_${site.id}_${String(n).padStart(4, "0")}`;
  try {
    db.exec("PRAGMA busy_timeout = 5000; BEGIN IMMEDIATE");
    const thread = db.prepare("INSERT INTO comment_threads (id, site_id, page_id, node_id, x, y, bp, created_at, updated_at) VALUES (?, ?, 'p', 'target', .5, .5, 'base', ?, ?)");
    const message = db.prepare("INSERT INTO comment_messages (id, thread_id, site_id, email, name, image, body, at) VALUES (?, ?, ?, '', NULL, NULL, ?, ?)");
    for (let i = 0; i < count; i++) {
      thread.run(id(i), site.id, i + 1, i + 1);
      message.run(`${id(i)}-0`, id(i), site.id, `Discussion ${i}`, i + 1);
    }
    db.exec("COMMIT");
  } finally { db.close(); }
  await page.goto(`/sites/${site.id}`);
  await expect(page.getByText("サーバー保存済み")).toBeVisible();
  await page.getByRole("button", { name: "コメント", exact: true }).click();
  await expect(page.locator(".cm-item")).toHaveCount(Math.min(count, 1000));
  return { site: site.id as string, id };
}
const detail = (page: Page) => page.getByRole("region", { name: "コメントの詳細", exact: true });

test("1001 comments remain reachable and paging preserves off-batch reply drafts and exact counts", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  const { site, id } = await openLargeSite(page);
  await page.locator(".cm-item").filter({ has: page.locator(".cm-item-body", { hasText: /^Discussion 1000$/ }) }).click();
  const reply = detail(page).getByPlaceholder("返信", { exact: true });
  await reply.fill("Reply across batches");
  await detail(page).getByRole("button", { name: "一覧に戻る", exact: true }).click();
  await page.getByRole("button", { name: "古い一覧", exact: true }).click();
  await expect(page.locator(".cm-item-body")).toHaveText("Discussion 0");
  await expect(page.locator(".cm-pagination")).toContainText("全1001件中1件");
  await expect(page.getByRole("button", { name: "新しい一覧", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "最新の一覧", exact: true }).click();
  // Navigating between pages preserves an unfinished reply when its thread is reopened.
  await page.locator(".cm-item").filter({ has: page.locator(".cm-item-body", { hasText: /^Discussion 1000$/ }) }).click();
  await expect(reply).toHaveValue("Reply across batches");
  await detail(page).getByRole("button", { name: "返信", exact: true }).click();
  await expect(detail(page).locator(".cm-msg-body")).toHaveText(["Discussion 1000", "Reply across batches"]);
  await detail(page).getByRole("button", { name: "解決済みにする", exact: true }).click();
  await expect(detail(page).getByRole("button", { name: "未解決に戻す", exact: true })).toBeVisible();
  const stored = await (await page.request.get(`/api/comments?site=${site}&focus=${id(1000)}`)).json();
  expect(stored.total).toBe(1001); expect(stored.unresolvedCount).toBe(1000);
  expect(stored.focusedThread.messages).toHaveLength(2);
  await expect(detail(page).locator(".cm-msg-body")).toHaveCount(2);
  await detail(page).getByRole("button", { name: "一覧に戻る", exact: true }).click();
  await expect(page.locator(".cm-pagination")).toContainText("全1001件中1000件");
  expect(errors).toEqual([]);
});

test("a new comment draft survives batch navigation and its 1002nd thread opens after posting", async ({ page }) => {
  const { site } = await openLargeSite(page);
  await page.getByRole("button", { name: "古い一覧", exact: true }).click();
  await expect(page.locator(".cm-item-body")).toHaveText("Discussion 0");
  await page.locator(".cm-catcher").click({ position: { x: 120, y: 120 } });
  const input = detail(page).getByPlaceholder("コメントを書く", { exact: true });
  await input.fill("New discussion after 1001");
  // Returning to the list and navigating between pages preserves a new comment draft.
  await detail(page).getByRole("button", { name: "一覧に戻る", exact: true }).click();
  await page.getByRole("button", { name: "最新の一覧", exact: true }).click();
  await page.getByRole("button", { name: "古い一覧", exact: true }).click();
  await expect(page.locator(".cm-item-body")).toHaveText("Discussion 0");
  await page.locator(".cm-catcher").click({ position: { x: 120, y: 120 } });
  await expect(input).toHaveValue("New discussion after 1001");
  await detail(page).getByRole("button", { name: "投稿", exact: true }).click();
  await expect(detail(page).locator(".cm-msg-body")).toHaveText("New discussion after 1001");
  await detail(page).getByRole("button", { name: "一覧に戻る", exact: true }).click();
  await expect(page.locator(".cm-pagination")).toContainText("全1002件中1000件");
  const stored = await (await page.request.get(`/api/comments?site=${site}`)).json();
  expect(stored.total).toBe(1002); expect(stored.threads[0].messages[0].body).toBe("New discussion after 1001");
});


function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }

test("finishing a delayed new comment does not replace a newer open reply draft", async ({ page }) => {
  const { site } = await openLargeSite(page, 2);
  const captured = deferred(); const release = deferred(); const delivered = deferred();
  await page.route("**/api/comments?*", async route => {
    if (route.request().method() !== "POST") return route.continue();
    const response = await route.fetch(); captured.resolve(); await release.promise;
    await route.fulfill({ response }); delivered.resolve();
  });
  try {
    await page.locator(".cm-catcher").click({ position: { x: 120, y: 120 } });
    await detail(page).getByPlaceholder("コメントを書く", { exact: true }).fill("Delayed new comment");
    await detail(page).getByRole("button", { name: "投稿", exact: true }).click(); await captured.promise;
    await detail(page).getByRole("button", { name: "一覧に戻る", exact: true }).click();
    await page.locator(".cm-item").filter({ has: page.locator(".cm-item-body", { hasText: /^Discussion 1$/ }) }).click();
    const reply = detail(page).getByPlaceholder("返信", { exact: true }); await reply.fill("Keep this newer reply draft");
    release.resolve(); await delivered.promise;
    await expect(detail(page).locator(".cm-msg-body")).toHaveText("Discussion 1");
    await expect(reply).toHaveValue("Keep this newer reply draft");
    expect((await (await page.request.get(`/api/comments?site=${site}`)).json()).total).toBe(3);
  } finally { release.resolve(); }
});
