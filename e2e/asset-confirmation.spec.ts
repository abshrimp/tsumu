import { expect, test, type Page } from "@playwright/test";
import { createInitialDoc } from "../lib/presets";
import { assetConfirmationBundle, candidate, spare } from "../tests/helpers/asset-confirmation";

let bundle: string;
test.beforeAll(async () => { bundle = await assetConfirmationBundle(); });

test.describe("asset confirmation", () => {
  let deleted: string[];
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
  }

  // Node tests cover the complete matrix for both actions. Keep real keyboard,
  // React unmount, and browser navigation interactions here.
  for (const [single, stop] of [[true, "cancel"], [false, "unmount"], [true, "site"]] as const) {
    test(`${single ? "single" : "bulk"} deletion ignores stale confirmation after ${stop}`, async ({ page }) => {
      await begin(page, single);
      if (stop === "unmount") {
        await page.evaluate(() => (window as any).closeAssetPanel());
        await expect(page.locator(".asset-panel")).toHaveCount(0);
      }
      if (stop === "site") await page.evaluate(() => history.pushState({}, "", "/sites/other"));
      const before = await doc(page);
      await finish(page, stop !== "cancel");
      expect(await doc(page)).toEqual(before);
      expect(deleted).toEqual([]);
    });
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

  test("Bulk deletion preserves an image referenced by an escaped URL in custom CSS", async ({ page }) => {
    await page.evaluate((path) => {
      (window as any).assetEditor.getState().updateDoc((d: any) => {
        d.nodes.image.customCss = `background-image: url("\\2f api/assets/file?path=${encodeURIComponent(path)}");`;
      });
    }, candidate.path!);
    const before = await doc(page);
    await expect(page.locator(".asset-count")).toContainText("未使用 1件");
    await begin(page);
    await expect(page.getByRole("dialog")).toContainText("使っていないアセット 1件");
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
});

test.describe("asset download", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("http://asset-download.test/**", (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.startsWith("/sites/")) return route.fulfill({
        contentType: "text/html",
        body: '<html><body><div id="app"></div></body></html>',
      });
      if (url.pathname === "/api/assets/file") return route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>',
      });
      return route.fulfill({ json: {} });
    });
    await page.goto("http://asset-download.test/sites/original");
    await page.addScriptTag({ content: bundle });
  });
  const failure = "アセットをダウンロードできませんでした";
  const button = (id: string) => `[data-asset-id="${id}"] [data-tip="ダウンロード"]`;

  test("HTTP 404 and 500 show an error without downloading JSON, then retry saves original bytes/name", async ({ page }) => {
    const downloads: string[] = [], errors: string[] = [];
    page.on("download", (download) => downloads.push(download.suggestedFilename()));
    page.on("pageerror", (error) => errors.push(error.message));
    let currentStatus: number | null = 404;
    await page.route("**/api/assets/file?**", (route) => {
      if (route.request().resourceType() !== "fetch") return route.fallback();
      return currentStatus !== null
        ? route.fulfill({ status: currentStatus, json: { error: "synthetic storage error" } })
        : route.fulfill({ contentType: "image/png", body: Buffer.from([0, 1, 2, 255]) });
    });
    for (const status of [404, 500]) {
      currentStatus = status;
      await page.locator(button(candidate.id)).click();
      await expect(page.getByText(failure, { exact: true })).toBeVisible();
      expect(downloads).toEqual([]);
      expect(page.context().pages()).toHaveLength(1);
    }
    currentStatus = null;
    const completed = page.waitForEvent("download");
    await page.locator(button(candidate.id)).click();
    const download = await completed;
    expect(download.suggestedFilename()).toBe(candidate.name);
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks)).toEqual(Buffer.from([0, 1, 2, 255]));
    await expect(page.getByText(failure, { exact: true })).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  for (const interrupt of ["newer-download", "unmount", "replace-doc"] as const) {
    test(`late HTTP error after ${interrupt} does not appear`, async ({ page }) => {
      let release!: () => Promise<void>;
      let started!: () => void;
      const pending = new Promise<void>((resolve) => { started = resolve; });
      await page.route("**/api/assets/file?**", (route) => {
        if (route.request().resourceType() !== "fetch" || !route.request().url().includes(encodeURIComponent(candidate.path!))) return route.fallback();
        release = () => route.fulfill({ status: 404, json: { error: "missing" } });
        started();
      });
      await page.locator(button(candidate.id)).click();
      await pending;
      if (interrupt === "newer-download") {
        const downloaded = page.waitForEvent("download");
        await page.locator(button(spare.id)).click();
        await downloaded;
      } else {
        await page.evaluate((interrupt) => {
          if (interrupt === "unmount") (window as any).closeAssetPanel();
          else {
            const state = (window as any).assetEditor.getState();
            state.replaceDoc(structuredClone(state.doc));
          }
        }, interrupt);
      }
      const response = page.waitForResponse((r) => r.status() === 404);
      await release();
      await (await response).finished();
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await expect(page.getByText(failure, { exact: true })).toHaveCount(0);
    });
  }
});

test("static ZIP assets have file thumbnails, correct types and download behavior", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("tsumu-lang", "ja");
    localStorage.setItem("tsumu-help-seen-v1", "1");
  });
  await page.route("**/api/sites**", route => route.fulfill({ status: 503, json: {} }));
  await page.route("**/api/doc**", route => route.fulfill({ status: 503, json: {} }));
  await page.route("**/api/assets", route => route.fulfill({ status: 503, json: {} }));

  const doc = createInitialDoc();
  const binary = (mime: string, content: string) =>
    "data:" + mime + ";base64," + Buffer.from(content).toString("base64");
  doc.assets = {
    css: { id: "css", name: "app.css", width: 0, height: 0, mimeType: "text/css",
      dataUrl: binary("text/css", "body{color:red}") },
    js: { id: "js", name: "app.js", width: 0, height: 0, mimeType: "text/javascript",
      dataUrl: binary("text/javascript", "window.example=true;") },
    font: { id: "font", name: "font.woff2", width: 0, height: 0, mimeType: "font/woff2",
      dataUrl: binary("font/woff2", "fixture") },
    json: { id: "json", name: "data.json", width: 0, height: 0, mimeType: "application/json",
      dataUrl: binary("application/json", '{"ok":true}') },
  };
  await page.goto("/");
  await expect(page.getByRole("button", { name: "インポート", exact: true })).toBeEnabled();
  await page.getByLabel("ZIP・doc.json・HTMLファイルを選択").setInputFiles({
    name: "doc.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(doc)),
  });
  await expect(page).toHaveURL(/\/sites\/[a-z0-9-]+$/, { timeout: 30000 });
  await expect(page.locator(".app")).toBeVisible({ timeout: 30000 });
  await page.locator('[data-tutorial="left-tab-assets"]').click();
  for (const [id, ext, type] of [
    ["css", "CSS", "CSS"],
    ["js", "JS", "JavaScript"],
    ["font", "WOFF2", "フォント"],
    ["json", "JSON", "JSON"],
  ]) {
    const card = page.locator('[data-asset-id="' + id + '"]');
    await expect(card.locator(".asset-thumb.is-static")).toBeVisible();
    await expect(card.locator(".asset-static-extension")).toHaveText(ext);
    await expect(card.locator(".asset-dim")).toContainText(type);
    await expect(card.locator(".asset-thumb img")).toHaveCount(0);
  }
  const download = page.waitForEvent("download");
  await page.locator('[data-asset-id="css"] .asset-thumb').click();
  expect((await download).suggestedFilename()).toBe("app.css");
});
