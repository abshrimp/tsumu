import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { siteBootstrapBundle } from "../tests/helpers/site-bootstrap";

let bundle: string;
const css = readFileSync(resolve("app/globals.css"), "utf8");
test.beforeAll(async () => { bundle = await siteBootstrapBundle(true); });

/** 実際のページ・エディタを動かし、通信の完了順だけを制御する。 */
async function prepare(page: Page, { strict = true, cached = false, localSite = false } = {}) {
  await page.route("**/sites/bootstrap-test", (route) => route.fulfill({
    contentType: "text/html", body: '<html><head></head><body><div id="app"></div></body></html>',
  }));
  await page.goto("/sites/bootstrap-test");
  await page.addStyleTag({ content: css });
  await page.evaluate(({ strict, cached, localSite }) => {
    const w = window as any;
    w.bootstrapStrict = strict;
    localStorage.setItem("tsumu-lang", "ja");
    localStorage.setItem("tsumu-help-seen-v1", "1");
    if (localSite) localStorage.setItem("tsumu-sites-v1", JSON.stringify([{ id: "bootstrap-test", name: "Local site" }]));
    const deferred = () => {
      let resolve!: (value?: any) => void, reject!: (reason: any) => void;
      const promise = new Promise<any>((yes, no) => { resolve = yes; reject = no; });
      return { promise, resolve, reject };
    };
    const site = deferred(), module = deferred(), doc = deferred();
    w.bootstrapModule = module.promise;
    w.bootstrap = {
      siteRequests: 0, docRequests: 0, writes: [] as string[],
      releaseSite: (status = 200) => site.resolve(Response.json({ site: { name: "Saved site" } }, { status })),
      failSite: () => site.reject(new TypeError("offline")),
      releaseModule: () => module.resolve(),
      failModule: () => module.reject(new Error("Chunk load failed")),
      retryModule: () => { w.bootstrapModule = Promise.resolve(); },
      releaseDoc: (mode = "server") => {
        if (mode === "network") return doc.reject(new TypeError("offline"));
        const saved = w.bootstrapDoc(); saved.siteName = "Saved server document";
        const body = mode === "invalid" ? { exists: true } : mode === "new" ? { exists: false }
          : { exists: true, doc: saved, rev: "1", savedAt: 1 };
        doc.resolve(Response.json(body, { status: mode === "offline" ? 503 : mode === "error" ? 500 : 200 }));
      },
    };
    w.fetch = async (url: string, init?: RequestInit) => {
      if (init?.method && init.method !== "GET") {
        w.bootstrap.writes.push(init.method);
        return Response.json({ rev: "1", savedAt: 1 });
      }
      if (String(url).startsWith("/api/sites/")) { w.bootstrap.siteRequests++; return site.promise; }
      if (String(url).startsWith("/api/doc")) { w.bootstrap.docRequests++; return doc.promise; }
      throw new Error(`Unexpected request: ${url}`);
    };
    class OfflineTransport {
      static OPEN = 1; static CONNECTING = 0; static CLOSED = 3;
      readyState = 0;
      listeners: Record<string, (() => void)[]> = {};
      addEventListener(type: string, listener: () => void) { (this.listeners[type] ??= []).push(listener); }
      close() { this.readyState = 3; this.listeners.close?.forEach((listener) => listener()); }
    }
    w.WebSocket = w.EventSource = OfflineTransport;
  }, { strict, cached, localSite });
  // エディタの動的 import より前に、実際の形式のキャッシュを準備する。
  await page.addScriptTag({ content: bundle });
  if (cached) await page.evaluate(() => {
    const local = (window as any).bootstrapDoc(); local.siteName = "Cached local document";
    localStorage.setItem("tsumu-doc-v1:bootstrap-test", JSON.stringify(local));
  });
  await expect(page.locator(".boot-tip")).toContainText("ヒント");
  await page.evaluate(() => {
    const w = window as any;
    w.originalBoot = document.querySelector(".boot");
    w.originalCard = document.querySelector(".boot-card");
    w.originalTip = document.querySelector(".boot-tip")!.textContent;
    w.loaderStarts = 0;
    document.addEventListener("animationstart", (event) => {
      if ((event as AnimationEvent).animationName === "boot-in") w.loaderStarts++;
    });
    w.addedLoaders = [];
    w.loaderObserver = new MutationObserver((records) => {
      for (const record of records) for (const node of record.addedNodes) {
        if (node instanceof Element && node.matches('.boot[role="status"]')) w.addedLoaders.push(node);
      }
    });
    w.loaderObserver.observe(document.getElementById("app"), { childList: true, subtree: true });
  });
  // 最初の登場アニメーションが終わってから段階を進める。
  await page.waitForTimeout(420);
  await page.evaluate(() => { (window as any).startsBeforeImport = (window as any).loaderStarts; });
}

async function expectSameLoader(page: Page) {
  await expect(page.locator('.boot[role="status"]')).toHaveCount(1);
  expect(await page.evaluate(() => {
    const w = window as any;
    return {
      sameBoot: document.querySelector(".boot") === w.originalBoot,
      sameCard: document.querySelector(".boot-card") === w.originalCard,
      sameTip: document.querySelector(".boot-tip")!.textContent === w.originalTip,
      additions: w.addedLoaders.length,
      restarted: w.loaderStarts > w.startsBeforeImport,
    };
  })).toEqual({ sameBoot: true, sameCard: true, sameTip: true, additions: 0, restarted: false });
  await expect(page.locator("[data-bootstrap-document]")).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).bootstrap.writes)).toEqual([]);
}

for (const strict of [false, true]) for (const first of ["site", "module"] as const) {
  test(`準備画面を再表示しない: ${strict ? "StrictMode" : "通常"}・${first}が先に完了`, async ({ page }) => {
    await prepare(page, { strict });
    await page.evaluate((first) => (window as any).bootstrap[first === "site" ? "releaseSite" : "releaseModule"](), first);
    await page.waitForTimeout(100);
    await expectSameLoader(page);
    expect(await page.evaluate(() => (window as any).bootstrap.docRequests)).toBe(0);
    await page.evaluate((first) => (window as any).bootstrap[first === "site" ? "releaseModule" : "releaseSite"](), first);
    await expect.poll(() => page.evaluate(() => (window as any).bootstrap.docRequests)).toBe(1);
    await expectSameLoader(page);
    await page.evaluate(() => (window as any).bootstrap.releaseDoc());
    await expect(page.locator("[data-bootstrap-document]")).toHaveText("Saved server document");
    await expect(page.locator(".boot")).toHaveCount(0);
    await page.evaluate(() => (window as any).disposeBootstrap());
  });
}

for (const mode of ["server", "offline", "error", "network", "invalid", "new"] as const) {
  test(`文書取得が${mode}でも同じ準備画面から終了する`, async ({ page }) => {
    await prepare(page, { cached: mode !== "new", localSite: mode === "offline" });
    await page.evaluate((mode) => {
      (window as any).bootstrap.releaseSite(mode === "offline" ? 503 : 200);
      (window as any).bootstrap.releaseModule();
    }, mode);
    await expect.poll(() => page.evaluate(() => (window as any).bootstrap.docRequests)).toBe(1);
    await expectSameLoader(page);
    await page.evaluate((mode) => (window as any).bootstrap.releaseDoc(mode), mode);
    await expect(page.locator("[data-bootstrap-document]")).toBeVisible();
    await expect(page.locator(".boot")).toHaveCount(0);
    if (mode !== "new") await expect(page.locator("[data-bootstrap-document]")).toHaveText(
      mode === "server" ? "Saved server document" : "Cached local document",
    );
    expect(await page.evaluate(() => (window as any).bootstrap.writes)).toEqual(mode === "new" ? ["PUT"] : []);
    await page.evaluate(() => {
      (window as any).visibleDocument = document.querySelector("[data-bootstrap-document]");
      window.dispatchEvent(new Event("cloud-sync-retry"));
    });
    await expect(page.locator(".boot")).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).visibleDocument === document.querySelector("[data-bootstrap-document]"))).toBe(true);
    await page.evaluate(() => (window as any).disposeBootstrap());
  });
}

for (const status of [400, 404, 503]) {
  test(`サイト確認が${status}で存在しなければエディタを起動しない`, async ({ page }) => {
    await prepare(page);
    await page.evaluate((status) => (window as any).bootstrap.releaseSite(status), status);
    await expect(page.getByText("サイトが見つかりません", { exact: true })).toBeVisible();
    await page.evaluate(() => (window as any).bootstrap.releaseModule());
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => (window as any).bootstrap.docRequests)).toBe(0);
    await expect(page.locator('[role="status"]')).toHaveCount(0);
    await page.evaluate(() => (window as any).disposeBootstrap());
  });
}

test("本体の読み込み失敗は既存のエラー画面を出し、再試行で一度だけ準備する", async ({ page }) => {
  await prepare(page);
  await page.evaluate(() => { (window as any).bootstrap.releaseSite(); (window as any).bootstrap.failModule(); });
  await expect(page.locator(".safe-page")).toBeVisible();
  await expect(page.locator('[role="status"]')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).bootstrap.docRequests)).toBe(0);
  await page.evaluate(() => (window as any).bootstrap.retryModule());
  await page.getByRole("button", { name: "もう一度表示する", exact: true }).click();
  await expect(page.locator('[role="status"]')).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => (window as any).bootstrap.docRequests)).toBe(1);
  await page.evaluate(() => (window as any).bootstrap.releaseDoc());
  await expect(page.locator("[data-bootstrap-document]")).toHaveText("Saved server document");
  await expect(page.locator(".boot")).toHaveCount(0);
  await page.evaluate(() => (window as any).disposeBootstrap());
});

for (const phase of ["site", "module", "document"] as const) {
  test(`${phase}の待機中に離れると遅い応答で準備画面を復活させない`, async ({ page }) => {
    await prepare(page);
    if (phase !== "site") await page.evaluate(() => (window as any).bootstrap.releaseSite());
    if (phase === "document") {
      await page.evaluate(() => (window as any).bootstrap.releaseModule());
      await expect.poll(() => page.evaluate(() => (window as any).bootstrap.docRequests)).toBe(1);
    }
    await page.evaluate(() => (window as any).leaveBootstrap());
    await expect(page.locator("[data-left-editor]")).toBeVisible();
    await page.evaluate(() => {
      (window as any).bootstrap.releaseSite();
      (window as any).bootstrap.releaseModule();
      (window as any).bootstrap.releaseDoc();
    });
    await page.waitForTimeout(100);
    await expect(page.locator(".boot, [data-bootstrap-document]")).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).bootstrap.docRequests)).toBe(phase === "document" ? 1 : 0);
    // 同じルートを再度開くと、新しい一連の準備が正常に完了する。
    await page.evaluate(() => (window as any).mountBootstrap());
    await expect(page.locator("[data-bootstrap-document]")).toHaveText("Saved server document");
    await expect(page.locator(".boot")).toHaveCount(0);
    await page.evaluate(() => (window as any).disposeBootstrap());
  });
}
