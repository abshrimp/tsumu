import { expect, test, type Page } from "@playwright/test";
import { pendingImportBundle } from "../tests/helpers/pending-import";

let bundle: string;
test.beforeAll(async () => { bundle = await pendingImportBundle(); });
test.beforeEach(async ({ page }) => {
  await page.route("http://pending-import.test/", (route) => route.fulfill({ contentType: "text/html", body: '<html><body><div id="app"></div></body></html>' }));
  await page.goto("http://pending-import.test/");
  await page.addScriptTag({ content: bundle });
  await expect(page.locator('[data-tip="Google Fontsから追加"]')).toBeVisible();
});

async function hold(page: Page, pattern: string, body: string, contentType: string) {
  let arrived!: () => void;
  let release!: () => void;
  let finished!: () => void;
  let requestUrl = "";
  const started = new Promise<void>((resolve) => { arrived = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const done = new Promise<void>((resolve) => { finished = resolve; });
  await page.route(pattern, async (route) => {
    requestUrl = route.request().url();
    arrived();
    await gate;
    await route.fulfill({ contentType, body, headers: { "access-control-allow-origin": "*" } });
    finished();
  });
  return { started, finish: async () => {
    const response = page.waitForResponse((response) => response.url() === requestUrl);
    release();
    await done;
    await (await response).finished();
  } };
}
async function doc(page: Page) { return page.evaluate(() => (window as any).importEditor.getState().doc); }
async function settle(page: Page) {
  // 待機させたfetchとReactの更新が終わってから、遅れて書き換わらないことを確認する。
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function startFont(page: Page) {
  const request = await hold(page, "https://fonts.googleapis.com/**", "@font-face { font-family: New Font; font-weight: 100 900; }", "text/css");
  await page.locator('[data-tip="Google Fontsから追加"]').click();
  await page.getByPlaceholder("fonts.google.com の名前（例: Shippori Mincho）").fill("New Font");
  await page.getByRole("button", { name: "追加", exact: true }).click();
  await request.started;
  return request;
}
async function startImage(page: Page, picker = page.locator('[data-tutorial="style-background"] .img-pick')) {
  const request = await hold(page, "http://pending-import.test/api/assets", JSON.stringify({ path: "assets/new.svg" }), "application/json");
  await picker.locator(".img-pick-thumb").click();
  await picker.locator('input[type="file"]').setInputFiles({ name: "new.svg", mimeType: "image/svg+xml", buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>') });
  await request.started;
  return request;
}

for (const change of ["breakpoint", "state", "selection", "multiselection"] as const) {
  test(`フォントの読み込み中に${change}を変えても別の編集先へ反映しない`, async ({ page }) => {
    const pending = await startFont(page);
    await page.evaluate((change) => {
      const s = (window as any).importEditor.getState();
      if (change === "breakpoint") s.setBreakpoint("sm");
      if (change === "state") s.setStyleState("hover");
      if (change === "selection") s.select("b");
      if (change === "multiselection") (window as any).importEditor.setState({ selectedIds: ["a", "b"] });
    }, change);
    await settle(page);
    const before = await doc(page);
    await pending.finish(); await settle(page);
    expect(await doc(page)).toEqual(before);
    await expect(page.getByRole("button", { name: "確認中…", exact: true })).toHaveCount(0);
  });
}

test("画像のアップロード待ちで別のアセットを選ぶと、その選択と元に戻す・やり直すを保つ", async ({ page }) => {
  const pending = await startImage(page);
  await page.locator('.img-pick-cell[data-tip="old.svg"]').click();
  const chosen = await doc(page);
  expect(chosen.nodes.a.styles.base.default.backgroundImage).toContain("data:image/svg+xml");
  await pending.finish(); await settle(page);
  const completed = await doc(page);
  expect({ ...completed, assets: chosen.assets }).toEqual(chosen);
  expect(Object.values(completed.assets)).toContainEqual(expect.objectContaining({ path: "assets/new.svg" }));
  await page.evaluate(() => (window as any).importEditor.getState().undo());
  expect(await doc(page)).toEqual(chosen);
  await page.evaluate(() => (window as any).importEditor.getState().redo());
  expect(await doc(page)).toEqual(completed);
  await page.evaluate(() => { (window as any).importEditor.getState().undo(); (window as any).importEditor.getState().undo(); });
  expect((await doc(page)).nodes.a.styles.base.default.backgroundImage).toBe('url("https://example.test/a.png")');
});

test("画像のアップロード中に画面幅を変えても背景を別の画面幅へ書き込まない", async ({ page }) => {
  const pending = await startImage(page);
  await page.evaluate(() => (window as any).importEditor.getState().setBreakpoint("sm"));
  await settle(page);
  const before = await doc(page);
  await pending.finish(); await settle(page);
  const completed = await doc(page);
  expect({ ...completed, assets: before.assets }).toEqual(before);
  expect(Object.values(completed.assets)).toContainEqual(expect.objectContaining({ path: "assets/new.svg" }));
});

test("ページOGP画像の読み込み中にページを変えても完了した画像だけをアセットに残す", async ({ page }) => {
  await page.evaluate(() => (window as any).importEditor.getState().select(null));
  await page.locator('[data-tutorial="page-seo"] .sec-head').click();
  const picker = page.locator('[data-tutorial="page-settings"] .img-pick');
  await expect(picker).toBeVisible();
  const pending = await startImage(page, picker);
  await page.evaluate(() => (window as any).importEditor.getState().setActivePage("q"));
  await settle(page);
  const before = await doc(page);
  await pending.finish(); await settle(page);
  const completed = await doc(page);
  expect({ ...completed, assets: before.assets }).toEqual(before);
  expect(Object.values(completed.assets)).toContainEqual(expect.objectContaining({ path: "assets/new.svg" }));
});

test("閉じたフォント追加の結果は反映せず、その後の追加は成功する", async ({ page }) => {
  const pending = await startFont(page);
  await page.locator('[data-tip="Google Fontsから追加"]').click();
  const before = await doc(page);
  await pending.finish(); await settle(page);
  expect(await doc(page)).toEqual(before);
  await page.unroute("https://fonts.googleapis.com/**");
  await page.route("https://fonts.googleapis.com/**", (route) => route.fulfill({ contentType: "text/css", body: "@font-face { font-weight: 100 900; }", headers: { "access-control-allow-origin": "*" } }));
  await page.locator('[data-tip="Google Fontsから追加"]').click();
  await page.getByRole("button", { name: "追加", exact: true }).click();
  await expect.poll(async () => (await doc(page)).nodes.a.styles.base.default.fontFamily).toBe("New Font");
  expect((await doc(page)).customFonts).toEqual([{ family: "New Font", weights: "variable" }]);
});

test("画像ピッカーを閉じると遅いアップロードで背景を変更しない", async ({ page }) => {
  const pending = await startImage(page);
  await page.locator('[data-tutorial="style-background"] .img-pick-thumb').click();
  const before = await doc(page);
  await pending.finish(); await settle(page);
  const completed = await doc(page);
  expect({ ...completed, assets: before.assets }).toEqual(before);
  expect(Object.values(completed.assets)).toContainEqual(expect.objectContaining({ path: "assets/new.svg" }));
});

for (const boundary of ["undo", "undo-redo", "replace", "restore"] as const) {
  test(`画像読み込み中の${boundary}後は編集履歴と完了ファイルを保ち、古い割り当てをしない`, async ({ page }) => {
    await page.evaluate(() => (window as any).importEditor.getState().updateNode("b", { name: "Edit to redo" }));
    const pending = await startImage(page);
    await page.evaluate((boundary) => {
      const s = (window as any).importEditor.getState();
      if (boundary === "undo" || boundary === "undo-redo") s.undo();
      if (boundary === "undo-redo") s.redo();
      if (boundary === "replace") s.replaceDoc(structuredClone(s.doc));
      if (boundary === "restore") s.restoreDoc({ ...structuredClone(s.doc), siteName: "Restored" });
    }, boundary);
    const before = await page.evaluate(() => {
      const s = (window as any).importEditor.getState();
      return { doc: s.doc, past: s.past, future: s.future, selection: s.selection, selectedIds: s.selectedIds };
    });
    await pending.finish(); await settle(page);
    const after = await page.evaluate(() => {
      const s = (window as any).importEditor.getState();
      return { doc: s.doc, past: s.past, future: s.future, selection: s.selection, selectedIds: s.selectedIds };
    });
    const file = Object.values(after.doc.assets).find((asset: any) => asset.path === "assets/new.svg") as any;
    expect(file).toBeTruthy();
    const retained = (doc: any) => ({ ...doc, assets: { ...doc.assets, [file.id]: file } });
    expect(after).toEqual({ ...before, doc: retained(before.doc), past: before.past.map(retained), future: before.future.map(retained) });
    for (let i = 0; i < 2; i++) {
      if (before.future.length) {
        await page.evaluate(() => (window as any).importEditor.getState().redo());
        expect(await doc(page)).toEqual(retained(before.future[0]));
        await page.evaluate(() => (window as any).importEditor.getState().undo());
        expect(await doc(page)).toEqual(retained(before.doc));
      } else if (before.past.length) {
        await page.evaluate(() => (window as any).importEditor.getState().undo());
        expect(await doc(page)).toEqual(retained(before.past.at(-1)));
        await page.evaluate(() => (window as any).importEditor.getState().redo());
        expect(await doc(page)).toEqual(retained(before.doc));
      }
    }
  });
}

test("フォント読み込み中の無関係なUndo後もRedoを残し、古いフォントを登録しない", async ({ page }) => {
  await page.evaluate(() => (window as any).importEditor.getState().updateNode("b", { name: "Edit to redo" }));
  const pending = await startFont(page);
  await page.evaluate(() => (window as any).importEditor.getState().undo());
  const before = await doc(page);
  await pending.finish(); await settle(page);
  expect(await doc(page)).toEqual(before);
  await page.evaluate(() => (window as any).importEditor.getState().redo());
  expect((await doc(page)).nodes.b.name).toBe("Edit to redo");
  expect((await doc(page)).customFonts).toBeUndefined();
});
