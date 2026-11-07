import { test, expect, type Page } from "@playwright/test";
import { createInitialDoc } from "../lib/presets";
import { assetConfirmationBundle, candidate, spare } from "../tests/helpers/asset-confirmation";
import { assetLibraryBundle } from "../tests/helpers/asset-library";
import { readEditorCss } from "../tests/helpers/editor-css";
import { assetWindowBundle } from "../tests/helpers/asset-window-browser";

test.describe("asset-confirmation", () => {
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
});

test.describe("asset-library-history", () => {
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
});

test.describe("asset-window", () => {
let bundle: string;
let imageRequests: Set<string>;
const css = readEditorCss();
const id = (index: number) => `library_asset_${String(index).padStart(6, "0")}`;
const card = (page: Page, index: number) => page.locator(`[data-asset-id="${id(index)}"]`);
const frame = (page: Page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
async function scroll(page: Page, top: number | "bottom") {
  await page.locator(".asset-panel .panel-body").evaluate((el, top) => { el.scrollTop = top === "bottom" ? el.scrollHeight : top; }, top);
  await frame(page);
}
async function bounded(page: Page) {
  await expect.poll(() => page.locator(".asset-card").count()).toBeLessThan(40);
}
test.beforeAll(async () => { bundle = await assetWindowBundle(); });
test.beforeEach(async ({ page }) => {
  imageRequests = new Set();
  page.on("request", (r) => { if (r.url().includes("/api/assets/file")) imageRequests.add(r.url()); });
  await page.route("http://asset-window.test/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith("/sites/")) return route.fulfill({ contentType: "text/html", body: `<!doctype html><html lang="ja"><head><style>${css}</style></head><body><div id="app"></div></body></html>` });
    if (url.pathname === "/api/assets/file") return route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900"><rect width="1200" height="900" fill="lightblue"/></svg>' });
    if (route.request().method() === "POST") return route.fulfill({ json: { path: "assets/uploaded.svg" } });
    return route.fulfill({ json: { others: [], assets: false, ok: true } });
  });
  await page.goto("http://asset-window.test/sites/synthetic");
  await page.addScriptTag({ content: bundle });
  await expect(card(page, 0)).toBeVisible();
});

test("Virtualizing 5,000 images limits DOM nodes and requests to the viewport while keeping the end reachable", async ({ page }) => {
  await bounded(page);
  expect(await page.locator(".asset-card").first().getAttribute("aria-setsize")).toBe("5000");
  await expect.poll(() => imageRequests.size).toBeLessThan(40);
  await scroll(page, "bottom");
  await expect(card(page, 4999)).toBeVisible();
  await bounded(page);
  const box = await card(page, 4999).boundingBox();
  const previous = await card(page, 4997).boundingBox();
  const width = await page.locator(".panel-body").evaluate((el) => el.clientWidth);
  expect(box!.y - previous!.y).toBeCloseTo((width - 34) / 2 * 3 / 4 + 50, 0);
  await scroll(page, 0);
  await expect(card(page, 0)).toBeVisible();
});

test("Searching and clearing a search from a deep scroll position still finds every asset", async ({ page }) => {
  await scroll(page, "bottom");
  const search = page.locator(".asset-search input");
  await search.fill("Photo 004999");
  await expect(page.locator(".asset-card")).toHaveCount(1);
  await expect(card(page, 4999)).toBeVisible();
  await search.press("Escape");
  await expect(card(page, 0)).toBeVisible();
  await bounded(page);
  await search.fill("Photo 004");
  await expect(page.locator(".asset-count")).toContainText("1000 / 5000");
  await expect(card(page, 4000)).toBeVisible();
  await bounded(page);
  await search.fill("missing");
  await expect(page.locator(".asset-card")).toHaveCount(0);
  await page.getByRole("button", { name: "検索をクリア" }).click();
  await expect(card(page, 0)).toBeVisible();
});

test("Reveal requests remove the filter and scroll to an asset that was not rendered", async ({ page }) => {
  await page.locator(".asset-search input").fill("Photo 000001");
  await page.evaluate((id) => (window as any).assetEditor.getState().revealAsset(id), id(4500));
  await expect(page.locator(".asset-search input")).toHaveValue("");
  await expect(card(page, 4500)).toBeVisible();
  await expect(card(page, 4500)).toHaveClass(/is-revealed/);
  await bounded(page);
});

test("Reopening a tab restores scroll, and resizing does not overlap rows", async ({ page }) => {
  await scroll(page, 20000);
  const before = await page.locator(".panel-body").evaluate((el) => el.scrollTop);
  await page.evaluate(() => (window as any).setAssetPanelOpen(false));
  await expect(page.locator(".asset-panel")).toHaveCount(0);
  await page.evaluate(() => (window as any).setAssetPanelOpen(true));
  await expect(page.locator(".asset-panel")).toBeVisible();
  await expect.poll(() => page.locator(".panel-body").evaluate((el) => el.scrollTop)).toBeCloseTo(before, 0);
  await page.locator("#asset-host").evaluate((el) => { el.style.width = "380px"; el.style.height = "500px"; });
  await frame(page);
  await scroll(page, "bottom");
  await expect(card(page, 4999)).toBeVisible();
  const a = await card(page, 4997).boundingBox(), b = await card(page, 4999).boundingBox();
  expect(b!.y).toBeGreaterThan(a!.y + a!.height);
  await bounded(page);
});

test("Offscreen focus and Tab/Shift+Tab retain the logical navigation order", async ({ page }) => {
  await card(page, 0).locator(".asset-thumb").focus();
  await scroll(page, "bottom");
  await expect(card(page, 0).locator(".asset-thumb")).toBeFocused();
  await card(page, 0).getByRole("button", { name: "削除", exact: true }).evaluate((el: HTMLElement) => el.focus({ preventScroll: true }));
  await page.keyboard.press("Tab");
  await expect(card(page, 1).locator(".asset-thumb")).toBeFocused();
  await expect(card(page, 1)).toBeVisible();
  await page.keyboard.press("Shift+Tab");
  await expect(card(page, 0).getByRole("button", { name: "削除", exact: true })).toBeFocused();
  await scroll(page, "bottom");
  await card(page, 4999).getByRole("button", { name: "削除", exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(page.locator("#after")).toBeFocused();
  await scroll(page, 0);
  await card(page, 0).locator(".asset-thumb").focus();
  await page.keyboard.press("Shift+Tab");
  await expect(page.locator(".asset-clean")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(card(page, 0).locator(".asset-thumb")).toBeFocused();
  await page.locator("#after").focus();
  await page.keyboard.press("Shift+Tab");
  await expect(card(page, 4999).getByRole("button", { name: "削除", exact: true })).toBeFocused();
  await expect(card(page, 4999)).toBeVisible();
  await bounded(page);
});

test("Scrolling during rename preserves the input, Enter saves, and Escape cancels", async ({ page }) => {
  await card(page, 0).hover();
  await card(page, 0).getByRole("button", { name: "名前を変更" }).click();
  const input = card(page, 0).locator(".asset-rename");
  await input.fill("Edited");
  await scroll(page, "bottom");
  await expect(input).toHaveValue("Edited");
  await page.keyboard.press("Enter");
  await page.locator(".asset-search input").fill("Edited");
  await expect(card(page, 0).locator(".asset-name")).toHaveText("Edited.png");
  await card(page, 0).hover();
  await card(page, 0).getByRole("button", { name: "名前を変更" }).click();
  await input.fill("Cancelled");
  await input.press("Escape");
  await expect(card(page, 0).locator(".asset-name")).toHaveText("Edited.png");
});

test("An actively dragged card remains mounted and passes its asset ID to the canvas", async ({ page }) => {
  await card(page, 0).locator(".asset-thumb").evaluate((el) => {
    const transfer = new DataTransfer();
    el.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: transfer }));
    (window as any).assetDrag = { id: transfer.getData("application/x-tsumu-asset"), effect: transfer.effectAllowed };
  });
  await scroll(page, "bottom");
  await expect(card(page, 0)).toHaveCount(1);
  expect(await page.evaluate(() => (window as any).assetDrag.id)).toBe(id(0));
  await card(page, 0).locator(".asset-thumb").dispatchEvent("dragend");
  await expect(card(page, 0)).toHaveCount(0);
  await bounded(page);
});

test("Replacing an offscreen image uses the latest preview and insertion source", async ({ page }) => {
  await page.evaluate((id) => {
    const s = (window as any).assetEditor.getState(), d = structuredClone(s.doc);
    d.assets[id].path = "assets/replaced.png"; s.applyRemoteDoc(d); s.revealAsset(id);
  }, id(4999));
  await expect(card(page, 4999).locator("img")).toHaveAttribute("src", "/api/assets/file?path=assets%2Freplaced.png&site=synthetic");
  await card(page, 4999).locator(".asset-thumb").click();
  expect(await page.evaluate(() => Object.values((window as any).assetEditor.getState().doc.nodes).map((n: any) => n.image?.src)))
    .toContain("/api/assets/file?path=assets%2Freplaced.png&site=synthetic");
});

test("Deleting the last row does not leave an empty viewport, and newly dropped images remain discoverable", async ({ page }) => {
  await scroll(page, "bottom");
  await card(page, 4999).hover();
  await card(page, 4999).getByRole("button", { name: "削除", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "削除", exact: true }).click();
  await expect(card(page, 4999)).toHaveCount(0);
  await expect(card(page, 4998)).toBeVisible();
  await page.locator(".asset-panel").evaluate((el) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"/>'], "Dropped.svg", { type: "image/svg+xml" }));
    el.dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer: transfer }));
  });
  await page.locator(".asset-search input").fill("Dropped");
  await expect(page.locator(".asset-name")).toHaveText("Dropped.svg");
  await expect(page.locator(".asset-thumb img")).toHaveAttribute("src", "/api/assets/file?path=assets%2Fuploaded.svg&site=synthetic");
});
});
