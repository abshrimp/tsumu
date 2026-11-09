import { expect, test } from "@playwright/test";
import { generateExportProject } from "../lib/export-formats";
import { makeBox } from "../lib/presets";
import type { SiteDoc } from "../lib/types";

/**
 * AUD-F-002: Real Chromium must execute authored scripts after selecting the
 * requested HTML variant, and only then install its generated page runtime.
 * The fixture is served from in-memory generated files, not an editor preview.
 */
test("generated HTML query variants execute authored scripts and initialize page data in order", async ({ page }) => {
  const doc: SiteDoc = {
    schemaVersion: 1, siteName: "Static variant",
    pageOrder: ["default", "selected"],
    pages: {
      default: { id: "default", slug: "", name: "Default", title: "Default",
        description: "", children: ["defaultText"] },
      selected: {
        id: "selected", slug: "", query: "tab=2", name: "Selected", title: "Selected",
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
      // Exercise the case where the authored script does not load immediately.
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
  await page.goto("http://static.export.test/?tab=2", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "State: ready" })).toBeVisible();
  const results = await page.evaluate(async () => ({
    order: (window as any).__authorOrder,
    end: (window as any).__endScriptRan,
    // The page-data promise is resolved before DOM event scripts run. A
    // load-triggered set-var therefore updates the visible heading but does
    // not retroactively mutate the original page-data result.
    pageDataInitialized: typeof (await (window as any).__pageDataReady) === "object",
    activePlanCount: document.querySelectorAll("script[data-page-plan]").length,
  }));
  expect(results).toEqual({ order: "correct", end: true, pageDataInitialized: true, activePlanCount: 1 });
  expect(failures).toEqual([]);
});
