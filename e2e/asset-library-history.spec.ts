import { expect, test, type Page } from "@playwright/test";
import { assetLibraryBundle } from "../tests/helpers/asset-library";

let bundle: string;
test.beforeAll(async () => { bundle = await assetLibraryBundle(); });
test.beforeEach(async ({ page }) => {
  await page.route("http://asset-library.test/", (route) => route.fulfill({ contentType: "text/html", body: '<html><body><div id="app"></div></body></html>' }));
  await page.goto("http://asset-library.test/"); await page.addScriptTag({ content: bundle });
  await expect(page.locator(".asset-panel")).toBeVisible();
});
async function snapshot(page: Page) {
  return page.evaluate(() => { const s = (window as any).assetEditor.getState(); return { doc: s.doc, past: s.past, future: s.future }; });
}
async function settle(page: Page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function start(page: Page, kind: "upload" | "migration", path = "assets/completed.wav") {
  let arrived!: () => void; let release!: () => void;
  const started = new Promise<void>((resolve) => { arrived = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("http://asset-library.test/api/assets", async (route) => {
    arrived(); await gate; await route.fulfill({ contentType: "application/json", body: JSON.stringify({ path }) });
  });
  if (kind === "upload") await page.locator('input[type="file"]').setInputFiles({ name: "new.wav", mimeType: "audio/wav", buffer: Buffer.from("audio") });
  else {
    const card = page.locator('[data-asset-id="embedded"]');
    await card.hover();
    await card.locator('[data-tip="サーバーへアップロード"]').click();
  }
  await started;
  return async () => { const response = page.waitForResponse("http://asset-library.test/api/assets"); release(); await (await response).finished(); await settle(page); };
}

for (const boundary of ["undo", "undo-redo", "replace", "restore"] as const) {
  test(`${boundary} during asset creation preserves history and successfully added files`, async ({ page }) => {
    await page.evaluate(() => (window as any).assetEditor.getState().updateNode("a", { name: "Important edit" }));
    const finish = await start(page, "upload");
    if (boundary.startsWith("undo")) await page.locator("#undo").click();
    if (boundary === "undo-redo") await page.locator("#redo").click();
    if (boundary === "replace" || boundary === "restore") await page.evaluate((boundary) => {
      const s = (window as any).assetEditor.getState();
      if (boundary === "replace") s.replaceDoc(structuredClone(s.doc));
      else s.restoreDoc({ ...structuredClone(s.doc), siteName: "Restored" });
    }, boundary);
    const before = await snapshot(page); await finish();
    const after = await snapshot(page);
    const uploaded = Object.values(after.doc.assets).find((a: any) => a.path === "assets/completed.wav") as any;
    expect(uploaded).toBeTruthy();
    const retain = (doc: any) => ({ ...doc, assets: { ...doc.assets, [uploaded.id]: uploaded } });
    expect(after).toEqual({ doc: retain(before.doc), past: before.past.map(retain), future: before.future.map(retain) });
    for (let n = 0; n < 2; n++) {
      if (before.future.length) { await page.locator("#redo").click(); expect((await snapshot(page)).doc).toEqual(retain(before.future[0])); await page.locator("#undo").click(); }
      else if (before.past.length) { await page.locator("#undo").click(); expect((await snapshot(page)).doc).toEqual(retain(before.past.at(-1))); await page.locator("#redo").click(); }
      expect((await snapshot(page)).doc).toEqual(retain(before.doc));
    }
  });
}

for (const boundary of ["undo", "restore", "remote-source", "remote-path"] as const) {
  test(`${boundary} during server migration does not overwrite older files`, async ({ page }) => {
    await page.evaluate(() => (window as any).assetEditor.getState().updateNode("a", { name: "Important edit" }));
    const finish = await start(page, "migration");
    if (boundary === "undo") await page.locator("#undo").click();
    else await page.evaluate((boundary) => {
      const s = (window as any).assetEditor.getState(); const doc = structuredClone(s.doc);
      if (boundary === "restore") { doc.siteName = "Restored"; s.restoreDoc(doc); }
      else {
        if (boundary === "remote-source") doc.assets.embedded.dataUrl = "data:audio/wav;base64,bmV3";
        else { delete doc.assets.embedded.dataUrl; doc.assets.embedded.path = "assets/newer.wav"; }
        s.applyRemoteDoc(doc);
      }
    }, boundary);
    const before = await snapshot(page); await finish(); expect(await snapshot(page)).toEqual(before);
    await expect(page.locator('[data-tutorial="asset-upload"]')).toBeEnabled();
  });
}

test("Closing the tab and switching pages during migration preserves the file, background, and history", async ({ page }) => {
  const finish = await start(page, "migration");
  await page.evaluate(() => {
    const s = (window as any).assetEditor.getState(); s.setActivePage("q");
    s.updateDoc((d: any) => { d.assets.embedded.name = "renamed.wav"; }); (window as any).showAssets(false);
  });
  const before = await snapshot(page); await finish(); const after = await snapshot(page);
  expect(after.doc.assets.embedded.name).toBe("renamed.wav"); expect(after.doc.assets.embedded.dataUrl).toBeUndefined();
  const src = "/api/assets/file?path=assets%2Fcompleted.wav";
  expect(after.doc.nodes.a.media.src).toBe(src);
  expect(after.doc.nodes.a.styles.base.default.backgroundImage).toBe(`url("${src}")`);
  expect(after.doc.pages.p.bodyStyles.base.default.backgroundImage).toBe(`url("${src}")`);
  await page.locator("#undo").click(); expect((await snapshot(page)).doc).toEqual(before.doc);
  await page.locator("#redo").click(); expect((await snapshot(page)).doc).toEqual(after.doc);
  await page.evaluate(() => (window as any).showAssets(true));
  await expect(page.locator('[data-tip="サーバーへアップロード"]')).toHaveCount(0);
});

for (const kind of ["upload", "migration"] as const) {
  test(`Completing ${kind} during a numeric drag preserves independent Undo/Redo steps`, async ({ page }) => {
    const before = await snapshot(page); const finish = await start(page, kind);
    const handle = page.locator("#controls .field-pre.scrub"); const rect = await handle.boundingBox();
    expect(rect).toBeTruthy(); await page.mouse.move(rect!.x + rect!.width / 2, rect!.y + rect!.height / 2); await page.mouse.down();
    await page.mouse.move(rect!.x + rect!.width / 2 + 20, rect!.y + rect!.height / 2);
    await expect.poll(async () => (await snapshot(page)).doc.nodes.a.styles.base.default.width).toBe("110px");
    const edited = await snapshot(page); await finish(); expect(await snapshot(page)).toEqual(edited);
    await page.mouse.up(); await expect(page.locator('[data-tutorial="asset-upload"]')).toBeEnabled();
    const after = await snapshot(page); expect(after.doc).not.toEqual(edited.doc);
    await page.locator("#undo").click(); expect((await snapshot(page)).doc).toEqual(edited.doc);
    await page.locator("#undo").click(); expect((await snapshot(page)).doc).toEqual(before.doc);
    await page.locator("#redo").click(); expect((await snapshot(page)).doc).toEqual(edited.doc);
    await page.locator("#redo").click(); expect((await snapshot(page)).doc).toEqual(after.doc);
  });
}
