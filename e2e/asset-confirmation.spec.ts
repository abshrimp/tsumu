import { expect, test, type Page } from "@playwright/test";
import { assetConfirmationBundle, candidate, spare } from "../tests/helpers/asset-confirmation";

let bundle: string;
let deleted: string[];
test.beforeAll(async () => { bundle = await assetConfirmationBundle(); });
test.beforeEach(async ({ page }) => {
  deleted = [];
  await page.route("http://asset-confirmation.test/**", async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === "DELETE") {
      deleted.push(url.searchParams.get("path")!);
      return route.fulfill({ json: { ok: true } });
    }
    if (url.pathname.startsWith("/sites/")) return route.fulfill({ contentType: "text/html", body: `
      <html><body><div id="app"></div><style>
      .asset-grid { display: flex; gap: 20px; } .asset-thumb img { width: 20px; }
      .dialog-backdrop { position: fixed; inset: 0; background: #fff; }
      </style></body></html>` });
    if (url.pathname === "/api/assets/file") return route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>' });
    return route.fulfill({ json: { others: [], assets: false } });
  });
  await page.goto("http://asset-confirmation.test/sites/original");
  await page.addScriptTag({ content: bundle });
  await expect(page.locator(".asset-clean")).toBeVisible();
});

const doc = (page: Page) => page.evaluate(() => (window as any).assetEditor.getState().doc);
async function begin(page: Page, single = false) {
  if (single) await page.locator(`[data-asset-id="${candidate.id}"] [data-tip="削除"]`).click();
  else await page.locator(".asset-clean").click();
  await expect(page.getByRole("dialog")).toBeVisible();
}
async function finish(page: Page, ok = true) {
  if (ok) await page.getByRole("dialog").getByRole("button", { name: "削除", exact: true }).click();
  else await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

test("確認中に共同編集で使われた画像を残し、未使用のままのファイルだけを削除する", async ({ page }) => {
  await begin(page);
  await page.evaluate((id) => {
    const s = (window as any).assetEditor.getState(); const d = structuredClone(s.doc);
    d.nodes.image.image.assetId = id; d.nodes.image.image.src = "/api/assets/file?path=assets%2Fa.png";
    s.applyRemoteDoc(d);
  }, candidate.id);
  const before = await doc(page);
  await finish(page);
  await expect.poll(() => deleted).toEqual([spare.path]);
  await expect(page.locator(`[data-asset-id="${candidate.id}"]`)).toBeVisible();
  await expect(page.locator(`[data-asset-id="${spare.id}"]`)).toHaveCount(0);
  expect((await doc(page)).nodes).toEqual(before.nodes);
  await page.evaluate(() => (window as any).assetEditor.getState().undo());
  expect(await doc(page)).toEqual(before);
  await page.evaluate(() => (window as any).assetEditor.getState().redo());
  expect(Object.keys((await doc(page)).assets)).toEqual([candidate.id]);
});

test("確認後の新規アセットや新しく未使用になったアセットは削除対象に加えない", async ({ page }) => {
  await page.evaluate((id) => {
    (window as any).assetEditor.getState().updateDoc((d: any) => { d.nodes.image.image.assetId = id; });
  }, spare.id);
  await begin(page);
  await page.evaluate(() => {
    const s = (window as any).assetEditor.getState(); const d = structuredClone(s.doc);
    delete d.nodes.image.image.assetId;
    d.assets.added = { id: "added", name: "added.png", path: "assets/added.png", width: 10, height: 10 };
    s.applyRemoteDoc(d);
  });
  await finish(page);
  await expect.poll(() => deleted).toEqual([candidate.path]);
  expect(Object.keys((await doc(page)).assets)).toEqual([spare.id, "added"]);
});

for (const single of [false, true]) {
  test(`${single ? "個別" : "一括"}削除の確認中に差し替えたファイルを守る`, async ({ page }) => {
    await begin(page, single);
    await page.evaluate((id) => {
      const s = (window as any).assetEditor.getState(); const d = structuredClone(s.doc);
      d.assets[id].path = "assets/replacement.png"; s.applyRemoteDoc(d);
    }, candidate.id);
    await finish(page);
    if (!single) await expect.poll(() => deleted).toEqual([spare.path]);
    else expect(deleted).toEqual([]);
    expect((await doc(page)).assets[candidate.id].path).toBe("assets/replacement.png");
  });

  for (const stop of ["cancel", "unmount", "replace", "undoRedo", "site"] as const) {
    test(`${single ? "個別" : "一括"}削除の${stop}後に古い確認を適用しない`, async ({ page }) => {
      await page.evaluate(() => (window as any).assetEditor.getState().updateNode("media", { name: "Undoable" }));
      await begin(page, single);
      await page.evaluate((stop) => {
        const s = (window as any).assetEditor.getState();
        if (stop === "unmount") (window as any).closeAssetPanel();
        if (stop === "replace") s.replaceDoc(structuredClone(s.doc));
        if (stop === "undoRedo") { s.undo(); s.redo(); }
        if (stop === "site") history.pushState({}, "", "/sites/other");
      }, stop);
      if (stop === "unmount") await expect(page.locator(".asset-panel")).toHaveCount(0);
      const before = await doc(page);
      await finish(page, stop !== "cancel");
      expect(await doc(page)).toEqual(before);
      expect(deleted).toEqual([]);
    });
  }
}

test("未使用として個別確認した後に使われ始めた画像は参照ごと残す", async ({ page }) => {
  await begin(page, true);
  await page.evaluate((id) => {
    const s = (window as any).assetEditor.getState(); const d = structuredClone(s.doc);
    d.nodes.image.image.assetId = id; s.applyRemoteDoc(d);
  }, candidate.id);
  const before = await doc(page);
  await finish(page);
  expect(await doc(page)).toEqual(before); expect(deleted).toEqual([]);
});

test("使用中の個別削除は確認した画像だけを参照から外し、名前変更でも実行できる", async ({ page }) => {
  await page.evaluate((id) => {
    (window as any).assetEditor.getState().updateDoc((d: any) => { d.nodes.image.image.assetId = id; });
  }, candidate.id);
  await begin(page, true);
  await page.evaluate((id) => {
    const s = (window as any).assetEditor.getState(); const d = structuredClone(s.doc);
    d.assets[id].name = "renamed.png"; s.applyRemoteDoc(d);
  }, candidate.id);
  await finish(page);
  await expect.poll(() => deleted).toEqual([candidate.path]);
  const after = await doc(page);
  expect(after.nodes.image.image.assetId).toBeUndefined();
  expect(Object.keys(after.assets)).toEqual([spare.id]);
});

for (const single of [false, true]) {
  test(`${single ? "個別" : "一括"}削除の確認中に同じファイルの別IDが追加されても実体を消さない`, async ({ page }) => {
    await begin(page, single);
    await page.evaluate((asset) => {
      const s = (window as any).assetEditor.getState(); const d = structuredClone(s.doc);
      d.assets.alias = { ...asset, id: "alias" }; d.nodes.image.image.assetId = "alias";
      s.applyRemoteDoc(d);
    }, candidate);
    await finish(page);
    if (!single) await expect.poll(() => deleted).toEqual([spare.path]);
    else expect(deleted).toEqual([]);
    const after = await doc(page);
    expect(after.assets[candidate.id]).toBeUndefined();
    expect(after.assets.alias.path).toBe(candidate.path);
    expect(after.nodes.image.image.assetId).toBe("alias");
  });
}

test("同じファイルの全IDを確認して削除した場合、実体へのDELETEは1回だけ送る", async ({ page }) => {
  await page.evaluate(({ id, path }) => {
    (window as any).assetEditor.getState().updateDoc((d: any) => { d.assets[id].path = path; });
  }, { id: spare.id, path: candidate.path });
  await begin(page); await finish(page);
  await expect.poll(() => deleted).toEqual([candidate.path]);
  expect((await doc(page)).assets).toEqual({});
});
