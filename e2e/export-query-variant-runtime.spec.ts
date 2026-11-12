import { expect, test } from "@playwright/test";
import { generateExportProject } from "../lib/export-formats";
import { makeBox } from "../lib/presets";
import type { SiteDoc } from "../lib/types";

/**
 * 実際の Chromium で、要求された HTML の派生を選んだ後に、利用者が書いたスクリプトを実行し、
 * その後でだけ、生成したページのランタイムを登録しなければならない。
 * この準備は、エディタのプレビューではなく、メモリの中に生成したファイルから配信する。
 */
test("generated HTML query variants execute authored scripts and initialize page data in order", async ({ page }) => {
  const doc: SiteDoc = {
    schemaVersion: 1, siteName: "Static variant",
    pageOrder: ["default", "selected"],
    pages: {
      default: { id: "default", slug: "", name: "Default", title: "Default",
        description: "", children: ["defaultText"] },
      selected: {
        id: "selected", slug: "", query: "tab=2&tab=ignored", name: "Selected", title: "Selected",
        description: "", children: ["selectedText"],
        customTopHtml: '<script src="https://assets.export.test/first.js"></script>' +
          '<script>window.__authorOrder = window.__externalReady ? "correct" : "early";</script>',
        customEndHtml: '<script>window.__endScriptRan = true;</script>',
        pageScripts: [{
          id: "load", trigger: "load", pos: { x: 0, y: 0 },
          steps: [{ id: "assign", kind: "set-var", into: "status", value: "ready" }],
        }],
      },
    },
    nodes: {
      defaultText: { ...makeBox(), id: "defaultText", text: { content: "Fallback page", heading: 1 } },
      selectedText: { ...makeBox(), id: "selectedText", text: { content: "State: {status}", heading: 1 } },
    },
    assets: {},
  };
  const { files } = generateExportProject(doc, "html");
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(error.message));
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "assets.export.test" && url.pathname === "/first.js") {
      // 利用者が書いたスクリプトが、すぐには読み込まれない場合を試す。
      await new Promise((resolve) => setTimeout(resolve, 75));
      await route.fulfill({ status: 200, contentType: "application/javascript",
        body: "window.__externalReady = true;" });
      return;
    }
    if (url.hostname !== "static.export.test") {
      await route.fulfill({ status: 404, body: "Unexpected domain" });
      return;
    }
    const path = url.pathname.replace(/^\/+/, "") || "index.html";
    const source = files[path];
    await route.fulfill(source === undefined
      ? { status: 404, body: "Not found: " + path }
      : { status: 200, contentType: path.endsWith(".js")
        ? "application/javascript" : path.endsWith(".css") ? "text/css" : "text/html",
        body: source });
  });
  await page.goto("http://static.export.test/?tab=2&tab=ignored", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "State: ready" })).toBeVisible();
  const results = await page.evaluate(async () => ({
    order: (window as any).__authorOrder,
    end: (window as any).__endScriptRan,
    // ページのデータの Promise は、DOM のイベントのスクリプトが動く前に解決される。
    // そのため、読み込み時の set-var は表示中の見出しを更新するが、
    // 元のページのデータの結果をさかのぼって書き換えることはない。
    pageDataInitialized: typeof (await (window as any).__pageDataReady) === "object",
    activePlanCount: document.querySelectorAll("script[data-page-plan]").length,
  }));
  expect(results).toEqual({ order: "correct", end: true, pageDataInitialized: true, activePlanCount: 1 });
  expect(failures).toEqual([]);
});
