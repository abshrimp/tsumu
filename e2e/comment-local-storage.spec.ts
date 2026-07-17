import { expect, test, type Page } from "@playwright/test";

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
  test(`ブラウザ保存の${failure}失敗で投稿の入力を消さず、復旧後に保存できる`, async ({ page }) => {
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
  test(`保存失敗で${operation}の入力と既存コメントを保ち、同じ入力で再試行できる`, async ({ page }) => {
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
  test(`保存失敗でスレッドの${operation}を成功扱いしない`, async ({ page }) => {
    const key = await openSite(page);
    await seedComment(page);
    const before = await saved(page, key);
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

test("定期読み込みが失敗しても既存コメントと返信の下書きを消さない", async ({ page }) => {
  const key = await openSite(page);
  await seedComment(page);
  const before = await saved(page, key);
  const reply = page.locator(".cm-detail").getByPlaceholder("返信", { exact: true });
  await reply.fill("Unsent draft during refresh");
  await setFailure(page, "read");
  await expect(error(page)).toHaveText("コメントを読み込めませんでした", { timeout: 20_000 });
  await expect(page.locator(".cm-detail .cm-msg-body")).toHaveText("Saved comment");
  await expect(reply).toHaveValue("Unsent draft during refresh");
  expect(await saved(page, key)).toBe(before);
});
