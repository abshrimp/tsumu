import { expect, test, type Page, type Route } from "@playwright/test";
import { previewRefreshDoc, previewRows } from "../tests/helpers/preview-refresh";

async function setup(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem("tsumu-help-seen-v1", "1"));
  const response = await page.request.post("/api/sites", { data: { name: "Preview refresh ordering" } });
  expect(response.ok()).toBeTruthy();
  const { site } = await response.json();
  const endpoint = `/api/doc?site=${site.id}`;
  expect((await page.request.put(endpoint, { data: previewRefreshDoc() })).ok()).toBeTruthy();
  const requests: Route[] = [];
  await page.route("**/api/fetch-json", (route) => { requests.push(route); });
  await page.goto(`/sites/${site.id}`);
  await expect(page.getByText("サーバー保存済み")).toBeVisible();
  const saved = (await (await page.request.get(endpoint)).json()).doc;
  await page.getByRole("button", { name: "プレビュー", exact: true }).click();
  await expect.poll(() => requests.length).toBe(1);
  const canvas = page.locator('[data-tutorial="canvas"]');
  return {
    canvas, requests,
    async finish(index: number, label: string, length = 30, status = 200) {
      const settled = page.waitForEvent("requestfinished", (request) => request === requests[index].request());
      await requests[index].fulfill({ status, contentType: "application/json", body: JSON.stringify({ json: previewRows(label, length) }) });
      await settled;
      // 古い応答を返した直後の、まだ更新前の画面を成功と誤判定しない。
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    },
    async unchanged() {
      expect((await (await page.request.get(endpoint)).json()).doc).toEqual(saved);
      expect(errors).toEqual([]);
    },
  };
}

for (const order of ["newest-first", "oldest-first"] as const) {
  test(`preview form submission keeps the latest response and busy indicator (${order})`, async ({ page }) => {
    const { canvas, requests, finish, unchanged } = await setup(page);
    await canvas.locator('[data-node="query"]').fill("new search");
    await canvas.getByRole("button", { name: "Search", exact: true }).click();
    await expect.poll(() => requests.length).toBe(2);
    expect(new URL(requests[1].request().postDataJSON().url).searchParams.get("q")).toBe("new search");
    if (order === "newest-first") {
      await finish(1, "new", 35);
      await expect(canvas.locator('[data-node="result"]')).toHaveText("new: 35");
      await finish(0, "old", 50);
    } else {
      await finish(0, "old", 50);
      await expect(canvas.getByRole("button", { name: "読み込み中…", exact: true })).toBeDisabled();
      await expect(canvas.locator('[data-node="result"]')).toHaveText("home saved: 1");
      await finish(1, "new", 35);
    }
    await expect(canvas.locator('[data-node="result"]')).toHaveText("new: 35");
    await expect(canvas.getByRole("button", { name: "読み込み直す", exact: true })).toBeEnabled();
    await unchanged();
  });
}

test("restarting preview ignores the previous session's delayed response", async ({ page }) => {
  const { canvas, requests, finish, unchanged } = await setup(page);
  await page.getByRole("button", { name: "デザイン", exact: true }).click();
  await expect(canvas.getByRole("button", { name: "読み込み直す", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "プレビュー", exact: true }).click();
  await expect.poll(() => requests.length).toBe(2);
  await finish(1, "current session", 37);
  await expect(canvas.locator('[data-node="result"]')).toHaveText("current session: 37");
  await finish(0, "abandoned session", 51);
  await expect(canvas.locator('[data-node="result"]')).toHaveText("current session: 37");
  await unchanged();
});

test("preview links keep page visits independent when an earlier request finishes last", async ({ page }) => {
  const { canvas, requests, finish, unchanged } = await setup(page);
  await canvas.getByText("Open other", { exact: true }).click();
  await expect.poll(() => requests.length).toBe(2);
  await finish(1, "other page", 28);
  await expect(canvas.locator('[data-node="other-result"]')).toHaveText("other page: 28");
  await canvas.getByText("Go back", { exact: true }).click();
  await expect.poll(() => requests.length).toBe(3);
  await finish(2, "returned home", 36);
  await expect(canvas.locator('[data-node="result"]')).toHaveText("returned home: 36");
  await finish(0, "previous home", 53);
  await expect(canvas.locator('[data-node="result"]')).toHaveText("returned home: 36");
  await unchanged();
});

test("a failed latest refresh retains its saved fallback without accepting an older success", async ({ page }) => {
  const { canvas, requests, finish, unchanged } = await setup(page);
  await canvas.getByRole("button", { name: "Search", exact: true }).click();
  await expect.poll(() => requests.length).toBe(2);
  await finish(1, "failed", 0, 502);
  await expect(canvas.getByRole("button", { name: "読み込み直す", exact: true })).toBeEnabled();
  await finish(0, "obsolete success", 54);
  await expect(canvas.locator('[data-node="result"]')).toHaveText("home saved: 1");
  await canvas.getByRole("button", { name: "Search", exact: true }).click();
  await expect.poll(() => requests.length).toBe(3);
  await finish(2, "retry", 32);
  await expect(canvas.locator('[data-node="result"]')).toHaveText("retry: 32");
  await unchanged();
});
