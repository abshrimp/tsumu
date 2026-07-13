import { expect, test, type Page } from "@playwright/test";

async function openSite(page: Page) {
  await page.addInitScript(() => localStorage.setItem("tsumu-help-seen-v1", "1"));
  const created = await page.request.post("/api/sites", { data: { name: "Comment response order" } });
  expect(created.ok()).toBeTruthy();
  const { site } = await created.json();
  await page.goto(`/sites/${site.id}`);
  await expect(page.getByText("サーバー保存済み")).toBeVisible();
  return site.id as string;
}
function deferred() { let resolve!: () => void; const promise = new Promise<void>((r) => { resolve = r; }); return { promise, resolve }; }

// Hold the real server response, not a synthetic replacement list. POST still reaches the disposable test database.
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
    await expect(page.locator(".cm-item-body")).toHaveText("Newly saved comment");
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
