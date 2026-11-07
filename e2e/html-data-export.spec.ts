import { expect, test } from "@playwright/test";
import type { SiteDoc } from "../lib/types";
import { makeBox } from "../lib/presets";
import { generateExportProject } from "../lib/export-formats";

/** Exercise the generated HTML, JSON loader and DOM runtime in real Chromium. */
test("standalone HTML fetches JSON, transforms it, and renders live text and list rows", async ({ page }) => {
  const title = { ...makeBox(), id: "counter", attrId: "result-count",
    text: { heading: 1, content: "Found {total} items" } };
  const row = { ...makeBox(), id: "entry", text: { heading: 0, content: "{name}" } };
  const list = { ...makeBox(), id: "list", type: "list" as const,
    list: { from: "rows" }, children: ["entry"] };
  const doc: SiteDoc = {
    siteName: "Public data page",
    pages: {
      home: {
        id: "home", name: "Home", slug: "", title: "Home", description: "",
        children: ["counter", "list"],
        pageScripts: [{
          id: "load", trigger: "load", pos: { x: 0, y: 0 },
          steps: [
            { id: "get-data", kind: "fetch", url: "/__html_probe__/items.json", as: "rows" },
            { id: "count", kind: "count", array: "rows", into: "total" },
          ],
        }],
      },
    },
    pageOrder: ["home"],
    nodes: { counter: title, entry: row, list },
    assets: {},
  };
  const project = generateExportProject(doc, "html");
  const prefix = "/__html_probe__/";
  await page.route("**/__html_probe__/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname.slice(prefix.length);
    if (pathname === "items.json") {
      await route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify([{ name: "Alpha" }, { name: "Beta" }]),
      });
      return;
    }
    const file = project.files[pathname];
    if (file === undefined) {
      await route.fulfill({ status: 404, body: "Not Found" }); return;
    }
    const mime = pathname.endsWith(".html") ? "text/html" :
      pathname.endsWith(".css") ? "text/css" :
      pathname.endsWith(".js") ? "text/javascript" : "text/plain";
    await route.fulfill({ status: 200, contentType: mime, body: file });
  });
  await page.goto("/__html_probe__/index.html");
  await expect(page.locator("#result-count")).toHaveText("Found 2 items");
  await expect(page.locator('[data-client-list] [data-row]')).toHaveCount(2);
  await expect(page.locator('[data-client-list] [data-row]').first()).toContainText("Alpha");
  await expect(page.locator('[data-client-list] [data-row]').last()).toContainText("Beta");
  // HTML pages must not ship bundler source or editor signatures.
  expect(project.files["package.json"]).toBeUndefined();
  expect(project.files["index.html"]).not.toMatch(/tsumu/i);
});
