import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fetchRefetchBundle, fetchScopeDoc } from "../tests/helpers/fetch-refetch";

let bundle: string;
test.beforeAll(async () => { bundle = await fetchRefetchBundle(); });
test.beforeEach(async ({ page }) => {
  await page.setContent('<html><body><div id="app"></div></body></html>');
  await page.addStyleTag({ content: readFileSync("app/globals.css", "utf8") });
  await page.addScriptTag({ content: bundle });
  await expect(page.getByRole("dialog", { name: "スクリプト", exact: true })).toBeVisible();
});

const block = (page: Page) => page.locator('[data-sel-key="step:fetch"]');
const testDialog = (page: Page) => page.getByRole("dialog", { name: "取得のテスト", exact: true });
const dataDialog = (page: Page) => page.getByRole("dialog", { name: "取得したデータ", exact: true });
async function setUrl(page: Page, url: string) {
  const input = block(page).locator("input").first();
  await input.fill(url); await input.blur();
  await expect.poll(async () => (await currentStep(page)).url).toBe(url);
}
async function openTest(page: Page) {
  await block(page).getByRole("button", { name: /^(テスト実行…|送信中…)$/ }).click();
  await expect(testDialog(page)).toBeVisible();
}
async function sendTest(page: Page, method = "GET") {
  await openTest(page);
  await testDialog(page).getByRole("button", { name: `${method}で送信`, exact: true }).click();
}
async function closeTest(page: Page) {
  await testDialog(page).getByRole("button", { name: "閉じる", exact: true }).first().click();
  await expect(testDialog(page)).toHaveCount(0);
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
async function snapshot(page: Page) {
  return page.evaluate(() => { const { doc, past, future } = (window as any).refetchEditor.getState(); return { doc, past, future }; });
}
async function options(page: Page, method: string) {
  const button = block(page).getByRole("button", { name: /^リクエストの設定/ });
  if (await button.getAttribute("aria-expanded") === "false") await button.click();
  await block(page).locator("select").selectOption(method);
}

test("URL・POST本文・ヘッダー・DELETEの編集とデータを見る操作は送信しない", async ({ page }) => {
  await setUrl(page, "https://example.test/edited");
  await options(page, "POST");
  await block(page).locator("textarea").fill('{"version":2}');
  await block(page).locator("textarea").blur();
  await block(page).getByRole("button", { name: "ヘッダーを追加", exact: true }).click();
  const name = block(page).getByPlaceholder("名前（例: Authorization）");
  await name.fill("X-Test"); await name.blur();
  const value = block(page).getByPlaceholder("値 / {変数}", { exact: true });
  await value.fill("example"); await value.blur();
  await options(page, "DELETE");
  await requests(page, 0);
  const before = await snapshot(page);
  await openTest(page);
  await expect(testDialog(page)).toContainText("この送信は接続先のデータを変更する場合があります");
  await expect(testDialog(page).getByRole("button", { name: "DELETEで送信" })).toBeEnabled();
  await testDialog(page).press("Escape");
  await expect(testDialog(page)).toHaveCount(0);
  for (let i = 0; i < 2; i++) {
    await block(page).getByRole("button", { name: "データを見る", exact: true }).click();
    await expect(dataDialog(page)).toContainText("保存された見本");
    await dataDialog(page).getByRole("button", { name: "閉じる", exact: true }).click();
  }
  await requests(page, 0); expect(await snapshot(page)).toEqual(before);
});

test("未知のslugはテスト値を要求し、既知のデータを解決して一度だけ送り全件を保持する", async ({ page }) => {
  await setUrl(page, "https://example.test/{products.0.name}/[slug]/{q}");
  await openTest(page);
  const dialog = testDialog(page);
  await expect(dialog.getByRole("button", { name: "GETで送信" })).toBeDisabled();
  await dialog.getByRole("textbox", { name: "slug のテスト用の値" }).fill("001");
  const q = dialog.getByRole("textbox", { name: "q のテスト用の値" });
  await q.fill("a b");
  await q.dispatchEvent("keydown", { key: "Enter", isComposing: true, keyCode: 229 });
  await requests(page, 0);
  await expect(dialog).toContainText("https://example.test/Initial/001/a%20b");
  await dialog.getByRole("button", { name: "GETで送信" }).click();
  await requests(page, 1);
  expect(await page.evaluate(() => (window as any).refetchRequests[0].input.url)).toBe("https://example.test/Initial/001/a%20b");
  const latest = Array.from({ length: 23 }, (_, i) => ({ name: `LATEST ${i}` }));
  await finish(page, 0, latest);
  await expect(dialog.getByRole("status")).toHaveText("取得しました");
  await closeTest(page);
  expect((await currentStep(page)).url).toBe("https://example.test/{products.0.name}/[slug]/{q}");
  expect((await currentStep(page)).sample).toEqual(latest.slice(0, 20));
  await block(page).getByRole("button", { name: "データを見る", exact: true }).click();
  await expect(dataDialog(page).getByText("LATEST 22", { exact: true })).toBeVisible();
  await requests(page, 1);
});

test("連打・送信中の閉じると開き直しではDELETEを重複送信せず、完了後だけ再試行できる", async ({ page }) => {
  await options(page, "DELETE"); await openTest(page);
  await testDialog(page).getByRole("button", { name: "DELETEで送信" }).evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await requests(page, 1);
  await expect(testDialog(page).getByRole("button", { name: "送信中…" })).toBeDisabled();
  await closeTest(page); await openTest(page);
  await expect(testDialog(page).getByRole("button", { name: "送信中…" })).toBeDisabled();
  await requests(page, 1);
  await finish(page, 0, [{ name: "CANCELLED" }]);
  expect((await currentStep(page)).sample).toEqual([{ name: "Initial" }]);
  await testDialog(page).getByRole("button", { name: "DELETEで送信" }).click();
  await requests(page, 2); await finish(page, 1, [{ name: "LATEST" }]);
  await expect(testDialog(page).getByRole("status")).toHaveText("取得しました");
  await closeTest(page);
  await block(page).getByRole("button", { name: "データを見る", exact: true }).click();
  await expect(dataDialog(page).getByText("LATEST", { exact: true })).toBeVisible();
  await dataDialog(page).getByRole("button", { name: "取得し直す", exact: true }).click();
  await expect(testDialog(page)).toBeVisible();
  await requests(page, 2);
});

test("旧設定の応答やエラーが新設定の保留状態・見本・エラーを戻さない", async ({ page }) => {
  await setUrl(page, "https://example.test/slow"); await sendTest(page); await closeTest(page);
  await setUrl(page, "https://example.test/latest"); await sendTest(page);
  await requests(page, 2);
  await finish(page, 0, undefined, "古い取得に失敗しました");
  await expect(testDialog(page).getByRole("button", { name: "送信中…" })).toBeDisabled();
  await expect(testDialog(page)).not.toContainText("古い取得に失敗しました");
  await finish(page, 1, [{ name: "LATEST" }]);
  await expect(testDialog(page).getByRole("status")).toHaveText("取得しました");
  await closeTest(page);
  await expect(page.locator("#fetch-preview")).toContainText("LATEST");

  await setUrl(page, "https://example.test/older"); await sendTest(page); await closeTest(page);
  await setUrl(page, "https://example.test/failed"); await sendTest(page);
  await finish(page, 3, undefined, "新しい取得に失敗しました");
  await finish(page, 2, [{ name: "OLD" }]);
  await expect(testDialog(page)).toContainText("新しい取得に失敗しました");
  expect((await currentStep(page)).sample).toEqual([{ name: "LATEST" }]);
});

test("保留中のUndoと削除は応答で戻らず、保存し直した文書も見本を保つ", async ({ page }) => {
  await setUrl(page, "https://example.test/slow"); await sendTest(page); await requests(page, 1);
  await page.evaluate(() => (window as any).refetchEditor.getState().undo());
  await closeTest(page);
  const before = await snapshot(page);
  await finish(page, 0, [{ name: "OLD" }]);
  expect(await snapshot(page)).toEqual(before);
  await expect(page.getByRole("button", { name: "やり直す", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "やり直す", exact: true }).click();
  expect((await currentStep(page)).url).toBe("https://example.test/slow");
  await sendTest(page); await closeTest(page);
  await block(page).click({ button: "right", position: { x: 8, y: 8 } });
  await page.getByRole("button", { name: "このブロックを削除", exact: true }).click();
  await finish(page, 1, [{ name: "REMOVED" }]);
  await expect(block(page)).toHaveCount(0);
  expect(await currentStep(page)).toBeUndefined();
  await expect(page.locator('[data-sel-key="step:other"]')).toBeVisible();
});

test("スクリプトを閉じて開き直しても保留中のPOSTを再送せず、失敗後に再試行できる", async ({ page }) => {
  await options(page, "POST"); await sendTest(page, "POST"); await closeTest(page);
  const script = page.getByRole("dialog", { name: "スクリプト", exact: true });
  await script.getByRole("button", { name: "閉じる", exact: true }).click();
  await page.locator("#reopen-script").click(); await openTest(page);
  await expect(testDialog(page).getByRole("button", { name: "送信中…" })).toBeDisabled();
  await finish(page, 0, undefined, "閉じた要求の失敗");
  await expect(testDialog(page)).not.toContainText("閉じた要求の失敗");
  await testDialog(page).getByRole("button", { name: "POSTで送信" }).click();
  await requests(page, 2); await finish(page, 1, undefined, "最新の失敗");
  await expect(testDialog(page).getByRole("alert")).toHaveText("最新の失敗");
  await testDialog(page).getByRole("button", { name: "POSTで送信" }).click();
  await requests(page, 3); await finish(page, 2, [{ name: "SAVED" }]); await closeTest(page);
  const saved = await currentStep(page);
  await page.evaluate(() => {
    const s = (window as any).refetchEditor.getState(); s.replaceDoc(JSON.parse(JSON.stringify(s.doc)));
  });
  expect(await currentStep(page)).toEqual(saved);
});

test("無効なJSONは送れず、未知の空値は明示して使用でき、キャンセルした値は保存しない", async ({ page }) => {
  await options(page, "POST");
  await block(page).locator("textarea").fill('{"broken":'); await block(page).locator("textarea").blur();
  await openTest(page);
  await expect(testDialog(page).getByRole("button", { name: "POSTで送信" })).toBeDisabled();
  await expect(testDialog(page)).toContainText("JSONとして読み取れません");
  await closeTest(page);
  await block(page).locator("textarea").fill('{"name":"{missing}"}'); await block(page).locator("textarea").blur();
  const before = await snapshot(page);
  await openTest(page);
  await expect(testDialog(page).getByRole("button", { name: "POSTで送信" })).toBeDisabled();
  await testDialog(page).getByRole("button", { name: "空の値を使う" }).click();
  await expect(testDialog(page).getByRole("button", { name: "POSTで送信" })).toBeEnabled();
  await closeTest(page);
  expect(await snapshot(page)).toEqual(before); await requests(page, 0);
  await openTest(page);
  await expect(testDialog(page).getByRole("button", { name: "POSTで送信" })).toBeDisabled();
  await testDialog(page).getByRole("textbox", { name: "missing のテスト用の値" }).fill("001");
  await testDialog(page).getByRole("button", { name: "POSTで送信" }).click();
  await requests(page, 1);
  expect(await page.evaluate(() => (window as any).refetchRequests[0].input.body)).toBe('{"name":"001"}');
  await finish(page, 0, { ok: true });
});


test("リスト内の取得はブロックとデータ小窓の両方で同じ行の値を送る", async ({ page }) => {
  await page.evaluate((doc) => (window as any).refetchEditor.getState().replaceDoc(doc), fetchScopeDoc("node"));
  const scoped = page.locator('[data-sel-key="step:scoped"]');
  for (const source of ["block", "peek"]) {
    if (source === "block") await scoped.getByRole("button", { name: "テスト実行…", exact: true }).click();
    else {
      await scoped.getByRole("button", { name: "データを見る", exact: true }).click();
      await expect(dataDialog(page)).toBeVisible();
      await dataDialog(page).getByRole("button", { name: "取得し直す", exact: true }).click();
    }
    await expect(testDialog(page)).toContainText("https://example.test/ROW-ID");
    await expect(testDialog(page).getByRole("textbox")).toHaveCount(0);
    await testDialog(page).getByRole("button", { name: "POSTで送信", exact: true }).click();
    const index = source === "block" ? 0 : 1;
    await requests(page, index + 1);
    expect(await page.evaluate((i) => (window as any).refetchRequests[i].input, index)).toMatchObject({
      url: "https://example.test/ROW-ID", body: '{"raw":{"id":"ROW-ID"}}',
    });
    await finish(page, index, { ok: true }); await closeTest(page);
  }
});

test("入れ子の取得もデータ小窓を開け、両導線でloopの親と空object・arrayをページ値から遮蔽する", async ({ page }) => {
  await page.evaluate((doc) => (window as any).refetchEditor.getState().replaceDoc(doc), fetchScopeDoc("loop"));
  const scoped = page.locator('[data-sel-key="step:scoped"]');
  for (const source of ["block", "peek"]) {
    if (source === "block") await scoped.getByRole("button", { name: "テスト実行…", exact: true }).click();
    else {
      await scoped.getByRole("button", { name: "データを見る", exact: true }).click();
      await expect(dataDialog(page)).toBeVisible();
      await dataDialog(page).getByRole("button", { name: "取得し直す", exact: true }).click();
    }
    await expect(testDialog(page).getByRole("button", { name: "POSTで送信", exact: true })).toBeDisabled();
    await expect(testDialog(page)).not.toContainText("PAGE-ID");
    await expect(testDialog(page)).not.toContainText("PAGE-DOTTED");
    for (const name of ["details.id", "empty", "tags", "details"]) {
      await expect(testDialog(page).getByRole("textbox", { name: `${name} のテスト用の値`, exact: true })).toHaveValue("");
    }
    await requests(page, 0); await closeTest(page);
  }
});
