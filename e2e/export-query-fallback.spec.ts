import { expect, test } from "@playwright/test";
import { generateExportProject } from "../lib/export-formats";
import { makeText } from "../lib/presets";
import type { SiteDoc } from "../lib/types";

test("a shared static route shows its default document without JavaScript and runs only the selected variant with JavaScript @export-browser", async ({ browser }) => {
  const base = { slug: "catalog", title: "Catalog", description: "" };
  const doc: SiteDoc = {
    schemaVersion: 1, siteName: "Catalog", assets: {}, pageOrder: ["sale", "regular"],
    pages: {
      sale: { ...base, id: "sale", name: "Sale", query: "view=sale", children: ["offers"] },
      regular: { ...base, id: "regular", name: "Catalog", children: ["label"],
        customEndHtml: [
          '<noscript><p id="offline">Offline catalog</p></noscript>',
          '<style>#offline::after { content: "</noscript>" }</style>',
          '<textarea aria-label="Notes">\n\nSecond line</textarea>',
          '<script>window.catalogLoads = (window.catalogLoads || 0) + 1;</script>',
        ].join("") },
    },
    nodes: {
      label: { ...makeText("All products"), id: "label" },
      offers: { ...makeText("Sale prices"), id: "offers" },
    },
  };
  const { files } = generateExportProject(doc, "html");
  for (const javaScriptEnabled of [false, true]) {
    const context = await browser.newContext({ javaScriptEnabled });
    try {
      await context.route("https://shop.test/**", route => {
        const path = new URL(route.request().url()).pathname.slice(1).replace(/\/$/, "/index.html");
        const body = files[path];
        const contentType = path.endsWith(".js") ? "text/javascript" : path.endsWith(".css") ? "text/css" : "text/html";
        return route.fulfill({ status: body === undefined ? 404 : 200, contentType, body: body ?? "" });
      });
      const page = await context.newPage();
      for (const view of ["", "?view=sale"]) {
        await page.goto("https://shop.test/catalog/" + view);
        const sale = javaScriptEnabled && !!view;
        await expect(page.getByText(sale ? "Sale prices" : "All products", { exact: true })).toBeVisible();
        await expect(page.getByText(sale ? "All products" : "Sale prices", { exact: true })).toHaveCount(0);
        if (!javaScriptEnabled) {
          await expect(page.getByText("Offline catalog", { exact: true })).toBeVisible();
          await expect(page.getByLabel("Notes")).toHaveValue("\nSecond line");
          expect(await page.locator("#offline").evaluate(el => getComputedStyle(el, "::after").content)).toBe('"</noscript>"');
        }
        else expect(await page.evaluate(() => Reflect.get(window, "catalogLoads") ?? 0)).toBe(sale ? 0 : 1);
      }
    } finally { await context.close(); }
  }
});
