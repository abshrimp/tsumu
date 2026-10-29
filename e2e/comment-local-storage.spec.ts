import { expect, test, type Page } from "@playwright/test";
import { createInitialDoc } from "../lib/presets";
import { applyCommentAction } from "../lib/comments";
import { emptyDest } from "../lib/site";
import { setBrowserDoc } from "./helpers/browser-doc";

async function openSite(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("tsumu-help-seen-v1", "1");
    const get = Storage.prototype.getItem;
    const set = Storage.prototype.setItem;
    const control = { failure: "none", read: (key: string) => get.call(localStorage, key) };
    (window as any).commentStorage = control;
    Storage.prototype.getItem = function (key) {
      if (key.startsWith("tsumu-comments-v1:") && control.failure === "read") throw new DOMException("Blocked", "SecurityError");
      return get.call(this, key);
    };
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith("tsumu-comments-v1:") && control.failure === "write") throw new DOMException("Full", "QuotaExceededError");
      return set.call(this, key, value);
    };
  });
  await page.route("**/api/comments?*", route => route.fulfill({ status: 503, contentType: "application/json", body: "{}" }));
  const created = await page.request.post("/api/sites", { data: { name: "Local comment storage" } });
  expect(created.ok()).toBeTruthy();
  const { site } = await created.json();
  await page.goto(`/sites/${site.id}`);
  await expect(page.getByText("サーバー保存済み")).toBeVisible();
  return `tsumu-comments-v1:${site.id}`;
}

const setFailure = (page: Page, failure: string) => page.evaluate(f => { (window as any).commentStorage.failure = f; }, failure);
const saved = (page: Page, key: string) => page.evaluate(k => (window as any).commentStorage.read(k), key);
const error = (page: Page) => page.locator(".cm-panel .is-error");

async function startComment(page: Page) {
  await page.getByRole("button", { name: "コメント", exact: true }).click();
  await page.locator(".cm-catcher").click({ position: { x: 120, y: 120 } });
}

async function seedComment(page: Page) {
  await startComment(page);
  await page.getByPlaceholder("コメントを書く", { exact: true }).fill("Saved comment");
  await page.getByRole("button", { name: "投稿", exact: true }).click();
  await expect(page.locator(".cm-detail .cm-msg-body")).toHaveText("Saved comment");
}

for (const failure of ["write", "read", "invalid"]) {
  test(`An ${failure} browser-storage failure preserves the post draft and allows saving after recovery`, async ({ page }) => {
    const key = await openSite(page);
    if (failure === "invalid") await page.evaluate(k => localStorage.setItem(k, "{broken"), key);
    else await setFailure(page, failure);
    await startComment(page);
    const input = page.getByPlaceholder("コメントを書く", { exact: true });
    await input.fill("Keep this unsent comment");
    await page.getByRole("button", { name: "投稿", exact: true }).click();
    await expect(error(page)).toHaveText("コメントを保存できませんでした");
    await expect(input).toHaveValue("Keep this unsent comment");
    await expect(page.locator(".cm-item")).toHaveCount(0);
    expect(await saved(page, key)).toBe(failure === "invalid" ? "{broken" : null);
    await setFailure(page, "none");
    if (failure === "invalid") await page.evaluate(k => localStorage.setItem(k, "[]"), key);
    await page.getByRole("button", { name: "投稿", exact: true }).click();
    await expect(page.locator(".cm-detail .cm-msg-body")).toHaveText("Keep this unsent comment");
    await expect(error(page)).toHaveCount(0);
    expect(JSON.parse(await saved(page, key))[0].messages[0].body).toBe("Keep this unsent comment");
    await page.reload();
    await expect(page.getByText("サーバー保存済み")).toBeVisible();
    await page.getByRole("button", { name: "コメント", exact: true }).click();
    await expect(page.locator(".cm-item-body")).toHaveText("Keep this unsent comment");
  });
}

for (const operation of ["reply", "edit"]) {
  test(`An ${operation} save failure preserves the draft and existing comments and allows retrying with the same input`, async ({ page }) => {
    const key = await openSite(page);
    await seedComment(page);
    const before = await saved(page, key);
    if (operation === "edit") {
      await page.getByRole("button", { name: "コメントの操作", exact: true }).click();
      await page.getByText("コメントを編集", { exact: true }).click();
    }
    const input = page.locator(".cm-detail").getByPlaceholder(operation === "edit" ? "コメント" : "返信", { exact: true });
    const submit = page.locator(".cm-detail").getByRole("button", { name: operation === "edit" ? "保存" : "返信", exact: true });
    await input.fill("Keep my changed text");
    await setFailure(page, "write");
    await submit.click();
    await expect(error(page)).toHaveText("コメントを保存できませんでした");
    await expect(input).toHaveValue("Keep my changed text");
    expect(await saved(page, key)).toBe(before);
    await setFailure(page, "none");
    await submit.click();
    await expect(page.locator(".cm-detail .cm-msg-body")).toHaveText(operation === "edit" ? ["Keep my changed text"] : ["Saved comment", "Keep my changed text"]);
    await expect(error(page)).toHaveCount(0);
    expect(JSON.parse(await saved(page, key))[0].messages.at(-1).body).toBe("Keep my changed text");
  });
}

for (const operation of ["delete", "resolve"]) {
  test(`A failed thread ${operation} operation (and polling on resolve) is not reported as successful`, async ({ page }) => {
    const key = await openSite(page);
    await seedComment(page);
    const before = await saved(page, key);
    if (operation === "resolve") {
      const reply = page.locator(".cm-detail").getByPlaceholder("返信", { exact: true });
      await reply.fill("Unsent draft during refresh");
      await setFailure(page, "read");
      // タブに戻ると、次の定期的な読み込みを待たずに読み込み直す。
      await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
      await expect(error(page)).toHaveText("コメントを読み込めませんでした");
      await expect(page.locator(".cm-detail .cm-msg-body")).toHaveText("Saved comment");
      await expect(reply).toHaveValue("Unsent draft during refresh");
      expect(await saved(page, key)).toBe(before);
    }
    await setFailure(page, "write");
    const perform = async () => {
      await page.getByRole("button", { name: operation === "delete" ? "スレッドを削除" : "解決済みにする", exact: true }).click();
      if (operation === "delete") await page.getByRole("dialog").getByRole("button", { name: "削除", exact: true }).click();
    };
    await perform();
    await expect(error(page)).toHaveText("コメントを保存できませんでした");
    await expect(page.locator(".cm-detail .cm-msg-body")).toHaveText("Saved comment");
    expect(await saved(page, key)).toBe(before);
    await setFailure(page, "none");
    await perform();
    if (operation === "resolve") await page.getByRole("button", { name: "一覧に戻る", exact: true }).click();
    await expect(page.locator(".cm-item")).toHaveCount(0);
    const stored = JSON.parse(await saved(page, key));
    if (operation === "delete") expect(stored).toEqual([]);
    else expect(stored[0].resolvedAt).toBeGreaterThan(0);
  });
}

for (const draft of ["create", "reply"] as const) test(`deleting a local site in Home preserves the stale editor's ${draft} text`, async ({ page: home, context }) => {
  const site = { ...emptyDest(), id: "local-deletion", name: "Local deletion", createdAt: 1, updatedAt: 1 };
  const key = `tsumu-comments-v1:${site.id}`;
  const marker = `tsumu-site-deleted-v1:${site.id}`;
  // サーバーの保存先は設定しないまま、実際のホームとエディタを使う。
  await context.route("**/api/**", route => {
    const path = new URL(route.request().url()).pathname;
    if (/^\/api\/(sites(?:\/.*)?|doc|comments|collab\/.*)$/.test(path)) return route.fulfill({ status: 503, json: {} });
    return route.continue();
  });
  await context.addInitScript(() => {
    localStorage.setItem("tsumu-help-seen-v1", "1");
    localStorage.setItem("tsumu-lang", "ja");
  });
  await home.goto("/");
  const doc = createInitialDoc(); doc.siteName = site.name;
  const threads = applyCommentAction([], { action: "create", id: "original", pageId: doc.pageOrder[0],
    nodeId: null, x: .5, y: .5, bp: "base", body: "Saved browser discussion" }, null, 1);
  await home.evaluate(({ site, key, threads }) => {
    localStorage.setItem("tsumu-sites-v1", JSON.stringify([site]));
    localStorage.setItem(key, JSON.stringify(threads));
  }, { site, key, threads });
  await setBrowserDoc(home, site.id, JSON.stringify(doc));
  await home.reload(); await expect(home.locator(".home-card-name")).toHaveText(site.name);
  const editor = await context.newPage();
  await editor.goto(`/sites/${site.id}`);
  await editor.getByRole("button", { name: "コメント", exact: true }).click();
  await expect(editor.locator(".cm-item")).toHaveCount(1);
  if (draft === "create") await editor.locator(".cm-catcher").click({ position: { x: 120, y: 120 } });
  else await editor.locator(".cm-item").click();
  const detail = editor.getByRole("region", { name: "コメントの詳細", exact: true });
  const input = detail.getByPlaceholder(draft === "create" ? "コメントを書く" : "返信", { exact: true });
  await input.fill("Keep this unsent text for copying");
  if (draft === "create") await home.evaluate(() => {
    const write = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "tsumu-sites-v1") throw new DOMException("List compaction failed", "QuotaExceededError");
      write.call(this, key, value);
    };
  });
  await home.getByRole("button", { name: "サイトの操作", exact: true }).click();
  await home.getByRole("menuitem", { name: "削除", exact: true }).click();
  await home.locator(".dialog-input").fill(site.name);
  await home.getByRole("dialog").getByRole("button", { name: "削除", exact: true }).click();
  await expect(home.locator(".home-card")).toHaveCount(0);
  expect(await home.evaluate(({ key, marker }) => ({ comments: localStorage.getItem(key), marker: localStorage.getItem(marker) }), { key, marker }))
    .toEqual({ comments: null, marker: "1" });
  await home.reload(); await expect(home.locator(".home-card")).toHaveCount(0);
  // ヘッドレスのブラウザーではタブの切り替えが伝わらないため、タブに戻ったことを知らせる。
  await editor.bringToFront(); await editor.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  if (draft === "create") await detail.getByRole("button", { name: "投稿", exact: true }).click();
  else await expect(detail.getByRole("alert")).toContainText("このスレッドは削除されています");
  await expect(editor.locator(".cm-panel .is-error")).toHaveText("サイトが見つかりません");
  await expect(input).toHaveValue("Keep this unsent text for copying");
  await expect.poll(() => editor.evaluate(() => window.location.pathname)).toBe(`/sites/${site.id}`);
  await expect(editor.locator(".cm-item")).toHaveCount(0);
  await expect(editor.locator(".cm-pin:not(.is-draft)")).toHaveCount(0);
  expect(await editor.evaluate(key => localStorage.getItem(key), key)).toBeNull();
  // 削除したサイトへの再投稿に失敗しても、入力は読んだりコピーしたりできるように残す。
  await input.selectText();
  expect(await input.evaluate(el => (el as HTMLTextAreaElement).selectionEnd - (el as HTMLTextAreaElement).selectionStart)).toBe("Keep this unsent text for copying".length);
});
