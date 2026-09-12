import { expect, test, type Page, type Route, type Request } from "@playwright/test";
import { previewRefreshDoc, previewRows } from "../tests/helpers/preview-refresh";

async function setup(page: Page, doc = previewRefreshDoc()) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem("tsumu-help-seen-v1", "1"));
  const response = await page.request.post("/api/sites", { data: { name: "Preview refresh ordering" } });
  expect(response.ok()).toBeTruthy();
  const { site } = await response.json();
  const endpoint = `/api/doc?site=${site.id}`;
  expect((await page.request.put(endpoint, { data: doc })).ok()).toBeTruthy();
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
      const request = requests[index].request();
      // 新しい更新は、古いリクエストを能動的に中断する。ブラウザでの結果がどちらでもルートは
      // 決着する。中断されたリクエストを、成功として待ってはならない。
      if (!request.failure()) {
        const settled = new Promise<void>((resolve) => {
          const done = (completed: Request) => {
            if (completed !== request) return;
            page.off("requestfinished", done);
            page.off("requestfailed", done);
            resolve();
          };
          page.on("requestfinished", done);
          page.on("requestfailed", done);
        });
        await requests[index].fulfill({ status, contentType: "application/json", body: JSON.stringify({ json: previewRows(label, length) }) });
        await settled;
      }
      // 古い応答が届いた直後の、まだ古いままの画面を、成功と取り違えない。
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


test("page navigation aborts the old fetch and starts with the destination field default", async ({ page }) => {
  const doc = previewRefreshDoc();
  doc.nodes["other-query"] = { ...structuredClone(doc.nodes.query), id: "other-query", field: { kind: "input", defaultValue: "other default" } };
  doc.pages.other.children.push("other-query");
  const { canvas, requests, finish, unchanged } = await setup(page, doc);
  await canvas.locator('[data-node="query"]').fill("old page input");
  await canvas.getByText("Open other", { exact: true }).click();
  await expect.poll(() => requests.length).toBe(2);
  await expect.poll(() => requests[0].request().failure()).not.toBeNull();
  expect(new URL(requests[1].request().postDataJSON().url).searchParams.get("q")).toBe("other default");
  await expect(canvas.locator('[data-node="other-query"]')).toHaveValue("other default");
  await finish(1, "destination", 23);
  await expect(canvas.locator('[data-node="other-result"]')).toHaveText("destination: 23");
  await unchanged();
});
