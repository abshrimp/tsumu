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

test("An image newly used during confirmation is preserved while only still-unused files are deleted", async ({ page }) => {
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

test("Assets created or newly unused after confirmation are excluded from the deletion", async ({ page }) => {
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
  test(`${single ? "single" : "bulk"} deletion protects a replaced file while confirmation is open`, async ({ page }) => {
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
    test(`${single ? "single" : "bulk"} deletion ignores stale confirmation after ${stop}`, async ({ page }) => {
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

test("Confirming an unused image does not remove its references if it becomes used", async ({ page }) => {
  await begin(page, true);
  await page.evaluate((id) => {
    const s = (window as any).assetEditor.getState(); const d = structuredClone(s.doc);
    d.nodes.image.image.assetId = id; s.applyRemoteDoc(d);
  }, candidate.id);
  const before = await doc(page);
  await finish(page);
  expect(await doc(page)).toEqual(before); expect(deleted).toEqual([]);
});

test("Single deletion removes only the confirmed image references even if its name changes", async ({ page }) => {
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
  test(`${single ? "single" : "bulk"} deletion preserves a file with another asset ID added during confirmation`, async ({ page }) => {
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

test("Deleting all confirmed IDs of the same file sends only one DELETE request", async ({ page }) => {
  await page.evaluate(({ id, path }) => {
    (window as any).assetEditor.getState().updateDoc((d: any) => { d.assets[id].path = path; });
  }, { id: spare.id, path: candidate.path });
  await begin(page); await finish(page);
  await expect.poll(() => deleted).toEqual([candidate.path]);
  expect((await doc(page)).assets).toEqual({});
});

for (const location of ["node.styles", "node.customCss", "page.bodyStyles"] as const) {
  test(`Bulk deletion preserves an image referenced by CSS escapes in ${location}`, async ({ page }) => {
    await page.evaluate(({ location, path }) => {
      (window as any).assetEditor.getState().updateDoc((d: any) => {
        const css = `url("\\2f api/assets/file?path=${encodeURIComponent(path)}")`;
        if (location === "node.styles") d.nodes.image.styles = { base: { hover: { backgroundImage: css } } };
        if (location === "node.customCss") d.nodes.image.customCss = `background-image: ${css};`;
        if (location === "page.bodyStyles") d.pages.p.bodyStyles = { sm: { default: { backgroundImage: css } } };
      });
    }, { location, path: candidate.path! });
    const before = await doc(page);
    await expect(page.locator(".asset-count")).toContainText("未使用 1件");
    await begin(page);
    await expect(page.getByRole("dialog")).toContainText("使用していないアセット 1件");
    await finish(page);
    await expect.poll(() => deleted).toEqual([spare.path]);
    await expect(page.locator(`[data-asset-id="${candidate.id}"]`)).toBeVisible();
    await expect(page.locator(".asset-clean")).toHaveCount(0);
    const after = await doc(page);
    expect(after.nodes).toEqual(before.nodes);
    expect(after.pages).toEqual(before.pages);
    await page.evaluate(() => (window as any).assetEditor.getState().undo());
    expect(await doc(page)).toEqual(before);
    await page.evaluate(() => (window as any).assetEditor.getState().redo());
    expect(await doc(page)).toEqual(after);
  });
}
