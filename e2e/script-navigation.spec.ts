import { expect, test } from "@playwright/test";
import { scriptsFile } from "../lib/script-runtime";
import type { SiteDoc } from "../lib/types";

// 公開サイトのランタイムは Next.js のページ遷移後も残る。
// 古いページの待機が、新しいページの同じIDを操作しないことを実DOMで確かめる。
test("ページを離れると、前のページで待機中のスクリプトは続かない", async ({ page }) => {
  const steps = [
    { id: "wait", kind: "wait" as const, seconds: 1 },
    { id: "hide", kind: "hide" as const, target: "banner" },
  ];
  const scripts = [{ id: "load", trigger: "load" as const, pos: { x: 0, y: 0 }, steps }];
  const doc: SiteDoc = {
    siteName: "Navigation", pageOrder: ["a", "b"], nodes: {}, assets: {},
    pages: {
      a: { id: "a", name: "A", slug: "", title: "A", description: "", children: [], pageScripts: scripts },
      b: { id: "b", name: "B", slug: "b", title: "B", description: "", children: [] },
    },
  };
  await page.clock.install();
  await page.setContent('<span hidden data-page-body="a"></span><div id="banner">Page A</div>');
  await page.locator("[data-page-body]").evaluate((el, scripts) => el.setAttribute("data-scripts", JSON.stringify(scripts)), scripts);
  await page.addScriptTag({ content: scriptsFile(doc) });
  await page.evaluate(() => {
    document.body.innerHTML = '<span hidden data-page-body="b"></span><div id="banner">Page B</div>';
  });
  await page.clock.runFor(1500);
  await expect(page.locator("#banner")).toBeVisible();
  await expect(page.locator("#banner")).toHaveText("Page B");
});
