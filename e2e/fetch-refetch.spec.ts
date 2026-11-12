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
const result = (page: Page) => page.getByRole("dialog", { name: "取得したデータ", exact: true });
const refresh = (page: Page) => result(page).getByRole("button", { name: "取得し直す", exact: true });
async function setUrl(page: Page, url: string) {
  const input = block(page).locator("input").first();
  await input.fill(url); await input.blur();
  await expect.poll(async () => (await currentStep(page)).url).toBe(url);
}
async function send(page: Page) {
  await block(page).getByRole("button", { name: "データ取得", exact: true }).click();
  await expect(result(page)).toBeVisible();
}
async function close(page: Page) {
  await result(page).getByRole("button", { name: "閉じる", exact: true }).click();
  await expect(result(page)).toHaveCount(0);
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

test("Initial fetch sends once without confirmation; subsequent views are read-only until explicit refresh", async ({ page }) => {
  await page.evaluate(() => (window as any).refetchEditor.getState().updateDoc((doc: any) => {
    const step = doc.pages.p.pageScripts[0].steps[0]; delete step.preview?.sample; delete step.preview?.fetchedAt;
  }));
  await expect(block(page).getByRole("button")).toHaveCount(2);
  await expect(block(page).locator(".se-fetch-destination")).toHaveCount(0);
  await expect(block(page).getByRole("button", { name: "データ取得", exact: true })).toBeVisible();
  await expect(block(page).getByRole("button", { name: "リクエストの設定", exact: true })).toBeVisible();
  await send(page); await requests(page, 1);
  await expect(result(page).locator(".se-fetch-destination")).toHaveCount(1);
  await expect(result(page).locator(".se-fetch-destination")).toContainText("現在の設定の送信先");
  await expect(result(page).locator(".se-fetch-destination")).not.toContainText("次の送信先");
  await expect(result(page).getByRole("status")).toHaveText("送信中…");
  await expect(page.getByRole("dialog", { name: "取得のテスト", exact: true })).toHaveCount(0);
  await expect(refresh(page)).toBeDisabled();
  await close(page);
  await block(page).getByRole("button", { name: "送信中…", exact: true }).click();
  await requests(page, 1);
  await finish(page, 0, [{ name: "LATEST" }]);
  await expect(result(page).getByText("LATEST", { exact: true })).toBeVisible();
  await close(page);
  for (let i = 0; i < 2; i++) {
    await block(page).getByRole("button", { name: "データを見る", exact: true }).click();
    await requests(page, 1); await close(page);
  }
  await block(page).getByRole("button", { name: "データを見る", exact: true }).click();
  await refresh(page).click(); await requests(page, 2);
  await finish(page, 1, [{ name: "REFRESHED" }]);
  await expect(result(page).getByText("REFRESHED", { exact: true })).toBeVisible();
});

test("Editing URL, POST body, headers, or DELETE settings does not send requests and preserves the previous sample", async ({ page }) => {
  await block(page).getByRole("button", { name: "データを見る", exact: true }).click();
  await expect(result(page)).toContainText("保存された見本"); await close(page);
  await setUrl(page, "https://example.test/edited"); await options(page, "POST");
  await block(page).locator("textarea").fill('{"version":2}'); await block(page).locator("textarea").blur();
  await block(page).getByRole("button", { name: "ヘッダーを追加", exact: true }).click();
  const name = block(page).locator(".se-fetch-header").getByPlaceholder("名前");
  await name.fill("X-Test"); await name.blur();
  const value = block(page).getByPlaceholder("値 / {変数}", { exact: true });
  await value.fill("example"); await value.blur(); await options(page, "DELETE");
  await requests(page, 0);
  await expect(block(page).getByRole("button", { name: "データを見る", exact: true })).toHaveCount(0);
  await expect(block(page)).toContainText("DELETE");
  await expect(block(page)).toContainText("この送信は接続先のデータを変更する場合があります");
  expect((await currentStep(page)).preview?.sample).toEqual([{ name: "Initial" }]);
  expect((await currentStep(page)).preview?.fetchedAt).toBeUndefined();
  await page.evaluate(() => { const s = (window as any).refetchEditor.getState(); s.replaceDoc(JSON.parse(JSON.stringify(s.doc))); });
  await expect(block(page).getByRole("button", { name: "データ取得", exact: true })).toBeVisible();
  await send(page); await requests(page, 1);
  await expect(result(page)).toContainText("現在の設定で未確認の見本");
  await finish(page, 0, { ok: true });
});

test("Unknown slugs use the block test values consistently without saving them to the document", async ({ page }) => {
  await setUrl(page, "https://example.test/{products.0.name}/[slug]/{q}");
  await expect(block(page).getByRole("button", { name: "データ取得", exact: true })).toBeDisabled();
  await block(page).getByRole("textbox", { name: "slug のテスト用の値" }).fill("001");
  const q = block(page).getByRole("textbox", { name: "q のテスト用の値" });
  await q.fill("a b");
  await q.dispatchEvent("keydown", { key: "Enter", isComposing: true, keyCode: 229 });
  await requests(page, 0);
  await send(page); await requests(page, 1);
  expect(await page.evaluate(() => (window as any).refetchRequests[0].input.url)).toBe("https://example.test/Initial/001/a%20b");
  const all = Array.from({ length: 23 }, (_, i) => ({ name: `Row${i}` }));
  await finish(page, 0, all);
  await expect(result(page)).toContainText("https://example.test/Initial/001/a%20b");
  await expect(result(page).getByText("Row22", { exact: true })).toBeVisible();
  expect((await currentStep(page)).preview?.sample).toEqual(all.slice(0, 20));
  expect(JSON.stringify(await currentStep(page))).not.toContain("a b");
  await refresh(page).click(); await requests(page, 2);
  expect(await page.evaluate(() => (window as any).refetchRequests[1].input.url)).toBe("https://example.test/Row0/001/a%20b");
  await finish(page, 1, all);
});

test("Saved samples are limited to 20 and explain how to fetch all results again", async ({ page }) => {
  await page.evaluate(() => (window as any).refetchEditor.getState().updateDoc((doc: any) => {
    const step = doc.pages.p.pageScripts[0].steps[0];
    delete step.preview?.sample; delete step.preview?.fetchedAt;
  }));
  await send(page);
  const all = Array.from({ length: 23 }, (_, i) => ({ name: `Row${i}` }));
  await finish(page, 0, all);
  await expect(result(page).getByText("Row22", { exact: true })).toBeVisible();
  await expect(result(page)).not.toContainText("見本にはリストの先頭20件のみ保存されています");
  await close(page);

  // 保存した文書に戻すと、メモリの中の応答の全体は失われるが、プレビューは失われない。
  await page.evaluate(() => {
    const store = (window as any).refetchEditor.getState();
    store.replaceDoc(JSON.parse(JSON.stringify(store.doc)));
  });
  await block(page).getByRole("button", { name: "データを見る", exact: true }).click();
  await expect(result(page)).toContainText("見本にはリストの先頭20件のみ保存されています");
  await expect(result(page)).toContainText("全件を見るには右上の「取得し直す」");
  await requests(page, 1);
  await refresh(page).click(); await requests(page, 2);
  await finish(page, 1, all);
  await expect(result(page).getByText("Row22", { exact: true })).toBeVisible();
});

test("Stale responses or errors do not replace the new pending state, sample, or error and allow retry", async ({ page }) => {
  await setUrl(page, "https://example.test/slow"); await send(page); await close(page);
  await setUrl(page, "https://example.test/latest"); await send(page); await requests(page, 2);
  await finish(page, 0, undefined, "古い取得に失敗しました");
  await expect(refresh(page)).toBeDisabled(); await expect(result(page)).not.toContainText("古い取得に失敗しました");
  await finish(page, 1, [{ name: "LATEST" }]); await close(page);
  await expect(page.locator("#fetch-preview")).toContainText("LATEST");
  await setUrl(page, "https://example.test/older"); await send(page); await close(page);
  await setUrl(page, "https://example.test/failed"); await send(page);
  await finish(page, 3, undefined, "新しい取得に失敗しました"); await finish(page, 2, [{ name: "OLD" }]);
  await expect(result(page).getByRole("alert")).toHaveText("新しい取得に失敗しました");
  expect((await currentStep(page)).preview?.sample).toEqual([{ name: "LATEST" }]);
  await refresh(page).click(); await requests(page, 5); await finish(page, 4, [{ name: "RECOVERED" }]);
  await expect(result(page).getByRole("alert")).toHaveCount(0);
  await expect(result(page).getByText("RECOVERED", { exact: true })).toBeVisible();
});

test("Pending responses do not undo Undo or deletion", async ({ page }) => {
  await setUrl(page, "https://example.test/slow"); await send(page); await requests(page, 1);
  await page.evaluate(() => (window as any).refetchEditor.getState().undo()); await close(page);
  const before = await snapshot(page); await finish(page, 0, [{ name: "OLD" }]);
  expect(await snapshot(page)).toEqual(before);
  await page.getByRole("button", { name: "やり直す", exact: true }).click();
  expect((await currentStep(page)).url).toBe("https://example.test/slow");
  // やり直しても、リクエストを送ったことは保たれる。表示するだけでは、明示的に更新しない限り、決して送り直さない。
  await block(page).getByRole("button", { name: "データを見る", exact: true }).click();
  await requests(page, 1); await refresh(page).click(); await requests(page, 2); await close(page);
  await block(page).click({ button: "right", position: { x: 8, y: 8 } });
  await page.getByRole("button", { name: "このブロックを削除", exact: true }).click();
  await finish(page, 1, [{ name: "REMOVED" }]);
  await expect(block(page)).toHaveCount(0); expect(await currentStep(page)).toBeUndefined();
  await expect(page.locator('[data-sel-key="step:other"]')).toBeVisible();
});

test("Reopening the script editor does not resend a pending POST and allows retry after failure", async ({ page }) => {
  await options(page, "POST"); await send(page); await close(page);
  await page.getByRole("dialog", { name: "スクリプト", exact: true }).getByRole("button", { name: "閉じる", exact: true }).click();
  await page.locator("#reopen-script").click();
  await block(page).getByRole("button", { name: "送信中…", exact: true }).click(); await requests(page, 1);
  await finish(page, 0, undefined, "閉じた要求の失敗");
  await expect(result(page).getByRole("alert")).toHaveText("閉じた要求の失敗");
  await refresh(page).click(); await requests(page, 2); await finish(page, 1, undefined, "最新の失敗");
  await expect(result(page).getByRole("alert")).toHaveText("最新の失敗");
  await refresh(page).click(); await requests(page, 3); await finish(page, 2, [{ name: "SAVED" }]); await close(page);
  const saved = await currentStep(page);
  await page.evaluate(() => { const s = (window as any).refetchEditor.getState(); s.replaceDoc(JSON.parse(JSON.stringify(s.doc))); });
  expect(await currentStep(page)).toEqual(saved);
  await block(page).getByRole("button", { name: "データを見る", exact: true }).click(); await requests(page, 3);
});

test("Invalid JSON cannot be sent, explicit empty values work, and uncommitted URL/body values are not sent", async ({ page }) => {
  await options(page, "POST");
  await block(page).locator("textarea").fill('{"broken":'); await block(page).locator("textarea").blur();
  await expect(block(page).getByRole("button", { name: "データ取得", exact: true })).toBeDisabled();
  await expect(block(page)).toContainText("JSONとして読み取れません");
  await block(page).locator("textarea").fill('{"name":"{missing}"}'); await block(page).locator("textarea").blur();
  await expect(block(page).getByRole("button", { name: "データ取得", exact: true })).toBeDisabled();
  await block(page).getByRole("button", { name: "空の値を使う", exact: true }).click();
  await send(page); await requests(page, 1);
  expect(await page.evaluate(() => (window as any).refetchRequests[0].input.body)).toBe('{"name":""}');
  await finish(page, 0, { ok: true }); await close(page);
  const url = block(page).locator("input").first();
  await url.fill("https://example.test/uncommitted");
  // URL の欄から blur させるクリックで、前のリクエストを送ってはならない。
  await block(page).getByRole("button", { name: "データを見る", exact: true }).click();
  await requests(page, 1);
  await expect(result(page)).toBeVisible();
  expect((await currentStep(page)).url).toBe("https://example.test/uncommitted");
  // リクエストを変えた後は、前のテストの値を決して黙って使い回さない。
  await expect(refresh(page)).toBeDisabled();
  await result(page).getByRole("button", { name: "空の値を使う", exact: true }).click();
  await requests(page, 1); await refresh(page).click(); await requests(page, 2);
  expect(await page.evaluate(() => (window as any).refetchRequests[1].input.url)).toBe("https://example.test/uncommitted");
  await finish(page, 1, { ok: true }); await close(page);
  await block(page).locator("textarea").fill('{"name":"NEW"}');
  await block(page).getByRole("button", { name: "データを見る", exact: true }).click(); await requests(page, 2);
  await expect(result(page)).toBeVisible(); await refresh(page).click(); await requests(page, 3);
  expect(await page.evaluate(() => (window as any).refetchRequests[2].input.body)).toBe('{"name":"NEW"}');
  await finish(page, 2, { ok: true });
});

test("Executing a block inside a list and refreshing its dialog send the same row values", async ({ page }) => {
  const doc = fetchScopeDoc("node");
  delete (doc.nodes.act.scripts![0].steps[0] as any).preview?.fetchedAt;
  await page.evaluate((doc) => (window as any).refetchEditor.getState().replaceDoc(doc), doc);
  const scoped = page.locator('[data-sel-key="step:scoped"]');
  await scoped.getByRole("button", { name: "データ取得", exact: true }).click();
  for (let i = 0; i < 2; i++) {
    await requests(page, i + 1);
    expect(await page.evaluate((i) => (window as any).refetchRequests[i].input, i)).toMatchObject({
      url: "https://example.test/ROW-ID", body: '{"raw":{"id":"ROW-ID"}}',
    });
    await expect(result(page).getByRole("textbox")).toHaveCount(0);
    await finish(page, i, { ok: true });
    if (!i) { await close(page); await scoped.getByRole("button", { name: "データを見る", exact: true }).click(); await requests(page, 1); await refresh(page).click(); }
  }
});

test("Nested fetches prevent parent loop values and empty objects or arrays from falling back to page values", async ({ page }) => {
  const doc = fetchScopeDoc("loop");
  delete (doc.pages.p.pageScripts![0].steps[2] as any).then[0].then[0].preview?.fetchedAt;
  await page.evaluate((doc) => (window as any).refetchEditor.getState().replaceDoc(doc), doc);
  const scoped = page.locator('[data-sel-key="step:scoped"]');
  await expect(scoped.getByRole("button", { name: "データ取得", exact: true })).toBeDisabled();
  for (const name of ["details.id", "empty", "tags", "details"]) {
    const input = scoped.getByRole("textbox", { name: `${name} のテスト用の値`, exact: true });
    await expect(input).toHaveValue(""); await input.fill(name === "details.id" ? "LOCAL" : "temporary");
  }
  await requests(page, 0);
  await scoped.getByRole("button", { name: "データ取得", exact: true }).click(); await requests(page, 1);
  await expect(result(page)).not.toContainText("PAGE-ID"); await expect(result(page)).not.toContainText("PAGE-DOTTED");
  await finish(page, 0, { ok: true }); await close(page);
  await scoped.getByRole("button", { name: "データを見る", exact: true }).click(); await requests(page, 1);
  await expect(refresh(page)).toBeEnabled();
  for (const name of ["details.id", "empty", "tags", "details"]) {
    await expect(result(page).getByRole("textbox", { name: `${name} のテスト用の値`, exact: true })).toHaveValue(name === "details.id" ? "LOCAL" : "temporary");
  }
  await refresh(page).click(); await requests(page, 2); await finish(page, 1, { ok: true });
});


for (const gesture of ["step-cancel", "script-drop"]) test(`pending POST survives ${gesture} without turning view into a second send`, async ({ page }) => {
  await options(page, "POST"); await send(page); await requests(page, 1); await close(page);
  const source = gesture === "step-cancel" ? block(page) : page.locator(".se-ws .se-hat").first();
  // 設定をスクロールした結果、左端がパレットの下に隠れていても、実際のブロックをつかむ。
  const grip = source.locator(".se-ico").first();
  await grip.scrollIntoViewIfNeeded();
  const rect = await grip.boundingBox(); const workspace = await page.locator(".se-ws").boundingBox();
  const origin = { x: rect!.x + rect!.width / 2, y: rect!.y + rect!.height / 2 };
  expect(await source.evaluate((el, point) => el.contains(document.elementFromPoint(point.x, point.y)), origin)).toBe(true);
  await page.mouse.move(origin.x, origin.y); await page.mouse.down();
  await page.mouse.move(workspace!.x + workspace!.width - 70, workspace!.y + workspace!.height - 80, { steps: 5 });
  await expect(page.locator(".se-ghost .se-stack").first()).toBeVisible();
  if (gesture === "step-cancel") await page.keyboard.press("Escape");
  await page.mouse.up(); await expect(page.locator(".se-ghost")).toHaveCount(0);
  await finish(page, 0, [{ name: "DRAG-SAVED" }]);
  await expect(block(page).getByRole("button", { name: "データを見る", exact: true })).toBeVisible();
  await block(page).getByRole("button", { name: "データを見る", exact: true }).click(); await requests(page, 1);
  await expect(result(page).getByText("DRAG-SAVED", { exact: true })).toBeVisible();
});

test("a cloned document with identical IDs cannot inherit a pending request or its late response", async ({ page }) => {
  await options(page, "POST"); await send(page); await close(page);
  await page.evaluate(() => {
    const store = (window as any).refetchEditor.getState(); const doc = JSON.parse(JSON.stringify(store.doc));
    doc.siteName = "Other site"; store.replaceDoc(doc);
  });
  const before = await snapshot(page); await finish(page, 0, [{ name: "WRONG-SITE" }]);
  expect(await snapshot(page)).toEqual(before);
  await expect(block(page).getByRole("button", { name: "データ取得", exact: true })).toBeVisible();
  await requests(page, 1);
});

test("runtime value B entered in the result survives reopening and is distinguished from the old A result", async ({ page }) => {
  await setUrl(page, "https://example.test/{missing}");
  await block(page).getByRole("textbox", { name: "missing のテスト用の値" }).fill("A");
  await send(page); await finish(page, 0, { name: "Result A" });
  await result(page).getByRole("textbox", { name: "missing のテスト用の値" }).fill("B");
  await expect(result(page).locator(".se-fetch-destination")).toContainText("https://example.test/B");
  await expect(result(page).locator(".se-fetch-result-source")).toContainText("https://example.test/A");
  await refresh(page).click(); await requests(page, 2); await finish(page, 1, { name: "Result B" });
  await close(page); await block(page).getByRole("button", { name: "データを見る", exact: true }).click();
  await expect(result(page).getByRole("textbox", { name: "missing のテスト用の値" })).toHaveValue("B");
  await expect(result(page).locator(".se-fetch-result-source")).toHaveCount(0);
  await expect(result(page).getByText("Result B", { exact: true })).toBeVisible();
  await expect(result(page).locator(".se-fetch-destination")).toContainText("https://example.test/B");
  await refresh(page).click(); await requests(page, 3);
  expect(await page.evaluate(() => (window as any).refetchRequests[2].input.url)).toBe("https://example.test/B");
  await finish(page, 2, { name: "Result B again" });
});


test("duplicatePage keeps a node fetch result on its authoring page", async ({ page }) => {
  await page.evaluate((doc) => {
    const store = (window as any).refetchEditor; store.getState().replaceDoc(doc);
    store.getState().duplicatePage("p"); (window as any).copiedFetchPage = store.getState().activePageId;
    store.getState().setActivePage("p");
  }, fetchScopeDoc("node"));
  const scoped = page.locator('[data-script-node="act"] [data-sel-key="step:scoped"]');
  await scoped.getByRole("button", { name: "データを見る", exact: true }).click();
  await refresh(page).click(); await requests(page, 1); await finish(page, 0, { origin: "AUTHOR-PAGE" });
  await expect(result(page).getByText("AUTHOR-PAGE", { exact: true })).toBeVisible();
  const samples = await page.evaluate(() => {
    const doc = (window as any).refetchEditor.getState().doc;
    const copyList = doc.nodes[doc.pages[(window as any).copiedFetchPage].children[0]];
    return { original: doc.nodes.act.scripts[0].steps[0].preview?.sample, copy: doc.nodes[copyList.children[0]].scripts[0].steps[0].preview?.sample };
  });
  expect(samples).toEqual({ original: { origin: "AUTHOR-PAGE" }, copy: { ok: true } });
});

test("same-page cloned node opens and refreshes its own result modal", async ({ page }) => {
  await page.evaluate((doc) => {
    const store = (window as any).refetchEditor; store.getState().replaceDoc(doc); store.getState().duplicateNode("act");
    (window as any).copiedFetchNode = store.getState().selection;
  }, fetchScopeDoc("node"));
  const copyId = await page.evaluate(() => (window as any).copiedFetchNode);
  const copyStepId = await page.evaluate((id) => (window as any).refetchEditor.getState().doc.nodes[id].scripts[0].steps[0].id, copyId);
  expect(copyStepId).not.toBe("scoped");
  const copied = page.locator(`[data-script-node="${copyId}"] [data-sel-key="step:${copyStepId}"]`);
  await copied.getByRole("button", { name: "データを見る", exact: true }).click();
  await refresh(page).click(); await finish(page, 0, { origin: "COPY-NODE" });
  await expect(result(page).getByText("COPY-NODE", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).refetchEditor.getState().doc.nodes.act.scripts[0].steps[0].preview?.sample)).toEqual({ ok: true });
});

test("refresh uses updated upstream data rather than the first test's frozen sample", async ({ page }) => {
  await setUrl(page, "https://example.test/{other.0.name}"); await send(page); await finish(page, 0, { answer: "first" }); await close(page);
  await page.evaluate(() => (window as any).refetchEditor.getState().updateDoc((doc: any) => {
    doc.pages.p.pageScripts[0].steps[1].preview.sample = [{ name: "LATEST" }];
  }));
  await block(page).getByRole("button", { name: "データを見る", exact: true }).click();
  await expect(result(page).locator(".se-fetch-destination")).toContainText("https://example.test/LATEST");
  await expect(result(page).locator(".se-fetch-result-source")).toContainText("https://example.test/Other");
  await refresh(page).click(); await requests(page, 2);
  expect(await page.evaluate(() => (window as any).refetchRequests[1].input.url)).toBe("https://example.test/LATEST");
  await finish(page, 1, { answer: "latest" });
});

test("a newly resolved upstream value replaces a hidden temporary input on reopen and refresh", async ({ page }) => {
  await setUrl(page, "https://example.test/{other.0.newfield}");
  await block(page).getByRole("textbox", { name: "other.0.newfield のテスト用の値", exact: true }).fill("TEMP");
  await send(page); await finish(page, 0, { answer: "temporary" }); await close(page);
  expect(await page.evaluate(() => (window as any).refetchRequests[0].input.url)).toBe("https://example.test/TEMP");
  await page.evaluate(() => (window as any).refetchEditor.getState().updateDoc((doc: any) => {
    doc.pages.p.pageScripts[0].steps[1].preview.sample = [{ name: "Other", newfield: "LATEST" }];
  }));
  await block(page).getByRole("button", { name: "データを見る", exact: true }).click();
  await expect(result(page).getByRole("textbox", { name: "other.0.newfield のテスト用の値", exact: true })).toHaveCount(0);
  await expect(result(page).locator(".se-fetch-destination")).toContainText("https://example.test/LATEST");
  await expect(result(page).locator(".se-fetch-result-source")).toContainText("https://example.test/TEMP");
  await requests(page, 1);
  await refresh(page).click(); await requests(page, 2);
  expect(await page.evaluate(() => (window as any).refetchRequests[1].input.url)).toBe("https://example.test/LATEST");
  await finish(page, 1, { answer: "current" });
});

test("a standalone read-only loop drag ghost preserves temporary local inputs", async ({ page }) => {
  const doc = fetchScopeDoc("loop"); delete (doc.pages.p.pageScripts![0].steps[2] as any).then[0].then[0].preview?.fetchedAt;
  await page.evaluate((doc) => (window as any).refetchEditor.getState().replaceDoc(doc), doc);
  const scoped = page.locator('.se-ws [data-sel-key="step:scoped"]');
  for (const name of ["details.id", "empty", "tags", "details"]) await scoped.getByRole("textbox", { name: `${name} のテスト用の値`, exact: true }).fill("LOCAL");
  const rect = await scoped.boundingBox();
  await page.mouse.move(rect!.x + 6, rect!.y + 6); await page.mouse.down();
  await page.mouse.move(rect!.x + 60, rect!.y + 65, { steps: 5 });
  await expect(page.locator(".se-ghost")).toBeVisible();
  await page.keyboard.press("Escape"); await page.mouse.up();
  for (const name of ["details.id", "empty", "tags", "details"]) await expect(scoped.getByRole("textbox", { name: `${name} のテスト用の値`, exact: true })).toHaveValue("LOCAL");
  await requests(page, 0);
});
