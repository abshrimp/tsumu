import { expect, test } from "@playwright/test";
import { createInitialDoc } from "../lib/presets";
import { applyCommentAction } from "../lib/comments";
import { emptyDest } from "../lib/site";
import { setBrowserDoc } from "./helpers/browser-doc";

for (const draft of ["create", "reply", "edit"] as const) test(`deleting a local site in Home preserves the stale editor's ${draft} text`, async ({ page: home, context }) => {
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
  await home.evaluate(({ site, doc, key, threads }) => {
    localStorage.setItem("tsumu-sites-v1", JSON.stringify([site]));
    localStorage.setItem(key, JSON.stringify(threads));
  }, { site, doc, key, threads });
  await setBrowserDoc(home, site.id, JSON.stringify(doc));
  await home.reload(); await expect(home.locator(".home-card-name")).toHaveText(site.name);
  const editor = await context.newPage();
  await editor.goto(`/sites/${site.id}`);
  await editor.getByRole("button", { name: "コメント", exact: true }).click();
  await expect(editor.locator(".cm-item")).toHaveCount(1);
  if (draft === "create") await editor.locator(".cm-catcher").click({ position: { x: 120, y: 120 } });
  else {
    await editor.locator(".cm-item").click();
    if (draft === "edit") {
      await editor.getByRole("button", { name: "コメントの操作", exact: true }).click();
      await editor.getByText("コメントを編集", { exact: true }).click();
    }
  }
  const detail = editor.getByRole("region", { name: "コメントの詳細", exact: true });
  const input = detail.getByPlaceholder(draft === "create" ? "コメントを書く" : draft === "reply" ? "返信" : "コメント", { exact: true });
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
  await editor.bringToFront();
  if (draft === "create") await detail.getByRole("button", { name: "投稿", exact: true }).click();
  else await expect(detail.getByRole("alert")).toContainText("このスレッドは削除されています", { timeout: 20_000 });
  await expect(editor.locator(".cm-panel .is-error")).toHaveText("サイトが見つかりません");
  await expect(input).toHaveValue("Keep this unsent text for copying");
  await expect(editor).toHaveURL(new RegExp(`/sites/${site.id}$`));
  await expect(editor.locator(".cm-item")).toHaveCount(0);
  await expect(editor.locator(".cm-pin:not(.is-draft)")).toHaveCount(0);
  expect(await editor.evaluate(key => localStorage.getItem(key), key)).toBeNull();
  // 削除したサイトへの再投稿に失敗しても、入力は読んだりコピーしたりできるように残す。
  await input.selectText();
  expect(await input.evaluate(el => (el as HTMLTextAreaElement).selectionEnd - (el as HTMLTextAreaElement).selectionStart)).toBe("Keep this unsent text for copying".length);
});
