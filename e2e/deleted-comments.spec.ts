import { expect, test, type Page } from "@playwright/test";
import { applyCommentAction, type CommentAction } from "../lib/comments";
import { commentTargetDoc } from "../tests/helpers/comment-targets";
import type { SiteDoc } from "../lib/types";

const detail = (page: Page) => page.getByRole("region", { name: "コメントの詳細", exact: true });

test.describe("deleted comment targets", () => {
  async function saveDoc(page: Page, site: string, doc: SiteDoc) {
    const api = `/api/doc?site=${site}`;
    const current = await (await page.request.get(api)).json();
    const saved = await page.request.put(`${api}${current.rev ? `&base=${current.rev}` : ""}`, { data: doc });
    expect(saved.ok()).toBeTruthy();
  }
  async function openSite(page: Page, seed = true) {
    await page.addInitScript(() => localStorage.setItem("tsumu-help-seen-v1", "1"));
    const created = await page.request.post("/api/sites", { data: { name: "Deleted comment targets" } });
    expect(created.ok()).toBeTruthy();
    const { site } = await created.json();
    const doc = commentTargetDoc();
    const threadId = `discussion_${site.id}`;
    await saveDoc(page, site.id, doc);
    if (seed) expect((await page.request.post(`/api/comments?site=${site.id}`, { data: {
      action: "create", id: threadId, pageId: "p", nodeId: "target", x: .5, y: .5, bp: "base", body: "Original discussion",
    } })).ok()).toBeTruthy();
    const connected = page.waitForRequest(request => request.url().includes("/api/collab/events"));
    await page.goto(`/sites/${site.id}`);
    await expect(page.getByText("サーバー保存済み")).toBeVisible();
    await connected;
    await page.getByRole("button", { name: "コメント", exact: true }).click();
    if (seed) await page.locator(".cm-item").filter({ hasText: "Original discussion" }).click();
    return { site: site.id as string, doc, threadId };
  }

  for (const target of ["element", "page"] as const) test(`remote ${target} deletion retains the open reply, full discussion and resolve controls after reload`, async ({ page }) => {
    const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
    const { site, doc } = await openSite(page);
    const input = detail(page).getByPlaceholder("返信", { exact: true });
    await input.fill("Reply typed before deletion");
    // 別のクライアントが、実際の文書の API に書き込む。エディタは、通常の共同編集の更新として受け取らなければならない。
    const deleted = structuredClone(doc);
    delete deleted.nodes.parent; delete deleted.nodes.target;
    if (target === "page") { delete deleted.pages.p; deleted.pageOrder = ["q"]; }
    else deleted.pages.p.children = [];
    await saveDoc(page, site, deleted);
    await expect(detail(page).getByRole("status")).toContainText(target === "page" ? "対象のページは削除されています" : "対象の要素は削除されています", { timeout: 20_000 });
    await expect(input).toHaveValue("Reply typed before deletion");
    await expect(detail(page).locator(".cm-msg-body")).toHaveText("Original discussion");
    await expect(page.locator(".cm-pin:not(.is-draft)")).toHaveCount(0);
    // 一覧に戻っても、対象が削除されたコメントが見つかり、書きかけの返信も残っている。
    await detail(page).getByRole("button", { name: "一覧に戻る", exact: true }).click();
    if (target === "page") {
      await expect(page.locator(".cm-item")).toHaveCount(0);
      await page.locator(".cm-list-notice").click();
    }
    await expect(page.locator(".cm-item-meta")).toContainText(target === "page" ? "削除されたページ" : "削除された要素");
    await page.locator(".cm-item").click();
    await expect(input).toHaveValue("Reply typed before deletion");
    await detail(page).getByRole("button", { name: "返信", exact: true }).click();
    await expect(detail(page).locator(".cm-msg-body")).toHaveText(["Original discussion", "Reply typed before deletion"]);
    await detail(page).getByRole("button", { name: "解決済みにする", exact: true }).click();
    await detail(page).getByRole("button", { name: "一覧に戻る", exact: true }).click();
    await expect(page.locator(".cm-item")).toHaveCount(0);
    await page.getByLabel("解決済みも表示", { exact: true }).check();
    await page.locator(".cm-item").click();
    await detail(page).getByRole("button", { name: "未解決に戻す", exact: true }).click();
    await detail(page).getByRole("button", { name: "一覧に戻る", exact: true }).click();
    await page.getByLabel("解決済みも表示", { exact: true }).uncheck();
    await expect(page.locator(".cm-item")).toHaveCount(1);
    const stored = await (await page.request.get(`/api/comments?site=${site}`)).json();
    expect(stored.threads[0].nodeId).toBe("target"); expect(stored.threads[0].pageId).toBe("p");
    expect(stored.threads[0].resolvedAt).toBeNull(); expect(stored.threads[0].messages).toHaveLength(2);
    await page.reload(); await expect(page.getByText("サーバー保存済み")).toBeVisible();
    await page.getByRole("button", { name: "コメント", exact: true }).click();
    if (target === "page") await page.getByRole("button", { name: "すべてのページ", exact: true }).click();
    await page.locator(".cm-item").click();
    await expect(detail(page).locator(".cm-msg-body")).toHaveText(["Original discussion", "Reply typed before deletion"]);
    expect(errors).toEqual([]);
  });

  test("local subtree delete, undo and redo retain comment identity and do not mistake responsive hiding for deletion", async ({ page }) => {
    const { site, doc, threadId } = await openSite(page);
    await page.locator('[data-tutorial="layers-panel"] .layer-name').filter({ hasText: /^Comment parent$/ }).click();
    await page.keyboard.press("Delete");
    await expect(detail(page).getByRole("status")).toContainText("対象の要素は削除されています");
    await page.getByRole("button", { name: "元に戻す", exact: true }).click();
    await expect(page.locator(".cm-pin:not(.is-draft)")).toHaveCount(1);
    await expect(detail(page).getByRole("status")).toHaveCount(0);
    await page.getByRole("button", { name: "やり直す", exact: true }).click();
    await expect(detail(page).getByRole("status")).toContainText("対象の要素は削除されています");
    await page.getByRole("button", { name: "元に戻す", exact: true }).click();
    await expect(page.locator(".cm-pin:not(.is-draft)")).toHaveCount(1);
    await expect(page.getByText("サーバー保存済み")).toBeVisible();
    await expect.poll(async () => (await (await page.request.get(`/api/doc?site=${site}`)).json()).doc.nodes).toEqual(doc.nodes);
    const hidden = structuredClone(doc); hidden.nodes.parent.hiddenOn = ["sm"];
    await saveDoc(page, site, hidden);
    await page.locator('[data-tutorial="breakpoint-sm"]').click();
    await expect(detail(page).getByRole("status")).toHaveText("対象の要素はこの画面幅では非表示です。", { timeout: 20_000 });
    await expect(page.locator(".cm-pin:not(.is-draft)")).toHaveCount(0);
    // あるブレークポイントで非表示になっているだけの対象を、削除されたものとして扱ってはならない。
    await detail(page).getByRole("button", { name: "一覧に戻る", exact: true }).click();
    await expect(page.locator(".cm-item-meta")).toContainText("この画面幅では非表示");
    await expect(page.locator(".cm-item-place.is-deleted")).toHaveCount(0);
    await page.locator(".cm-item").click();
    await expect(detail(page).locator(".cm-msg-body")).toHaveText("Original discussion");
    const stored = await (await page.request.get(`/api/comments?site=${site}`)).json();
    expect(stored.threads).toHaveLength(1); expect(stored.threads[0].id).toBe(threadId);
    expect(stored.threads[0].resolvedAt).toBeNull();
  });

  test("a new comment draft survives remote target deletion without becoming a page comment", async ({ page }) => {
    const { site, doc } = await openSite(page, false);
    const node = await page.locator('.cv-root [data-node="target"]').boundingBox();
    const catcher = page.locator(".cm-catcher"); const box = await catcher.boundingBox();
    expect(node).not.toBeNull(); expect(box).not.toBeNull();
    await catcher.click({ position: { x: node!.x + node!.width / 2 - box!.x, y: node!.y + node!.height / 2 - box!.y } });
    const input = detail(page).getByPlaceholder("コメントを書く", { exact: true });
    await input.fill("Draft before the page disappeared");
    const deleted = structuredClone(doc); delete deleted.pages.p; deleted.pageOrder = ["q"];
    delete deleted.nodes.parent; delete deleted.nodes.target;
    await saveDoc(page, site, deleted);
    await expect(detail(page).getByRole("status")).toContainText("対象のページは削除されています", { timeout: 20_000 });
    await expect(input).toHaveValue("Draft before the page disappeared");
    await detail(page).getByRole("button", { name: "投稿", exact: true }).click();
    await expect(detail(page).locator(".cm-msg-body")).toHaveText("Draft before the page disappeared");
    const stored = await (await page.request.get(`/api/comments?site=${site}`)).json();
    expect(stored.threads[0].pageId).toBe("p"); expect(stored.threads[0].nodeId).toBe("target");
  });
});

test.describe("deleted comment threads", () => {
  async function openSite(page: Page, local = false) {
    await page.addInitScript(() => localStorage.setItem("tsumu-help-seen-v1", "1"));
    if (local) await page.route("**/api/comments?*", route => route.fulfill({ status: 503, contentType: "application/json", body: "{}" }));
    const created = await page.request.post("/api/sites", { data: { name: "Deleted discussion drafts" } });
    expect(created.ok()).toBeTruthy(); const { site } = await created.json();
    await page.goto(`/sites/${site.id}`); await expect(page.getByText("サーバー保存済み")).toBeVisible();
    const current = await page.request.get(`/api/doc?site=${site.id}`); expect(current.ok()).toBeTruthy();
    const { doc } = await current.json(); expect(doc).toBeDefined();
    const id = `gone_${site.id}`; const key = `tsumu-comments-v1:${site.id}`;
    const action: CommentAction = { action: "create", id, pageId: doc.pageOrder[0], nodeId: null, x: .5, y: .5, bp: "base", body: "Original discussion" };
    if (local) await page.evaluate(({ key, threads }) => localStorage.setItem(key, JSON.stringify(threads)), { key, threads: applyCommentAction([], action, null) });
    else expect((await page.request.post(`/api/comments?site=${site.id}`, { data: action })).ok()).toBeTruthy();
    await page.getByRole("button", { name: "コメント", exact: true }).click(); await page.locator(".cm-item").click();
    return { site: site.id as string, id, key };
  }
  const deletedWarning = (page: Page) => detail(page).getByRole("alert");
  function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }

  for (const local of [false, true]) test(`${local ? "local" : "server"} polling retains an unsent reply after another client deletes its discussion`, async ({ page }) => {
    const { site, id, key } = await openSite(page, local);
    const reply = detail(page).getByPlaceholder("返信", { exact: true }); await reply.fill("Keep this unsent reply");
    if (local) await page.evaluate(key => localStorage.setItem(key, "[]"), key);
    else expect((await page.request.post(`/api/comments?site=${site}`, { data: { action: "delete-thread", threadId: id } })).ok()).toBeTruthy();
    // タブに戻ると、次の定期的な読み込みを待たずに読み込み直す。
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect(deletedWarning(page)).toContainText("このスレッドは削除されています");
    await expect(reply).toHaveValue("Keep this unsent reply");
    await expect(detail(page).getByRole("button", { name: "返信", exact: true })).toBeDisabled();
    await expect(detail(page).getByRole("button", { name: "解決済みにする", exact: true })).toBeDisabled();
    await expect(page.locator(".cm-item")).toHaveCount(0);
    await expect(detail(page).locator(".cm-msg-body")).toHaveText("Original discussion");
    await detail(page).getByRole("button", { name: "一覧に戻る", exact: true }).click(); await expect(detail(page)).toHaveCount(0);
    if (local) expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe("[]");
    else expect((await (await page.request.get(`/api/comments?site=${site}`)).json()).threads).toEqual([]);
  });

  test("a reply racing with discussion deletion reports failure and preserves its text through polling", async ({ page }) => {
    const { site, id } = await openSite(page); const captured = deferred(); const release = deferred();
    await page.route("**/api/comments?*", async route => {
      if (route.request().method() !== "POST" || route.request().postDataJSON()?.action !== "reply") return route.continue();
      captured.resolve(); await release.promise; await route.continue();
    });
    try {
      const reply = detail(page).getByPlaceholder("返信", { exact: true }); await reply.fill("Never report this as saved");
      const response = page.waitForResponse(response => response.url().includes("/api/comments?") && response.request().method() === "POST");
      await detail(page).getByRole("button", { name: "返信", exact: true }).click(); await captured.promise;
      expect((await page.request.post(`/api/comments?site=${site}`, { data: { action: "delete-thread", threadId: id } })).ok()).toBeTruthy();
      release.resolve(); expect((await response).status()).toBe(404);
      await expect(deletedWarning(page)).toContainText("このスレッドは削除されています");
      await expect(reply).toHaveValue("Never report this as saved");
      await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
      await expect(page.locator(".cm-item")).toHaveCount(0);
      await expect(reply).toHaveValue("Never report this as saved");
      expect((await (await page.request.get(`/api/comments?site=${site}`)).json()).threads).toEqual([]);
    } finally { release.resolve(); }
  });

  test("explicitly deleting the final message still closes its own discussion", async ({ page }) => {
    const { site } = await openSite(page);
    await detail(page).getByRole("button", { name: "コメントの操作", exact: true }).click();
    await page.locator(".ctx-menu").getByText("削除", { exact: true }).click();
    await page.locator(".modal-backdrop").getByRole("button", { name: "削除", exact: true }).click();
    await expect(detail(page)).toHaveCount(0); await expect(page.locator(".cm-item")).toHaveCount(0);
    expect((await (await page.request.get(`/api/comments?site=${site}`)).json()).threads).toEqual([]);
  });

  test("deleting a message closes the thread when a concurrent deletion made it the last one", async ({ page }) => {
    const { site, id } = await openSite(page); const extraId = `extra_${site}`;
    expect((await page.request.post(`/api/comments?site=${site}`, { data: { action: "reply", threadId: id, id: extraId, body: "Other message" } })).ok()).toBeTruthy();
    await page.reload(); await expect(page.getByText("サーバー保存済み")).toBeVisible();
    await page.getByRole("button", { name: "コメント", exact: true }).click(); await page.locator(".cm-item").click();
    await expect(detail(page).locator(".cm-msg")).toHaveCount(2);
    await detail(page).locator(".cm-msg").first().getByRole("button", { name: "コメントの操作", exact: true }).click();
    await page.locator(".ctx-menu").getByText("削除", { exact: true }).click();
    expect((await page.request.post(`/api/comments?site=${site}`, { data: { action: "delete-message", messageId: extraId } })).ok()).toBeTruthy();
    await page.locator(".modal-backdrop").getByRole("button", { name: "削除", exact: true }).click();
    await expect(detail(page)).toHaveCount(0); await expect(page.locator(".cm-item")).toHaveCount(0);
  });

  test("a reply ID collision keeps the draft and live discussion available for a successful retry", async ({ page }) => {
    const { site, id } = await openSite(page);
    const collisionId = `collision_${site}`;
    const original = { action: "reply", threadId: id, id: collisionId, body: "Already saved reply" };
    expect((await page.request.post(`/api/comments?site=${site}`, { data: original })).ok()).toBeTruthy();
    let collide = true;
    await page.route("**/api/comments?*", async route => {
      const request = route.request();
      if (request.method() !== "POST" || request.postDataJSON()?.action !== "reply" || !collide) return route.continue();
      collide = false;
      await route.continue({ postData: JSON.stringify({ ...request.postDataJSON(), id: collisionId }) });
    });
    const reply = detail(page).getByPlaceholder("返信", { exact: true });
    const submit = detail(page).getByRole("button", { name: "返信", exact: true });
    await reply.fill("Keep this unsent reply");
    const failed = page.waitForResponse(response => response.url().includes("/api/comments?") && response.request().method() === "POST");
    await submit.click(); expect((await failed).status()).toBe(409);
    await expect(reply).toHaveValue("Keep this unsent reply"); await expect(submit).toBeEnabled();
    await expect(deletedWarning(page)).toHaveCount(0);
    await expect(detail(page).getByRole("button", { name: "解決済みにする", exact: true })).toBeEnabled();
    await expect(detail(page).locator(".cm-msg-body").first()).toHaveText("Original discussion");
    const before = await (await page.request.get(`/api/comments?site=${site}`)).json();
    expect(before.threads[0].messages.map((m: { body: string }) => m.body)).toEqual(["Original discussion", "Already saved reply"]);
    const saved = page.waitForResponse(response => response.url().includes("/api/comments?") && response.request().method() === "POST");
    await submit.click(); expect((await saved).status()).toBe(200);
    await expect(reply).toHaveValue("");
    await expect(detail(page).locator(".cm-msg-body")).toHaveText(["Original discussion", "Already saved reply", "Keep this unsent reply"]);
  });
});
