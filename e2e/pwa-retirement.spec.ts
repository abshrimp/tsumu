import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { expect, test as base, type Page } from "@playwright/test";
import { generateProject } from "../lib/generator";
import { addPwaRetirementWorker } from "../lib/publish-pwa";
import { parseGeneratedManifest, planPublish, serializeGeneratedManifest } from "../lib/publish-files";
import type { SiteDoc } from "../lib/types";

// CI の使い捨てブラウザとループバック配信だけで、実際に生成した Worker を更新する。
// route.fulfill では Worker の取得を検証できないため、小さな HTTP サーバーを使う。
// 実サイトへの公開や、既存のブラウザプロファイルには触れない。
async function startSite() {
  const doc: SiteDoc = {
    siteName: "PWA fixture", nodes: {}, assets: {}, pageOrder: ["home"],
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
    const cache = await caches.open("site-pwa-v2");
    return (await cache.match("/assets/probe.txt"))?.text();
  })).toBe(text);
  return text;
}

async function updateAndExpectRetired(page: Page) {
  // 更新の時刻だけを明示する。登録・インストール・切り替え・終了処理は実際のブラウザに任せる。
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration("/");
    if (!registration) throw new Error("Expected the previously installed worker");
    await registration.update();
  });
  await expect.poll(() => page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration("/")))).toBe(false);
  await expect.poll(() => page.evaluate(() => caches.has("site-pwa-v2"))).toBe(false);
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
  // 既存タブを開いたままでも、終了用 Worker に fetch ハンドラは残らない。
  expect(await page.evaluate(async () => (await fetch("/assets/after-off.txt", { cache: "no-store" })).text())).toBe("asset-2");
  expect(await page.evaluate(() => caches.has("site-pwa-v2"))).toBe(false);
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
  // 更新できなかった訪問者には元の Worker が残り、終了は成功した更新まで遅れる。
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
