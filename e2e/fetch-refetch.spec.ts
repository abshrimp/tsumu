import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fetchRefetchBundle } from "../tests/helpers/fetch-refetch";

let bundle: string;
test.beforeAll(async () => { bundle = await fetchRefetchBundle(); });
test.beforeEach(async ({ page }) => {
  await page.setContent('<html><body><div id="app"></div></body></html>');
  await page.addStyleTag({ content: readFileSync("app/globals.css", "utf8") });
  await page.addScriptTag({ content: bundle });
  await expect(page.getByRole("dialog", { name: "スクリプト", exact: true })).toBeVisible();
});

const block = (page: Page) => page.locator('[data-sel-key="step:fetch"]');
async function setUrl(page: Page, url: string) {
  const input = block(page).locator("input").first();
  await input.fill(url);
  await input.press("Enter");
}
async function requests(page: Page, count: number) {
  await expect.poll(() => page.evaluate(() => (window as any).refetchRequests.length)).toBe(count);
}
async function finish(page: Page, index: number, json: unknown, error?: string) {
  await page.evaluate(({ index, json, error }) => (window as any).finishRefetch(index, json, error), { index, json, error });
}
async function currentStep(page: Page) {
  return page.evaluate(() => (window as any).refetchEditor.getState().doc.pages.p.pageScripts[0].steps.find((s: any) => s.id === "fetch"));
}

test("遅い旧URLの応答が新しい見本・変数・データ一覧を戻さない", async ({ page }) => {
  await setUrl(page, "https://example.test/slow");
  await setUrl(page, "https://example.test/latest");
  await requests(page, 2);
  const latest = Array.from({ length: 23 }, (_, i) => ({ name: `LATEST ${i}` }));
  await finish(page, 1, latest);
  await expect(block(page).getByRole("button", { name: "データを見る", exact: true })).toBeVisible();
  await finish(page, 0, [{ name: "OLD" }]);
  const saved = await currentStep(page);
  expect(saved.url).toBe("https://example.test/latest");
  expect(saved.sample).toEqual(latest.slice(0, 20));
  await expect(page.locator("#fetch-preview")).toContainText("LATEST 0");
  await expect(page.locator("#fetch-preview")).not.toContainText("OLD");
  await block(page).getByRole("button", { name: "データを見る", exact: true }).click();
  await requests(page, 3);
  await finish(page, 2, latest);
  const data = page.getByRole("dialog", { name: "取得したデータ", exact: true });
  await expect(data.getByText("LATEST 22", { exact: true })).toBeVisible();
  await expect(data).not.toContainText("OLD");
});

test("同じURLの設定変更中も旧要求のエラーで読み込みを止めない", async ({ page }) => {
  await block(page).getByRole("button", { name: "リクエストの設定", exact: true }).click();
  await block(page).locator("select").selectOption("POST");
  const body = block(page).locator("textarea");
  await body.fill('{"version":2}');
  await body.blur();
  await requests(page, 2);
  await finish(page, 0, undefined, "古い取得に失敗しました");
  await expect(block(page).getByText("読み込み中…", { exact: true })).toBeVisible();
  await expect(block(page)).not.toContainText("古い取得に失敗しました");
  await finish(page, 1, [{ name: "LATEST" }]);
  expect(await currentStep(page)).toMatchObject({
    url: "https://example.test/initial", method: "POST", body: '{"version":2}', sample: [{ name: "LATEST" }],
  });
});

test("新しい取得に失敗した後は以前の見本と最新のエラーを残す", async ({ page }) => {
  await setUrl(page, "https://example.test/slow");
  await setUrl(page, "https://example.test/latest");
  await requests(page, 2);
  await finish(page, 1, undefined, "新しい取得に失敗しました");
  await finish(page, 0, [{ name: "OLD" }]);
  await expect(block(page)).toContainText("新しい取得に失敗しました");
  expect((await currentStep(page)).sample).toEqual([{ name: "Initial" }]);
});

test("Undo とブロック削除の後に、保留中の見本を保存し直さない", async ({ page }) => {
  await setUrl(page, "https://example.test/slow");
  await requests(page, 1);
  await page.getByRole("button", { name: "取り消す", exact: true }).click();
  await finish(page, 0, [{ name: "OLD" }]);
  expect(await currentStep(page)).toMatchObject({ url: "https://example.test/initial", sample: [{ name: "Initial" }] });
  await expect(page.getByRole("button", { name: "やり直す", exact: true })).toBeEnabled();

  await setUrl(page, "https://example.test/delete");
  await requests(page, 2);
  await block(page).click({ button: "right", position: { x: 8, y: 8 } });
  await page.getByRole("button", { name: "このブロックを削除", exact: true }).click();
  await finish(page, 1, [{ name: "REMOVED" }]);
  await expect(block(page)).toHaveCount(0);
  expect(await currentStep(page)).toBeUndefined();
  await expect(page.locator('[data-sel-key="step:other"]')).toBeVisible();
});

test("Undo で別の取得元に戻ると、保留中と完了済みのエラー表示を残さない", async ({ page }) => {
  await setUrl(page, "https://example.test/slow");
  await requests(page, 1);
  await page.getByRole("button", { name: "取り消す", exact: true }).click();
  await expect(block(page).getByText("読み込み中…", { exact: true })).toHaveCount(0);
  await finish(page, 0, undefined, "旧設定の取得に失敗しました");
  await expect(block(page)).not.toContainText("旧設定の取得に失敗しました");
  await expect(page.getByRole("button", { name: "やり直す", exact: true })).toBeEnabled();

  await setUrl(page, "https://example.test/failed");
  await requests(page, 2);
  await finish(page, 1, undefined, "現在の取得に失敗しました");
  await expect(block(page)).toContainText("現在の取得に失敗しました");
  await page.getByRole("button", { name: "取り消す", exact: true }).click();
  await expect(block(page)).not.toContainText("現在の取得に失敗しました");
  expect((await currentStep(page)).sample).toEqual([{ name: "Initial" }]);
});

test("データ小窓を取得中に閉じて再取得しても、閉じた旧要求で最新の見本を戻さない", async ({ page }) => {
  const openData = () => block(page).getByRole("button", { name: "データを見る", exact: true }).click();
  const data = page.getByRole("dialog", { name: "取得したデータ", exact: true });
  await openData();
  await requests(page, 1);
  await finish(page, 0, [{ name: "Initial" }]);
  await data.getByRole("button", { name: "取得し直す", exact: true }).click();
  await requests(page, 2);
  await data.getByRole("button", { name: "閉じる", exact: true }).click();
  await expect(data).toHaveCount(0);

  await openData();
  await data.getByRole("button", { name: "取得し直す", exact: true }).click();
  await requests(page, 3);
  await finish(page, 2, [{ name: "LATEST" }]);
  await requests(page, 4);
  await finish(page, 3, [{ name: "LATEST" }]);
  await expect(data.getByText("LATEST", { exact: true })).toBeVisible();
  const saved = await currentStep(page);
  await finish(page, 1, [{ name: "OLD" }]);
  expect(await currentStep(page)).toEqual(saved);
  expect(saved.sample).toEqual([{ name: "LATEST" }]);
  await expect(page.locator("#fetch-preview")).toContainText("LATEST");
  await expect(page.locator("#fetch-preview")).not.toContainText("OLD");
  await expect(data.getByText("LATEST", { exact: true })).toBeVisible();
  await expect(data).not.toContainText("OLD");
});

test("取得中にスクリプト画面を閉じて再取得しても、旧background応答が最新の見本を戻さない", async ({ page }) => {
  await setUrl(page, "https://example.test/background");
  await requests(page, 1);
  const script = page.getByRole("dialog", { name: "スクリプト", exact: true });
  await script.getByRole("button", { name: "閉じる", exact: true }).click();
  await expect(script).toHaveCount(0);
  await page.locator("#reopen-script").click();
  await expect(script).toBeVisible();

  await block(page).getByRole("button", { name: "データを見る", exact: true }).click();
  const data = page.getByRole("dialog", { name: "取得したデータ", exact: true });
  await requests(page, 2);
  await finish(page, 1, [{ name: "Initial" }]);
  await data.getByRole("button", { name: "取得し直す", exact: true }).click();
  await requests(page, 3);
  await finish(page, 2, [{ name: "LATEST" }]);
  await requests(page, 4);
  await finish(page, 3, [{ name: "LATEST" }]);
  await expect(data.getByText("LATEST", { exact: true })).toBeVisible();
  const saved = await currentStep(page);
  await finish(page, 0, [{ name: "OLD" }]);
  expect(await currentStep(page)).toEqual(saved);
  expect(saved.sample).toEqual([{ name: "LATEST" }]);
  await expect(page.locator("#fetch-preview")).toContainText("LATEST");
  await expect(page.locator("#fetch-preview")).not.toContainText("OLD");
});
