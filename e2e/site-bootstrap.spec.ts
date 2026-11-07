import { test, expect, type Page } from "@playwright/test";
import { readEditorCss } from "../tests/helpers/editor-css";
import { siteBootstrapBundle } from "../tests/helpers/site-bootstrap";
import { setBrowserDoc } from "./helpers/browser-doc";
import { editorTitleBundle, editorTitleHydrationHtml } from "../tests/helpers/editor-title";

test.describe("site-bootstrap", () => {
let bundle: string;
const css = readEditorCss();
test.beforeAll(async () => { bundle = await siteBootstrapBundle(true); });

/** リクエストが完了する順序だけを制御し、実際のページとエディタを動かす。 */
async function prepare(page: Page, { strict = true, cached = false, localSite = false, query = "" } = {}) {
  await page.route("**/sites/bootstrap-test**", (route) => route.fulfill({
    contentType: "text/html", body: '<html><head></head><body><div id="app"></div></body></html>',
  }));
  await page.goto("/sites/bootstrap-test" + query);
  await page.addStyleTag({ content: css });
  await page.evaluate(({ strict, localSite }) => {
    const w = window as any;
    w.bootstrapStrict = strict;
    localStorage.setItem("tsumu-lang", "ja");
    localStorage.setItem("tsumu-help-seen-v1", "1");
    if (localSite) localStorage.setItem("tsumu-sites-v1", JSON.stringify([{ id: "bootstrap-test", name: "Local site" }]));
    const site = Promise.withResolvers<Response>(), module = Promise.withResolvers<void>(), doc = Promise.withResolvers<Response>();
    w.bootstrapModule = module.promise;
    w.bootstrap = {
      siteRequests: 0, docRequests: 0, writes: [] as string[],
      releaseSite: (status = 200) => site.resolve(Response.json({ site: { name: "Saved site", accessRole: "owner" } }, { status })),
      failSite: () => site.reject(new TypeError("offline")),
      releaseModule: () => module.resolve(),
      failModule: () => module.reject(new Error("Chunk load failed")),
      retryModule: () => { w.bootstrapModule = Promise.resolve(); },
      releaseDoc: (mode = "server") => {
        if (mode === "network") return doc.reject(new TypeError("offline"));
        const saved = w.bootstrapDoc(); saved.siteName = "Saved server document";
        for (const id of w.bootstrap.extraPages ?? []) {
          const first = saved.pages[saved.pageOrder[0]];
          saved.pages[id] = { ...first, id, name: id, slug: id, children: [] };
          saved.pageOrder.push(id);
        }
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
      if (String(url).startsWith("/api/sites/")) { w.bootstrap.siteRequests++; return site.promise.then((res) => res.clone()); }
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
  }, { strict, localSite });
  // エディタの動的な import より前に、実際の形式でキャッシュを用意する。
  await page.addScriptTag({ content: bundle });
  if (cached) {
    const raw = await page.evaluate(() => {
      const local = (window as any).bootstrapDoc(); local.siteName = "Cached local document";
      return JSON.stringify(local);
    });
    await setBrowserDoc(page, "bootstrap-test", raw);
  }
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
    w.loaderObserver.observe(document.getElementById("app")!, { childList: true, subtree: true });
  });
  // 最初の表示のアニメーションが終わってから、状態を進める。
  await page.locator(".boot-card").evaluate((el) => Promise.all(
    el.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations !== Infinity).map((a) => a.finished),
  ));
  await page.evaluate(() => { (window as any).startsBeforeImport = (window as any).loaderStarts; });
}

const settleFrames = (page: Page) =>
  page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));

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
  test(`The boot screen stays continuous when ${strict ? "StrictMode" : "normal mode"} is used and ${first} completes first`, async ({ page }) => {
    await prepare(page, { strict });
    await page.evaluate((first) => (window as any).bootstrap[first === "site" ? "releaseSite" : "releaseModule"](), first);
    await settleFrames(page);
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
  test(`Document loading in ${mode} mode exits through the same boot screen`, async ({ page }) => {
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
  test(`A ${status} site check for a missing site never starts the editor`, async ({ page }) => {
    await prepare(page);
    await page.evaluate((status) => (window as any).bootstrap.releaseSite(status), status);
    await expect(page.getByText("サイトが見つかりません", { exact: true })).toBeVisible();
    await page.evaluate(() => (window as any).bootstrap.releaseModule());
    await settleFrames(page);
    expect(await page.evaluate(() => (window as any).bootstrap.docRequests)).toBe(0);
    await expect(page.locator('[role="status"]')).toHaveCount(0);
    await page.evaluate(() => (window as any).disposeBootstrap());
  });
}

test("Editor import failure shows the existing error screen and retry performs one bootstrap", async ({ page }) => {
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
  test(`Leaving during the ${phase} stage prevents a late response from reopening the boot screen`, async ({ page }) => {
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
    await settleFrames(page);
    await expect(page.locator(".boot, [data-bootstrap-document]")).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).bootstrap.docRequests)).toBe(phase === "document" ? 1 : 0);
    // 同じルートを開き直すと、新しい起動処理が通常どおり完了する。
    await page.evaluate(() => (window as any).mountBootstrap());
    await expect(page.locator("[data-bootstrap-document]")).toHaveText("Saved server document");
    await expect(page.locator(".boot")).toHaveCount(0);
    await page.evaluate(() => (window as any).disposeBootstrap());
  });
}


test("Editor page query supports direct links and browser back/forward without reloading", async ({ page }) => {
  await prepare(page, { strict: false, query: "?other=keep&page=second#anchor" });
  await page.evaluate(() => {
    const w = window as any;
    w.bootstrap.extraPages = ["second", "third"];
    w.bootstrap.releaseSite();
    w.bootstrap.releaseModule();
  });
  await expect.poll(() => page.evaluate(() => (window as any).bootstrap.docRequests)).toBe(1);
  await page.evaluate(() => (window as any).bootstrap.releaseDoc());
  await expect(page.locator("[data-bootstrap-document]")).toBeVisible();
  const pageId = () => page.evaluate(() => (window as any).bootstrapEditor.getState().activePageId);
  await expect.poll(pageId).toBe("second");
  const originalDocument = await page.evaluate(() => (window as any).bootstrapEditor.getState().doc);
  await page.evaluate(() => { (window as any).originalHistoryCanvas = document.querySelector("[data-bootstrap-document]"); });
  await page.evaluate(() => (window as any).bootstrapEditor.getState().setActivePage("third"));
  await expect.poll(pageId).toBe("third");
  await expect.poll(() => page.evaluate(() => new URL(location.href).searchParams.get("page"))).toBe("third");
  expect(await page.evaluate(() => ({
    other: new URL(location.href).searchParams.get("other"),
    hash: location.hash,
  }))).toEqual({ other: "keep", hash: "#anchor" });
  await page.evaluate(() => history.back());
  await expect.poll(pageId).toBe("second");
  await page.evaluate(() => history.forward());
  await expect.poll(pageId).toBe("third");
  expect(await page.evaluate(() => (window as any).bootstrapEditor.getState().doc)).toEqual(originalDocument);
  expect(await page.locator("[data-bootstrap-document]").evaluate(el => el === (window as any).originalHistoryCanvas)).toBe(true);
  await page.evaluate(() => (window as any).disposeBootstrap());
});
});

test.describe("editor-title", () => {
let bundle: string;
test.beforeAll(async () => { bundle = await editorTitleBundle(); });

for (const source of ["server", "local"] as const) {
  test(`Late shared metadata does not overwrite the ${source === "server" ? "server" : "local-storage"} site title`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setContent('<html><head></head><body><div id="app"></div></body></html>');
    await page.evaluate((source) => {
      const state = window as any;
      state.titleLocalSites = [{ id: "title-test", name: "Local title" }];
      state.titleFetch = async () => Response.json(
        source === "server" ? { site: { name: "Server title" } } : { error: "unavailable" },
        { status: source === "server" ? 200 : 503 },
      );
    }, source);
    await page.addScriptTag({ content: bundle });
    const title = `${source === "server" ? "Server" : "Local"} title | Tsumu`;
    await expect(page.locator("[data-editor-ready]")).toBeVisible();
    await expect(page).toHaveTitle(title);
    // Next.js と同じように、メタデータは後から、別の Suspense の境界で解決する。
    await page.evaluate(() => (window as any).finishMetadata());
    await expect.poll(() => page.evaluate(() => (window as any).metadataReady)).toBe(true);
    await expect(page).toHaveTitle(title);
    await expect(page.locator("head title")).toHaveCount(1);
    expect(errors).toEqual([]);
  });
}

test("Editor errors and retries preserve the site name in the page title", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setContent('<html><head></head><body><div id="app"></div></body></html>');
  await page.evaluate(() => {
    (window as any).titleFetch = async () => Response.json({ site: { name: "Recovery title" } });
  });
  await page.addScriptTag({ content: bundle });
  await expect(page.locator("[data-editor-ready]")).toBeVisible();
  await expect(page).toHaveTitle("Recovery title | Tsumu");
  await page.evaluate(() => {
    (window as any).titleBeforeError = document.querySelector("title");
    (window as any).failTitleEditor();
  });
  await expect(page.locator(".safe-page")).toBeVisible();
  await expect(page.locator("[data-editor-ready]")).toHaveCount(0);
  await expect(page).toHaveTitle("Recovery title | Tsumu");
  await page.evaluate(() => (window as any).finishMetadata());
  await expect.poll(() => page.evaluate(() => (window as any).metadataReady)).toBe(true);
  await expect(page).toHaveTitle("Recovery title | Tsumu");
  await page.evaluate(() => { (window as any).titleEditorFailed = false; });
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.locator("[data-editor-ready]")).toBeVisible();
  await expect(page.locator(".safe-page")).toHaveCount(0);
  await expect(page).toHaveTitle("Recovery title | Tsumu");
  await expect(page.locator("head title")).toHaveCount(1);
  expect(await page.evaluate(() => document.querySelector("title") === (window as any).titleBeforeError)).toBe(true);
  expect(await page.evaluate(() => (window as any).titleCaughtErrors)).toEqual(["title fixture editor failure"]);
  expect(errors).toEqual([]);
});

test("SSR's default title changes to the site name without duplicates or hydration errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setContent(await editorTitleHydrationHtml());
  await expect(page).toHaveTitle("Tsumu");
  await expect(page.locator("head title")).toHaveCount(1);
  await page.evaluate(() => {
    (window as any).titleHydrate = true;
    (window as any).titleFetch = async () => Response.json({ site: { name: "Hydrated title" } });
  });
  await page.addScriptTag({ content: bundle });
  await expect(page.locator("[data-editor-ready]")).toBeVisible();
  await expect(page).toHaveTitle("Hydrated title | Tsumu");
  await expect(page.locator("head title")).toHaveCount(1);
  expect(await page.evaluate(() => (window as any).titleHydrationErrors)).toEqual([]);
  expect(errors).toEqual([]);
});
});

test.describe("editor-appearance", () => {
test("numeric fields use readable backgrounds in editor dark mode and orange for dark page overrides", async ({ page }) => {
  await page.setContent(`<html><body><aside class="panel-r">
    <div class="grp is-set">
      <span class="grp-label is-set" id="label">Spacing</span>
      <div style="--field: var(--field-base); --field-hover: var(--field-base-hover)">
        <div class="field" id="base"><input aria-label="Inherited margin" /></div>
      </div>
      <div style="--field: var(--field-set); --field-hover: var(--field-set-hover)">
        <div class="field" id="set"><input aria-label="Changed margin" /></div>
      </div>
    </div>
  </aside></body></html>`);
  await page.addStyleTag({ content: readEditorCss() });

  await page.evaluate(() => { document.documentElement.dataset.editorTheme = "dark"; });
  await expect(page.locator("#base")).toHaveCSS("background-color", "rgb(45, 51, 60)");
  await expect(page.locator("#set")).toHaveCSS("background-color", "rgb(44, 65, 97)");

  await page.locator(".panel-r").evaluate(el => el.classList.add("is-dark"));
  await expect(page.locator("#label")).toHaveCSS("color", "rgb(255, 178, 124)");
  await expect(page.locator("#set")).toHaveCSS("background-color", "rgb(81, 54, 38)");
  await page.locator("#set input").focus();
  await expect(page.locator("#set")).toHaveCSS("background-color", "rgb(81, 54, 38)");
  await expect(page.locator("#set")).toHaveCSS("border-color", "rgb(255, 178, 124)");
  await page.locator("#set input").blur();
  await page.locator("#base").hover();
  await expect(page.locator("#base")).toHaveCSS("background-color", "rgb(58, 65, 77)");
  await page.locator("#set").hover();
  await expect(page.locator("#set")).toHaveCSS("background-color", "rgb(104, 67, 46)");

  await page.mouse.move(0, 0);
  await page.evaluate(() => { document.documentElement.dataset.editorTheme = "light"; });
  await expect(page.locator("#base")).toHaveCSS("background-color", "rgb(240, 244, 249)");
  await expect(page.locator("#set")).toHaveCSS("background-color", "rgb(255, 232, 214)");
  await expect(page.locator("#label")).toHaveCSS("color", "rgb(194, 65, 12)");
});

test("home and editor share appearance preference without changing page theme", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("tsumu-help-seen-v1", "1"));
  await page.goto("/");
  await page.locator(".home-top .home-top-btn").filter({ hasText: "設定" }).click();
  const homeSettings = page.locator(".home-dialog");
  await expect(homeSettings.locator(".appearance-seg")).toBeVisible();
  await homeSettings.locator(".appearance-seg").getByRole("button", { name: "ダークモード" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-editor-theme", "dark");
  await homeSettings.getByRole("button", { name: "閉じる" }).click();

  const result = await page.request.post("/api/sites", { data: { name: "Appearance sync" } });
  expect(result.ok()).toBeTruthy();
  const { site } = await result.json();
  await page.goto(`/sites/${site.id}`);
  await expect(page.locator("html")).toHaveAttribute("data-editor-theme", "dark");
  await expect(page.locator(".hdr-page-theme")).toBeVisible();

  await page.locator(".hdr-page-theme .dd").click();
  await page.locator(".dd-menu .dd-item").filter({ hasText: "ダークモード" }).click();
  await page.locator(".panel-l .layer-row").first().click();
  await expect(page.locator(".panel-r")).toHaveClass(/is-dark/);
  await expect(page.locator(".panel-r .state-bar-theme")).toHaveText("ダークモードのスタイルを編集中");

  await page.locator(".hdr-more .icon-btn").click();
  await page.locator(".dd-menu .dd-item").filter({ hasText: "設定" }).click();
  await page.locator(".modal .appearance-seg").getByRole("button", { name: "ライトモード" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-editor-theme", "light");
  await expect(page.locator(".panel-r .state-bar-theme")).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("tsumu-editor-appearance"))).toBe("light");

  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-editor-theme", "light");
  await page.locator(".home-top .home-top-btn").filter({ hasText: "設定" }).click();
  await expect(page.locator(".home-dialog .appearance-seg").getByRole("button", { name: "ライトモード" }))
    .toHaveAttribute("aria-pressed", "true");
});
});
