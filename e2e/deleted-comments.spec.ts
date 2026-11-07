import { expect, test, type Page } from "@playwright/test";
import { commentTargetDoc } from "../tests/helpers/comment-targets";
import type { SiteDoc } from "../lib/types";

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
const detail = (page: Page) => page.getByRole("region", { name: "コメントの詳細", exact: true });

for (const target of ["element", "page"] as const) test(`remote ${target} deletion retains the open reply, full discussion and resolve controls after reload`, async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  const { site, doc } = await openSite(page);
  const input = detail(page).getByPlaceholder("返信", { exact: true });
  await input.fill("Reply typed before deletion");
  // Another client writes the real document API. The editor must receive its normal collaboration update.
  const deleted = structuredClone(doc);
  delete deleted.nodes.parent; delete deleted.nodes.target;
  if (target === "page") { delete deleted.pages.p; deleted.pageOrder = ["q"]; }
  else deleted.pages.p.children = [];
  await saveDoc(page, site, deleted);
  await expect(detail(page).getByRole("status")).toContainText(target === "page" ? "対象のページは削除されています" : "対象の要素は削除されています", { timeout: 20_000 });
  await expect(input).toHaveValue("Reply typed before deletion");
  await expect(detail(page).locator(".cm-msg-body")).toHaveText("Original discussion");
  await expect(page.locator(".cm-pin:not(.is-draft)")).toHaveCount(0);
  // Returning to the list still finds deleted-target comments and retains unfinished replies.
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
  // A target hidden only at a breakpoint must not be treated as deleted.
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
