import { test, expect, test as base, type Page } from "@playwright/test";
import { createInitialDoc } from "../lib/presets";
import { emptyDest } from "../lib/site";
import { storageKey } from "../lib/storage-keys";
import { homeSiteStorageBundle } from "../tests/helpers/home-site-storage";
import { browserDoc, browserDocIds, setBrowserDoc, deleteBrowserDoc } from "./helpers/browser-doc";
import { generateProject } from "../lib/generator";
import { copySiteStorageBundle } from "../tests/helpers/copy-site-storage";
import { emptyAssetDestination, encodedCssAssetDoc, picture, type CssLocation } from "../tests/helpers/encoded-css-assets";
import { build } from "../tests/helpers/bundle";
import { expectedCreate, expectedDocument, expectedTransaction, transactionCases } from "../tests/helpers/indexeddb-transactions";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { addPwaRetirementWorker } from "../lib/publish-pwa";
import { parseGeneratedManifest, planPublish, serializeGeneratedManifest } from "../lib/publish-files";
import { type SiteDoc } from "../lib/types";

test.describe("home-site-storage", () => {
const listKey = storageKey("sites-v1");
const source = { ...emptyDest(), id: "source", name: "Original", createdAt: 1, updatedAt: 2 };
let bundle: string;
test.beforeAll(async () => { bundle = await homeSiteStorageBundle(); });

async function prepare(page: import("@playwright/test").Page, large = false, provider: "github" | "netlify" = "github") {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("http://tsumu-home.test/**", route => {
    if (new URL(route.request().url()).pathname === "/api/sites") return route.fulfill({ status: 503, json: {} });
    if (new URL(route.request().url()).pathname === "/api/publish/provider") return route.fulfill({ status: 200, json: { provider } });
    return route.fulfill({ contentType: "text/html", body: '<html><body><div id="app"></div></body></html>' });
  });
  await page.goto("http://tsumu-home.test/");
  const doc = createInitialDoc();
  doc.siteName = "Original public title";
  doc.customHeadHtml = "<style>/* Authored source content */</style>";
  if (large) {
    doc.assets["large-binary"] = {
      id: "large-binary", name: "large.png", width: 1, height: 1,
      mimeType: "image/png", dataUrl: "data:image/png;base64," + "A".repeat(6 * 1024 * 1024),
    };
  }
  const raw = JSON.stringify(doc);
  const list = JSON.stringify([source]);
  await page.evaluate(({ list, listKey }) => {
    localStorage.setItem("tsumu-lang", "ja");
    localStorage.setItem(listKey, list);
  }, { list, listKey });
  await setBrowserDoc(page, source.id, raw);
  await page.addScriptTag({ content: bundle });
  await expect(page.locator(".home-card")).toHaveCount(1);
  return { errors, raw, list };
}

async function openDuplicate(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "サイトの操作" }).click();
  await page.getByRole("menuitem", { name: "複製", exact: true }).click();
  const dialog = page.locator(".home-dialog");
  await dialog.locator("input").first().fill("Duplicate");
  return dialog;
}

test("collapsed publishing fields keep their values and reopen for validation", async ({ page }) => {
  await prepare(page);
  const dialog = await openDuplicate(page);
  const summary = dialog.locator(".home-dest-head");
  const repo = dialog.getByPlaceholder("owner/site-repo");
  const url = dialog.getByPlaceholder("https://example.com", { exact: true });
  const submit = dialog.locator("button[type=submit]");

  await expect(repo).toBeHidden();
  await summary.press("Enter");
  await repo.fill("invalid");
  await url.fill("invalid URL");
  await summary.press("Space");
  await expect(url).toBeHidden();

  await submit.click();
  await expect(url).toBeFocused();
  await expect(url).toHaveValue("invalid URL");
  await url.fill("https://example.com");
  await summary.press("Enter");
  await submit.click();
  await expect(dialog.locator(".home-dialog-error")).toBeVisible();
  await expect(repo).toBeVisible();
  await expect(repo).toHaveValue("invalid");
  await repo.fill("owner/site");
  await submit.click();
  await expect(dialog).toHaveCount(0);
});

test("Netlify site settings do not ask for manual production or preview URLs", async ({ page }) => {
  const { errors } = await prepare(page, false, "netlify");
  await page.getByRole("button", { name: "サイトの操作" }).click();
  await page.getByRole("menuitem", { name: "設定", exact: true }).click();
  const dialog = page.locator(".home-dialog");
  await expect(dialog).toContainText("公開URLはNetlifyで自動管理されます");
  await expect(dialog.locator(".home-dest")).toHaveCount(0);
  await expect(dialog.getByPlaceholder("https://example.com")).toHaveCount(0);
  await dialog.locator("input").first().fill("Renamed Netlify site");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".home-card-name")).toHaveText("Renamed Netlify site");
  expect(errors).toEqual([]);
});

test("a large IndexedDB document can be duplicated without localStorage quota errors", async ({ page }) => {
  const { errors, raw } = await prepare(page, true);
  expect(raw.length).toBeGreaterThan(5 * 1024 * 1024);
  const dialog = await openDuplicate(page);
  await dialog.getByRole("button", { name: "複製", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".home-card")).toHaveCount(2);
  const sites = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!) as { id: string }[], listKey);
  expect(await browserDoc(page, sites[0].id)).toBe(raw);
  expect(await browserDoc(page, source.id)).toBe(raw);
  expect(await browserDocIds(page)).toHaveLength(2);
  expect(errors).toEqual([]);
});

type Action = "create" | "rename" | "duplicate" | "delete";
type Failure = "list" | "read" | "corrupt" | "marker";

for (const [action, failure] of [
  ["create", "list"],
  ["rename", "read"],
  ["duplicate", "corrupt"],
  ["delete", "marker"],
] as [Action, Failure][]) {
  test(`local ${action} keeps original content and retry input after ${failure} failure`, async ({ page }) => {
    const { errors, raw, list } = await prepare(page);
    const openAction = async () => {
      if (action === "create") await page.getByRole("button", { name: "新しいサイト", exact: true }).click();
      else {
        await page.getByRole("button", { name: "サイトの操作" }).click();
        await page.getByRole("menuitem", { name: action === "rename" ? "設定" : action === "duplicate" ? "複製" : "削除", exact: true }).click();
      }
      if (action === "delete") await page.locator(".dialog-input").fill("Original");
      else await page.locator("form.home-dialog input").first().fill("Retry name");
    };
    await openAction();
    await page.evaluate(({ failure, listKey }) => {
      const state = window as any;
      state.homeBlocked = true;
      state.homeRead = Storage.prototype.getItem;
      state.homeWrite = Storage.prototype.setItem;
      if (failure === "corrupt") localStorage.setItem(listKey, "{unreadable JSON");
      Storage.prototype.getItem = function (key) {
        if (state.homeBlocked && failure === "read" && key === listKey) throw new DOMException("Storage blocked", "SecurityError");
        return state.homeRead.call(this, key);
      };
      Storage.prototype.setItem = function (key, value) {
        if (state.homeBlocked && ((failure === "marker" && key.startsWith("tsumu-site-deleted-v1:")) || (failure === "list" && key === listKey))) {
          throw new DOMException("Storage full", "QuotaExceededError");
        }
        state.homeWrite.call(this, key, value);
      };
    }, { failure, listKey });
    const submit = () => action === "delete"
      ? page.getByRole("dialog").getByRole("button", { name: "削除", exact: true }).click()
      : page.locator("form.home-dialog button[type=submit]").click();
    await submit();
    const error = page.locator(action === "delete" ? ".dialog-msg" : ".home-dialog-error");
    await expect(error).toContainText("ブラウザの空き容量と設定を確認してから、もう一度");
    await expect(page).toHaveURL("http://tsumu-home.test/");
    await expect(page.locator(".home-card-name")).toHaveText("Original");
    expect(await page.evaluate((key) => (window as any).homeRead.call(localStorage, key), listKey))
      .toBe(failure === "corrupt" ? "{unreadable JSON" : list);
    expect(await browserDoc(page, source.id)).toBe(raw);
    expect(await browserDocIds(page)).toEqual([source.id]);
    if (action !== "delete") {
      await expect(page.locator("form.home-dialog input").first()).toHaveValue("Retry name");
      await expect(page.locator("form.home-dialog button[type=submit]")).toBeEnabled();
    }
    await page.evaluate(({ listKey, list }) => {
      const state = window as any;
      state.homeBlocked = false;
      state.homeWrite.call(localStorage, listKey, list);
    }, { listKey, list });
    if (action === "delete") {
      await page.getByRole("alertdialog").getByRole("button", { name: "OK", exact: true }).click();
      await openAction();
    }
    await submit();
    if (action === "create") await expect(page).toHaveURL(/\/sites\/[a-zA-Z0-9_-]+$/);
    else {
      await expect(page.locator("form.home-dialog,.dialog")).toHaveCount(0);
      await expect(page.locator(".home-card")).toHaveCount(action === "delete" ? 0 : action === "duplicate" ? 2 : 1);
    }
    const sites = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!) as { id: string; name: string }[], listKey);
    const firstDoc = sites[0] ? await browserDoc(page, sites[0].id) : null;
    if (action === "delete") expect(sites).toEqual([]);
    else {
      expect(sites[0].name).toBe("Retry name");
      if (action === "create") expect(JSON.parse(firstDoc!).siteName).toBe("Retry name");
      else expect(firstDoc).toBe(raw);
    }
    expect(await browserDoc(page, source.id)).toBe(action === "delete" ? null : raw);
    expect(errors).toEqual([]);
  });
}
});

test.describe("copy-site-storage", () => {
let defaultBundle: string;
test.beforeAll(async () => { defaultBundle = await copySiteStorageBundle(); });

test("copy dialog preserves unreadable IndexedDB documents across failure modes and allows retry", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("http://tsumu-copy.test/**", route => {
    if (new URL(route.request().url()).pathname === "/api/sites") return route.fulfill({ status: 503, json: {} });
    return route.fulfill({ contentType: "text/html", body: '<html><body><div id="app"></div></body></html>' });
  });
  await page.goto("http://tsumu-copy.test/sites/source");
  const doc = createInitialDoc();
  doc.siteName = "Keep this title";
  doc.customHeadHtml = "<!-- Destination content -->";
  const good = JSON.stringify(doc);
  await page.evaluate(site => {
    localStorage.setItem("tsumu-lang", "ja");
    localStorage.setItem("tsumu-sites-v1", JSON.stringify([site]));
    const state = window as any;
    state.failCopyRead = false;
    const get = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = function(key) {
      if (this.name === "documents" && key === "destination" && state.failCopyRead) {
        throw new DOMException("Read unavailable", "UnknownError");
      }
      return get.call(this, key);
    };
  }, { ...emptyDest(), id: "destination", name: "Destination", createdAt: 1, updatedAt: 1 });
  await page.addScriptTag({ content: defaultBundle });
  const button = page.locator(".copy-site-item");
  await expect(button.locator(".copy-site-name")).toHaveText("Destination");

  for (const failure of ["read", "json", "shape", "dangling", "breakpoints", "missing"] as const) {
    const bad = failure === "breakpoints"
      ? JSON.stringify({ ...doc, breakpoints: [{ id: "custom", label: "Custom", maxWidth: 800 }] })
      : failure === "json" ? '{"siteName":"recoverable"'
      : failure === "shape" ? JSON.stringify({ ...doc, pageOrder: [] })
      : failure === "dangling" ? JSON.stringify({
          ...doc,
          pages: { ...doc.pages, [doc.pageOrder[0]]: { ...doc.pages[doc.pageOrder[0]], children: ["missing-node"] } },
        })
      : failure === "missing" ? null : good;
    if (bad === null) {
      await deleteBrowserDoc(page, "destination");
    } else {
      await setBrowserDoc(page, "destination", bad);
    }
    await page.evaluate(fail => { (window as any).failCopyRead = fail; }, failure === "read");
    await button.click();
    await expect(page.locator(".copy-site-error")).toContainText(
      failure === "breakpoints" ? "画面幅の設定が違う" : "コピー先のサイトの編集データを読み込めませんでした"
    );
    await expect(page.locator(".copy-site-done")).toHaveCount(0);
    await page.evaluate(() => { (window as any).failCopyRead = false; });
    expect(await browserDoc(page, "destination")).toBe(bad);
  }

  await setBrowserDoc(page, "destination", good);
  await button.click();
  await expect(page.locator(".copy-site-done")).toContainText("Destination");
  const saved = JSON.parse((await browserDoc(page, "destination"))!);
  expect(saved.siteName).toBe(doc.siteName);
  expect(saved.customHeadHtml).toBe(doc.customHeadHtml);
  expect(saved.pageOrder.length).toBeGreaterThan(doc.pageOrder.length);
  expect(errors).toEqual([]);
});

for (const location of ["node.styles", "node.customCss", "page.bodyStyles"] as CssLocation[]) {
  test(`Copied pages include images referenced by CSS escapes in ${location}`, async ({ page }) => {
    const source = encodedCssAssetDoc(location, location !== "page.bodyStyles");
    const bundle = await copySiteStorageBundle(source);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("http://css-copy.test/**", (route) => {
      if (new URL(route.request().url()).pathname === "/api/sites") return route.fulfill({ status: 503, json: {} });
      return route.fulfill({ contentType: "text/html", body: '<html><body><div id="app"></div></body></html>' });
    });
    await page.goto("http://css-copy.test/sites/source");
    const destination = emptyAssetDestination();
    await page.evaluate(({ listKey, site }) => {
      localStorage.setItem("tsumu-lang", "ja");
      localStorage.setItem(listKey, JSON.stringify([site]));
    }, { listKey: storageKey("sites-v1"), site: { ...emptyDest(), id: "destination", name: "Destination", createdAt: 1, updatedAt: 1 } });
    await setBrowserDoc(page, "destination", JSON.stringify(destination));
    await page.addScriptTag({ content: bundle });
    await expect(page.locator(".copy-site-name")).toHaveText("Destination");
    await page.locator(".copy-site-item").click();
    await expect(page.locator(".copy-site-done")).toContainText("Destination");
    const saved = JSON.parse((await browserDoc(page, "destination"))!);
    expect(saved.pages.dest).toEqual(destination.pages.dest);
    expect(saved.pageOrder).toHaveLength(2);
    expect(Object.keys(saved.assets)).toEqual([picture.id]);
    expect(saved.assets[picture.id]).toEqual(picture);
    if (location !== "page.bodyStyles") expect(Object.keys(saved.components).sort()).toEqual(["inner", "outer"]);
    const exported = generateProject(saved);
    expect(exported.remoteAssets).toEqual({ "public/assets/hero.png": picture.path });
    expect(exported.files["styles/site.css"]).toContain("/assets/hero.png");
    expect(exported.files["styles/site.css"]).not.toContain("api/assets/file");
    expect(errors).toEqual([]);
  });
}
});

test.describe("indexeddb-transactions", () => {
test("native IndexedDB preserves transaction atomicity, concurrent creates, stale rejections, and cursor aborts", async ({ page }) => {
  const bundle = (await build({
    entryPoints: ["tests/helpers/indexeddb-transactions.ts"],
    bundle: true, platform: "browser", format: "iife", globalName: "storageScenarios", write: false,
  })).outputFiles[0].text;
  await page.route("http://tsumu-storage.test/**", route => route.fulfill({
    contentType: "text/html", body: "<!doctype html><title>Storage regressions</title>",
  }));
  await page.goto("http://tsumu-storage.test/");
  await page.addScriptTag({ content: bundle });

  for (const mode of transactionCases) {
    await test.step(`transaction ${mode} atomicity`, async () => {
      const result = await page.evaluate(mode =>
        (window as any).storageScenarios.transactionScenario(indexedDB, mode), mode);
      expect(result).toEqual(expectedTransaction(mode));
    });
  }

  await test.step("concurrent document creates", async () => {
    const result = await page.evaluate(() => (window as any).storageScenarios.browserDocumentCreateScenario());
    expect(result).toEqual(expectedCreate);
  });

  await test.step("stale document saves and unrelated documents", async () => {
    const result = await page.evaluate(() => (window as any).storageScenarios.browserDocumentScenario());
    expect(result).toEqual(expectedDocument);
  });

  for (const abort of [false, true]) {
    await test.step(`cursor ${abort ? "abort" : "complete"}`, async () => {
      const result = await page.evaluate(abort =>
        (window as any).storageScenarios.cursorScenario(indexedDB, abort), abort);
      expect(result).toEqual({ outcome: abort ? "abort" : "complete", seen: ["one"] });
    });
  }
});
});

test.describe("pwa-retirement", () => {
// ループバックだけで配信する使い捨ての CI のブラウザで、実際に生成した Service Worker を更新する。
// route.fulfill では Service Worker のリクエストを確かめられないため、小さな HTTP サーバーが必要。
// 実際のサイトへのデプロイや、既存のブラウザのプロファイルへの操作は、決して行わない。
async function startSite() {
  const doc: SiteDoc = {
    schemaVersion: 1, siteName: "PWA fixture", nodes: {}, assets: {}, pageOrder: ["home"],
    pages: { home: { id: "home", name: "Home", slug: "", title: "Home", description: "", children: [] } },
  };
  let files: Record<string, string> = {};
  let generated: Record<string, string> | null = null;
  let revision = 0;
  const workerResponses: { revision: number; status: number }[] = [];
  function publish(pwa: SiteDoc["pwa"]) {
    const target = { ...doc, pwa };
    const next = generateProject(target).files;
    const paths = Object.keys(next);
    addPwaRetirementWorker(target, generated, next, paths);
    expect(planPublish(generated ?? {}, generated, paths)).toEqual({ edited: [], clashing: [], kept: {} });
    files = next;
    generated = parseGeneratedManifest(serializeGeneratedManifest(Object.fromEntries(Object.entries(files).map(([path, text]) => [
      path, createHash("sha1").update(`blob ${Buffer.byteLength(text)}\0${text}`).digest("hex"),
    ]))))!;
    revision++;
    return { files: { ...files }, generated: { ...generated } };
  }
  publish({ enabled: true });
  const server = createServer((req, res) => {
    const path = new URL(req.url!, "http://localhost").pathname;
    res.setHeader("Cache-Control", "no-store");
    if (path === "/other/sw.js") {
      res.setHeader("Content-Type", "application/javascript");
      res.end(`self.addEventListener("install", e => e.waitUntil(self.skipWaiting()));
        self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
        self.addEventListener("fetch", e => {
          if (new URL(e.request.url).pathname === "/other/probe") e.respondWith(Promise.resolve(new Response("other-worker")));
        });`);
    } else if (path === "/sw.js" || path === "/pwa.js") {
      const script = files[`public${path}`];
      res.statusCode = script ? 200 : 404;
      if (path === "/sw.js") workerResponses.push({ revision, status: res.statusCode });
      res.setHeader("Content-Type", "application/javascript");
      res.end(script ?? "Not found");
    } else if (path.startsWith("/assets/")) {
      res.setHeader("Content-Type", "text/plain");
      res.setHeader("Cache-Control", "public, max-age=0");
      res.end(`asset-${revision}`);
    } else if (path === "/" || path === "/other/") {
      res.setHeader("Content-Type", "text/html");
      res.end(`<!doctype html><link rel="icon" href="data:,"><h1>Fixture ${revision}</h1>
        ${path === "/" && files["public/pwa.js"] ? '<script src="/pwa.js"></script>' : ""}`);
    } else {
      res.statusCode = 404;
      res.end("Not found");
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing fixture address");
  return {
    origin: `http://127.0.0.1:${address.port}`, publish, workerResponses,
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    },
  };
}

const test = base.extend<{ pwaSite: Awaited<ReturnType<typeof startSite>> }>({
  pwaSite: async ({}, use) => {
    const site = await startSite();
    try { await use(site); } finally { await site.close(); }
  },
});

async function expectEnabled(page: Page, origin: string) {
  await page.goto(origin);
  await page.waitForFunction(() => navigator.serviceWorker.controller?.state === "activated");
  await expect.poll(() => page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration("/");
    return registration?.active?.scriptURL;
  })).toBe(`${origin}/sw.js`);
}

async function cacheProbe(page: Page) {
  const text = await page.evaluate(async () => (await fetch("/assets/probe.txt", { cache: "no-store" })).text());
  await expect.poll(() => page.evaluate(async () => {
    const cache = await caches.open("site-pwa-v1");
    return (await cache.match("/assets/probe.txt"))?.text();
  })).toBe(text);
  return text;
}

async function updateAndExpectRetired(page: Page) {
  // 制御するのは更新の時刻だけ。登録・インストール・有効化・終了は、ブラウザに任せる。
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration("/");
    if (!registration) throw new Error("Expected the previously installed worker");
    await registration.update();
  });
  await expect.poll(() => page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration("/")))).toBe(false);
  await expect.poll(() => page.evaluate(() => caches.has("site-pwa-v1"))).toBe(false);
}

test("on → off retires the active worker, stops caching, and can be reenabled", async ({ page, context, pwaSite }) => {
  await expectEnabled(page, pwaSite.origin);
  const cached = await cacheProbe(page);
  await context.setOffline(true);
  expect(await page.evaluate(async () => (await fetch("/assets/probe.txt", { cache: "no-store" })).text())).toBe(cached);
  await context.setOffline(false);

  pwaSite.publish({ enabled: false });
  await updateAndExpectRetired(page);
  expect(pwaSite.workerResponses).toContainEqual({ revision: 2, status: 200 });
  // 既存のタブを開いたままでも、終了用の Worker は fetch のハンドラーを持ってはならない。
  expect(await page.evaluate(async () => (await fetch("/assets/after-off.txt", { cache: "no-store" })).text())).toBe("asset-2");
  expect(await page.evaluate(() => caches.has("site-pwa-v1"))).toBe(false);
  await context.setOffline(true);
  expect(await page.evaluate(() => fetch("/assets/probe.txt", { cache: "no-store" }).then(() => "served", () => "offline"))).toBe("offline");
  await context.setOffline(false);
  await page.reload();
  expect(await page.evaluate(() => navigator.serviceWorker.controller)).toBeNull();

  pwaSite.publish({ enabled: true });
  await expectEnabled(page, pwaSite.origin);
  expect(await cacheProbe(page)).toBe("asset-3");
});

test("repeated off publications keep a retirement endpoint for a delayed visitor without registering fresh visitors", async ({ page, context, browser, pwaSite }) => {
  await expectEnabled(page, pwaSite.origin);
  await cacheProbe(page);
  await context.setOffline(true);
  const first = pwaSite.publish({ enabled: false });
  const repeated = pwaSite.publish(undefined);
  expect(repeated.files["public/sw.js"]).toBe(first.files["public/sw.js"]);
  expect(repeated.generated["public/sw.js"]).toBe(first.generated["public/sw.js"]);
  // 更新できない訪問者には、終了用の更新に成功するまで、古い Worker が残る。
  expect(await page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration("/")))).toBe(true);
  expect(await page.evaluate(async () => (await fetch("/assets/probe.txt", { cache: "no-store" })).text())).toBe("asset-1");
  await context.setOffline(false);
  await updateAndExpectRetired(page);
  expect(pwaSite.workerResponses).toContainEqual({ revision: 3, status: 200 });

  const fresh = await browser.newContext();
  try {
    const visitor = await fresh.newPage();
    await visitor.goto(pwaSite.origin);
    expect(await visitor.evaluate(() => navigator.serviceWorker.getRegistrations().then(registrations => registrations.length))).toBe(0);
    expect(await visitor.evaluate(() => caches.keys())).toEqual([]);
  } finally { await fresh.close(); }
});

test("retirement preserves unrelated scoped registrations and caches, including a similarly named cache", async ({ page, context, pwaSite }) => {
  await expectEnabled(page, pwaSite.origin);
  await cacheProbe(page);
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.register("/other/sw.js", { scope: "/other/" });
    const worker = registration.installing ?? registration.waiting ?? registration.active;
    if (!worker) throw new Error("Missing unrelated worker");
    if (worker.state !== "activated") await new Promise<void>(resolve => {
      worker.addEventListener("statechange", () => { if (worker.state === "activated") resolve(); });
    });
    for (const name of ["customer-cache", "site-pwa-unrelated"]) {
      await (await caches.open(name)).put("/other/saved", new Response(name));
    }
  });
  const other = await context.newPage();
  await other.goto(`${pwaSite.origin}/other/`);
  await other.waitForFunction(() => navigator.serviceWorker.controller?.scriptURL.endsWith("/other/sw.js"));
  pwaSite.publish({ enabled: false });
  await updateAndExpectRetired(page);
  expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).map(registration => registration.scope))).toEqual([`${pwaSite.origin}/other/`]);
  expect(await page.evaluate(async () => Promise.all(["customer-cache", "site-pwa-unrelated"].map(async name => {
    return (await (await caches.open(name)).match("/other/saved"))?.text();
  })))).toEqual(["customer-cache", "site-pwa-unrelated"]);
  expect(await other.evaluate(async () => (await fetch("/other/probe")).text())).toBe("other-worker");
});
});
