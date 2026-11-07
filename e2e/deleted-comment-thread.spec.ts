import { expect, test, type Page } from "@playwright/test";
import { applyCommentAction, type CommentAction } from "../lib/comments";

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
const detail = (page: Page) => page.getByRole("region", { name: "コメントの詳細", exact: true });
const deletedWarning = (page: Page) => detail(page).getByRole("alert");
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }

for (const local of [false, true]) test(`${local ? "local" : "server"} polling retains an unsent reply after another client deletes its discussion`, async ({ page }) => {
  const { site, id, key } = await openSite(page, local);
  const reply = detail(page).getByPlaceholder("返信", { exact: true }); await reply.fill("Keep this unsent reply");
  if (local) await page.evaluate(key => localStorage.setItem(key, "[]"), key);
  else expect((await page.request.post(`/api/comments?site=${site}`, { data: { action: "delete-thread", threadId: id } })).ok()).toBeTruthy();
  await expect(deletedWarning(page)).toContainText("このスレッドは削除されています", { timeout: 20_000 });
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
    await expect(page.locator(".cm-item")).toHaveCount(0, { timeout: 20_000 });
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
