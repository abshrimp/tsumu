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

test("standalone HTML selects query-variant pages before loading their data", async ({ page }) => {
  const defaultNode = { ...makeBox(), id: "default-heading", text: { content: "Default page", heading: 1 } };
  const specialNode = { ...makeBox(), id: "special-heading", text: { content: "Query-specific page", heading: 1 } };
  const doc: SiteDoc = {
    siteName: "Query variants",
    pages: {
      default: { id: "default", name: "Default", slug: "", title: "Default", description: "",
        children: ["default-heading"] },
      special: { id: "special", name: "Special", slug: "", title: "Special", description: "",
        query: "tab=2", children: ["special-heading"],
        pageScripts: [{
          id: "load", trigger: "load", pos: { x: 0, y: 0 },
          steps: [
            { id: "fetch", kind: "fetch", url: "/__query_probe__/items.json?tab={tab}", as: "items" },
            { id: "count", kind: "count", array: "items", into: "count" },
          ],
        }],
      },
    },
    pageOrder: ["default", "special"],
    nodes: { "default-heading": defaultNode, "special-heading": specialNode },
    assets: {},
  };
  const output = generateExportProject(doc, "html");
  await page.route("**/__query_probe__/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname.replace("/__query_probe__/", "");
    if (pathname === "items.json") {
      await route.fulfill({ contentType: "application/json", body: '[{"id":1},{"id":2}]' });
      return;
    }
    const data = output.files[pathname];
    await route.fulfill({
      status: data ? 200 : 404,
      contentType: pathname.endsWith(".html") ? "text/html" :
        pathname.endsWith(".js") ? "text/javascript" : "text/css",
      body: data ?? "",
    });
  });
  await page.goto("/__query_probe__/index.html?tab=2");
  await expect(page.locator("[data-variant-root]")).toContainText("Query-specific page");
  await expect(page.locator("[data-page-body]")).toHaveAttribute("data-page-body", "special");
  await expect(page).toHaveTitle("Special");

  await page.goto("/__query_probe__/index.html?tab=3");
  await expect(page.locator("[data-variant-root]")).toContainText("Default page");
  await expect(page.locator("[data-page-body]")).toHaveAttribute("data-page-body", "default");
});


test("standalone HTML executes #136 transform and condition blocks in Chromium", async ({ page }) => {
  const doc: SiteDoc = {
    siteName: "Composable HTML data",
    pageOrder: ["home"],
    pages: {
      home: { id: "home", name: "Home", slug: "", title: "Composable", description: "",
        children: ["count", "list"],
        pageScripts: [{
          id: "load", trigger: "load", pos: { x: 0, y: 0 },
          steps: [
            { id: "fetch", kind: "fetch", url: "/__transform_probe__/items.json", as: "items" },
            { id: "length", kind: "transform", source: "items", into: "total",
              transform: { kind: "length" } },
            { id: "condition", kind: "if",
              cond: { subject: "var", left: "{total}", op: "gte", value: "2" },
              then: [{ id: "yes", kind: "set-var", into: "state", value: "ready" }],
              else: [{ id: "no", kind: "set-var", into: "state", value: "missing" }],
            },
          ],
        }] as unknown as NonNullable<SiteDoc["pages"][string]["pageScripts"]>,
      },
    },
    nodes: {
      count: { ...makeBox(), id: "count", attrId: "data-status",
        text: { heading: 1, content: "Found {total} items: {state}" } },
      list: { ...makeBox(), id: "list", type: "list", list: { from: "items" }, children: ["item"] },
      item: { ...makeBox(), id: "item", text: { heading: 0, content: "{name}" } },
    },
    assets: {},
  };
  const output = generateExportProject(doc, "html");
  const prefix = "/__transform_probe__/";
  await page.route("**/__transform_probe__/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname.slice(prefix.length);
    if (pathname === "items.json") {
      await route.fulfill({ contentType: "application/json",
        body: JSON.stringify([{ name: "Alpha" }, { name: "Beta" }]) });
      return;
    }
    const content = output.files[pathname];
    await route.fulfill({ status: content === undefined ? 404 : 200,
      contentType: pathname.endsWith(".html") ? "text/html" :
        pathname.endsWith(".css") ? "text/css" : "text/javascript",
      body: content ?? "Not Found" });
  });
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  await page.goto("/__transform_probe__/index.html");
  await expect(page.locator("#data-status")).toHaveText("Found 2 items: ready");
  await expect(page.locator("[data-client-list] [data-row]")).toHaveCount(2);
  await expect(page.locator("[data-client-list] [data-row]").first()).toContainText("Alpha");
  expect(errors).toEqual([]);
});
