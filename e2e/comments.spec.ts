import { expect, test, type Page } from "@playwright/test";
import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { commentTargetDoc } from "../tests/helpers/comment-targets";

const detail = (page: Page) => page.getByRole("region", { name: "コメントの詳細", exact: true });
function deferred() { let resolve!: () => void; const promise = new Promise<void>((r) => { resolve = r; }); return { promise, resolve }; }

test.describe("comment response ordering", () => {
  async function openSite(page: Page) {
    await page.addInitScript(() => localStorage.setItem("tsumu-help-seen-v1", "1"));
    const created = await page.request.post("/api/sites", { data: { name: "Comment response order" } });
    expect(created.ok()).toBeTruthy();
    const { site } = await created.json();
    await page.goto(`/sites/${site.id}`);
    await expect(page.getByText("サーバー保存済み")).toBeVisible();
    return site.id as string;
  }

  // 作った代わりの一覧ではなく、実際のサーバーの応答を止めておく。POST は、使い捨てのテスト用のデータベースにそのまま届く。
  test("an old initial comment response cannot remove a posted thread or its unfinished reply", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const id = await openSite(page);
    const captured = deferred(); const release = deferred(); const delivered = deferred();
    let first = true;
    await page.route("**/api/comments?*", async (route) => {
      if (route.request().method() !== "GET" || !first) return route.continue();
      first = false;
      const response = await route.fetch();
      captured.resolve();
      await release.promise;
      await route.fulfill({ response });
      delivered.resolve();
    });
    try {
      await page.getByRole("button", { name: "コメント", exact: true }).click();
      await captured.promise;
      await page.locator(".cm-catcher").click({ position: { x: 120, y: 120 } });
      await page.getByPlaceholder("コメントを書く", { exact: true }).fill("Newly saved comment");
      await page.getByRole("button", { name: "投稿", exact: true }).click();
      await expect(page.locator(".cm-detail .cm-msg-body")).toHaveText("Newly saved comment");
      const reply = page.locator(".cm-detail").getByPlaceholder("返信", { exact: true });
      await reply.fill("Unsent reply draft");
      release.resolve();
      await delivered.promise;
      await expect(reply).toHaveValue("Unsent reply draft");
      await page.locator(".cm-detail").getByRole("button", { name: "一覧に戻る", exact: true }).click();
      await expect(page.locator(".cm-item-body")).toHaveText("Newly saved comment");
      await page.locator(".cm-item").click();
      await expect(reply).toHaveValue("Unsent reply draft");
      const stored = await (await page.request.get(`/api/comments?site=${id}`)).json();
      expect(stored.threads).toHaveLength(1);
      expect(stored.threads[0].messages).toHaveLength(1);
      await page.locator(".cm-detail").getByRole("button", { name: "返信", exact: true }).click();
      await expect(page.locator(".cm-detail .cm-msg-body")).toHaveText(["Newly saved comment", "Unsent reply draft"]);
      expect(errors).toEqual([]);
    } finally { release.resolve(); }
  });

  test("a delayed refresh cannot resurrect a successfully deleted thread", async ({ page }) => {
    const id = await openSite(page);
    const doc = await (await page.request.get(`/api/doc?site=${id}`)).json();
    const created = await page.request.post(`/api/comments?site=${id}`, { data: {
      action: "create", id: "delete-thread", pageId: doc.doc.pageOrder[0], nodeId: null,
      x: .2, y: .2, bp: "base", body: "Delete this thread",
    } });
    expect(created.ok()).toBeTruthy();
    await page.getByRole("button", { name: "コメント", exact: true }).click();
    await expect(page.locator(".cm-item-body")).toHaveText("Delete this thread");
    await page.getByRole("button", { name: "コメントモードを終える", exact: true }).click();
    const captured = deferred(); const release = deferred(); const delivered = deferred();
    let first = true;
    await page.route("**/api/comments?*", async (route) => {
      if (route.request().method() !== "GET" || !first) return route.continue();
      first = false;
      const response = await route.fetch(); captured.resolve();
      await release.promise;
      await route.fulfill({ response }); delivered.resolve();
    });
    try {
      await page.getByRole("button", { name: "コメント", exact: true }).click();
      await captured.promise;
      await page.locator(".cm-item").click();
      await page.getByRole("button", { name: "スレッドを削除", exact: true }).click();
      await page.locator(".modal-backdrop").getByRole("button", { name: "削除", exact: true }).click();
      await expect(page.locator(".cm-item")).toHaveCount(0);
      release.resolve(); await delivered.promise;
      await expect(page.locator(".cm-item")).toHaveCount(0);
      expect((await (await page.request.get(`/api/comments?site=${id}`)).json()).threads).toEqual([]);
    } finally { release.resolve(); }
  });
});

test.describe("comment composer and pin visibility", () => {
  async function openSite(page: Page, seeded = true) {
    await page.addInitScript(() => localStorage.setItem("tsumu-help-seen-v1", "1"));
    const created = await page.request.post("/api/sites", { data: { name: "Comment composer lifecycle" } });
    expect(created.ok()).toBeTruthy(); const { site } = await created.json();
    // 新しく作ったサイトの文書は、エディタが最初の保存を終えてから読む。
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
      // 送信が始まった後、実際のコメントの API へのリクエストの直前に、別のタブがサイトを削除した状況を再現する。
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
    expect((await page.request.get(`/api/comments?site=${site}`)).status()).toBe(404);
  });

  test("Escape reply preservation, oversized comment rejection, and pin visibility toggle work on one site", async ({ page }) => {
    const site = await openSite(page);
    const pins = page.locator(".cm-pin:not(.is-draft)");
    await expect(pins).toHaveCount(1);

    // 1. Escape closes a reply discussion without discarding its draft
    const reply = detail(page).getByPlaceholder("返信", { exact: true });
    await reply.fill("Keep this reply draft");
    await reply.dispatchEvent("keydown", { key: "Escape", isComposing: true });
    await expect(reply).toHaveValue("Keep this reply draft");
    await reply.press("Escape");
    await expect(detail(page)).toHaveCount(0);
    await expect(page.locator(".cm-panel")).toBeVisible();

    // 2. Comment pins can be hidden with the panel toggle or while holding Alt
    const hide = page.getByRole("button", { name: "ピンを隠す", exact: true });
    await hide.click();
    await expect(pins).toHaveCount(0);
    const show = page.getByRole("button", { name: "ピンを表示", exact: true });
    await expect(show).toHaveAttribute("aria-pressed", "true");
    // 一覧もスレッドも隠れない。
    await expect(page.locator(".cm-item")).toHaveCount(1);
    await show.click();
    await expect(pins).toHaveCount(1);
    await page.keyboard.down("Alt");
    await expect(pins).toHaveCount(0);
    await page.keyboard.up("Alt");
    await expect(pins).toHaveCount(1);

    // Reopen thread and verify reply draft survived
    await page.locator(".cm-item").click();
    await expect(reply).toHaveValue("Keep this reply draft");
    expect((await (await page.request.get(`/api/comments?site=${site}`)).json()).threads[0].messages).toHaveLength(1);

    // 3. Oversized comments stay editable and are rejected without silently truncating
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
});

test.describe("comment pagination", () => {
  async function openLargeSite(page: Page, count = 1001) {
    await page.addInitScript(() => localStorage.setItem("tsumu-help-seen-v1", "1"));
    const created = await page.request.post("/api/sites", { data: { name: "Comment pagination" } });
    expect(created.ok()).toBeTruthy();
    const { site } = await created.json();
    const current = await (await page.request.get(`/api/doc?site=${site.id}`)).json();
    expect((await page.request.put(`/api/doc?site=${site.id}${current.rev ? `&base=${current.rev}` : ""}`, { data: commentTargetDoc() })).ok()).toBeTruthy();
    // playwright.config.ts で設定した使い捨てのデータベースにだけ、初期のデータを入れる。API の読み取りと UI での変更は、すべて実際のものを使う。
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

  test("1001 comments remain reachable, paging preserves reply and new-comment drafts, and the 1002nd thread opens after posting", async ({ page }) => {
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
    // ページの間を移動しても、スレッドを開き直したときに、書きかけの返信が残っている。
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
    await detail(page).getByRole("button", { name: "未解決に戻す", exact: true }).click();
    await expect(detail(page).getByRole("button", { name: "解決済みにする", exact: true })).toBeVisible();
    await detail(page).getByRole("button", { name: "一覧に戻る", exact: true }).click();
    await expect(page.locator(".cm-pagination")).toContainText("全1001件中1000件");

    // 同じ 1001 件のサイトで、新しいコメントの下書きがページ移動後も残り、1002 件目として開くことを確かめる。
    await page.getByRole("button", { name: "古い一覧", exact: true }).click();
    await expect(page.locator(".cm-item-body")).toHaveText("Discussion 0");
    await page.locator(".cm-catcher").click({ position: { x: 120, y: 120 } });
    const input = detail(page).getByPlaceholder("コメントを書く", { exact: true });
    await input.fill("New discussion after 1001");
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
    const afterPost = await (await page.request.get(`/api/comments?site=${site}`)).json();
    expect(afterPost.total).toBe(1002); expect(afterPost.threads[0].messages[0].body).toBe("New discussion after 1001");
    expect(errors).toEqual([]);
  });

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
});
