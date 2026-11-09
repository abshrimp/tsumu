import { expect, test } from "@playwright/test";
import { prepareExportProject } from "../lib/export-formats";
import { makeBox } from "../lib/presets";
import type { SiteDoc } from "../lib/types";

/** Audit F: exercise the actual complete single-file HTML export in Chromium.
 * The test serves only index.html; external editor assets must not be needed.
 */
test("single HTML executes page-load scripts and renders dynamic variables without external files", async ({ page }) => {
  const doc: SiteDoc = {
    siteName: "Standalone runtime",
    pageOrder: ["home"],
    pages: {
      home: {
        id: "home", slug: "", name: "Home", title: "Standalone", description: "",
        children: ["status"],
        pageScripts: [{
          id: "load", trigger: "load", pos: { x: 0, y: 0 },
          steps: [{ id: "assign", kind: "set-var", into: "status", value: "ready" }],
        }],
      },
    },
    nodes: {
      status: { ...makeBox(), id: "status", text: { heading: 1, content: "Status: {status}" } },
    },
    assets: {},
  };
  const project = await prepareExportProject(doc, {
    framework: "single-html", language: "javascript", style: "css", scope: "project",
  });
  expect(Object.keys(project.files)).toEqual(["index.html"]);
  expect(Object.keys(project.binaries)).toEqual([]);
  expect(Object.keys(project.remoteAssets)).toEqual([]);
  const html = project.files["index.html"];
  expect(html).toContain("Status:");

  const errors: string[] = [];
  const unexpectedRequests: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "single.export.test" && url.pathname === "/") {
      await route.fulfill({ status: 200, contentType: "text/html", body: html });
      return;
    }
    unexpectedRequests.push(route.request().url());
    await route.abort();
  });

  await page.goto("http://single.export.test/", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Status: ready" })).toBeVisible();
  const initialized = await page.evaluate(async () =>
    typeof (await (window as any).__pageDataReady) === "object");
  expect(initialized).toBe(true);
  expect(unexpectedRequests).toEqual([]);
  expect(errors).toEqual([]);
});
