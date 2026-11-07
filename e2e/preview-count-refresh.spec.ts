import { expect, test, type Page, type Route } from "@playwright/test";
import { makeText } from "../lib/presets";
import { makeSample } from "../lib/data";
import { countedRows, previewCountDoc } from "../tests/helpers/preview-count-refresh";

async function setup(page: Page, doc = previewCountDoc()) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem("tsumu-help-seen-v1", "1"));
  const response = await page.request.post("/api/sites", { data: { name: "Preview sample counts" } });
  expect(response.ok()).toBeTruthy();
  const { site } = await response.json();
  const endpoint = `/api/doc?site=${site.id}`;
  expect((await page.request.put(endpoint, { data: doc })).ok()).toBeTruthy();
  const requests: Route[] = [];
  await page.route("**/api/fetch-json", (route) => { requests.push(route); });
  await page.goto(`/sites/${site.id}`);
  await expect(page.getByText("サーバー保存済み")).toBeVisible();
  const saved = (await (await page.request.get(endpoint)).json()).doc;
  const canvas = page.locator('[data-tutorial="canvas"]');
  return {
    canvas, requests,
    async finish(index: number, json: unknown, status = 200) {
      const settled = page.waitForEvent("requestfinished", (request) => request === requests[index].request());
      await requests[index].fulfill({ status, contentType: "application/json", body: JSON.stringify({ json }) });
      await settled;
    },
    async unchanged() {
      expect((await (await page.request.get(endpoint)).json()).doc).toEqual(saved);
      expect(errors).toEqual([]);
    },
  };
}

for (const length of [0, 2, 20]) {
  test(`a ${length}-row design refresh replaces the old count and count-dependent list`, async ({ page }) => {
    const { canvas, requests, finish, unchanged } = await setup(page);
    const rows = canvas.locator('[data-node="row"], [data-ghost="row"]');
    const result = canvas.locator('[data-node="result"]');
    await page.getByRole("button", { name: "プレビュー", exact: true }).click();
    await expect.poll(() => requests.length).toBe(1);
    await finish(0, countedRows("large", 35));
    await expect(result).toHaveText("large: 35");
    await expect(rows).toHaveCount(35);
    await page.getByRole("button", { name: "デザイン", exact: true }).click();
    await expect(rows).toHaveCount(20);
    await expect(result).toHaveAttribute("href", "/count/35");
    await canvas.getByRole("button", { name: "読み込み直す", exact: true }).click();
    await expect.poll(() => requests.length).toBe(2);
    await finish(1, countedRows("small", length));
    // Design content retains its variable placeholders; resolved links and list conditions use the refreshed count.
    await expect(result).toHaveText("{response.label}: {total}");
    await expect(result).toHaveAttribute("href", `/count/${length}`);
    await expect(canvas.locator('[data-node="nested"]')).toHaveAttribute("href", `/nested/${length}`);
    await expect(rows).toHaveCount(length);
    if (!length) await expect(canvas.locator('[data-node="rows"] .cv-placeholder')).toBeVisible();
    await page.getByRole("button", { name: "プレビュー", exact: true }).click();
    await expect.poll(() => requests.length).toBe(3);
    await finish(2, countedRows("large again", 31));
    await expect(result).toHaveText("large again: 31");
    await expect(rows).toHaveCount(31);
    await page.getByRole("button", { name: "デザイン", exact: true }).click();
    await expect(result).toHaveAttribute("href", "/count/31");
    await expect(rows).toHaveCount(20);
    await unchanged();
  });
}

test("nested count paths follow the new response shape while failed fetch blocks keep their fallback", async ({ page }) => {
  const doc = previewCountDoc();
  const savedAux = makeSample(countedRows("saved aux", 41));
  doc.pages.home.pageScripts![0].steps.push(
    { id: "aux-fetch", kind: "fetch", url: "https://example.test/aux", as: "aux", sample: savedAux.sample, sampleTotals: savedAux.totals },
    { id: "aux-count", kind: "count", array: "aux.rows", into: "auxTotal" },
  );
  doc.nodes.aux = { ...makeText("Aux count"), id: "aux", link: { kind: "url", url: "/aux/{auxTotal}" } };
  doc.pages.home.children.push("aux");
  const { canvas, requests, finish, unchanged } = await setup(page, doc);
  const result = canvas.locator('[data-node="result"]');
  const nested = canvas.locator('[data-node="nested"]');
  const auxiliary = canvas.locator('[data-node="aux"]');
  const refresh = async (index: number, main: unknown, aux: unknown, mainStatus = 200, auxStatus = 200) => {
    await canvas.getByRole("button", { name: "読み込み直す", exact: true }).click();
    await expect.poll(() => requests.length).toBe(index + 2);
    await finish(index, main, mainStatus); await finish(index + 1, aux, auxStatus);
    await expect(canvas.getByRole("button", { name: "読み込み直す", exact: true })).toBeEnabled();
  };
  await refresh(0, countedRows("large", 35, 43), null, 200, 502);
  await expect(auxiliary).toHaveAttribute("href", "/aux/41");
  await refresh(2, countedRows("small", 2, 0), countedRows("live aux", 47));
  await expect(result).toHaveAttribute("href", "/count/2");
  await expect(nested).toHaveAttribute("href", "/nested/0");
  await expect(auxiliary).toHaveAttribute("href", "/aux/47");
  await refresh(4, { label: "changed shape", rows: [], nested: { replacement: [] } }, null, 200, 502);
  await expect(result).toHaveAttribute("href", "/count/0");
  await expect(nested).toHaveAttribute("href", "/nested/0");
  await expect(auxiliary).toHaveAttribute("href", "/aux/47");
  await refresh(6, null, countedRows("small aux", 3), 502);
  await expect(result).toHaveAttribute("href", "/count/0");
  await expect(auxiliary).toHaveAttribute("href", "/aux/3");
  await unchanged();
});
