import { expect, test } from "@playwright/test";
import { applyPagePayload, buildPagePayload } from "../lib/page-transfer";
import { scriptsFile } from "../lib/script-runtime";
import { queryCopyFixture, renderQueryCopyExport } from "../tests/helpers/page-copy-query";

test("copied links and script buttons navigate to the matching query variant", async ({ page }) => {
  const { source, target } = queryCopyFixture();
  applyPagePayload(target, buildPagePayload(source, ["home"]));
  const { html } = renderQueryCopyExport(target);
  // 移動はすべてローカルで応答し、外部のサイトには接続しない。
  await page.route("**/*", (route) => route.fulfill({
    contentType: "text/html",
    body: new URL(route.request().url()).search === "?tab=news" ? "<main>News</main>" : "<main>Other</main>",
  }));
  for (const selector of ["#news-link", "#news-button"]) {
    await page.goto("https://page-copy.test/");
    await page.setContent(html);
    await page.addScriptTag({ content: scriptsFile(target) });
    await page.locator(selector).click();
    await expect(page).toHaveURL("https://page-copy.test/blog?tab=news");
    await expect(page.locator("main")).toHaveText("News");
  }
});
