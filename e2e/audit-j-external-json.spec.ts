import { expect, test } from "@playwright/test";
import { makeLink, makeText } from "../lib/presets";
import { generateExportProject } from "../lib/export-formats";
import { toSingleHtmlProject } from "../lib/generator/single-html";
import type { SiteDoc } from "../lib/types";

// J-1: The response is untrusted; imported text and links must not become
// active HTML/JavaScript when a generated site loads its page data.
const prefix = "/__audit_j_external_json__/";
const payload = [
  {
    name: '<img src=x onerror="globalThis.auditJExecuted=1">',
    link: 'javascript:globalThis.auditJExecuted=2',
  },
  {
    name: '</script><svg onload="globalThis.auditJExecuted=3">',
    link: 'data:text/html,<script>globalThis.auditJExecuted=4</script>',
  },
  {
    name: 'Safe <&> "quoted" 日本語',
    link: 'https://example.com/path?q=1',
  },
  {
    name: "{constructor} {__proto__} should remain literal text",
    link: '//malicious.example/landing',
  },
];

function fixture(): SiteDoc {
  const text = { ...makeText("{name}"), id: "row-title", attrId: "row-title" };
  const link = {
    ...makeLink("Open {name}"), id: "row-link", attrId: "row-link",
    link: { kind: "url" as const, url: "{link}" },
  };
  const list = {
    ...makeText(""), id: "rows", type: "list" as const,
    text: null, list: { from: "items" }, children: ["row-title", "row-link"],
  };
  return {
    siteName: "AUD-J external JSON boundary",
    pageOrder: ["home"],
    pages: { home: {
      id: "home", name: "Home", title: "Home", slug: "",
      description: "", children: ["rows"],
      pageScripts: [{
        id: "fetch-items", trigger: "load", pos: { x: 0, y: 0 },
        steps: [{ id: "fetch", kind: "fetch", url: prefix + "items.json", as: "items" }],
      }],
    }},
    nodes: { "row-title": text, "row-link": link, rows: list },
    assets: {},
  };
}

for (const format of ["html", "single-html"] as const) {
  test(`AUD-J-013: ${format} treats hostile external JSON as text and prevents active link injection`, async ({ page }) => {
    const doc = fixture();
    const original = generateExportProject(doc, "html");
    const project = format === "single-html" ? await toSingleHtmlProject(original) : original;
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    const requests: string[] = [];
    await page.route("**/__audit_j_external_json__/**", async route => {
      const url = new URL(route.request().url());
      const path = url.pathname.slice(prefix.length);
      requests.push(path);
      if (path === "items.json") {
        return route.fulfill({ contentType: "application/json", body: JSON.stringify(payload) });
      }
      const data = project.files[path];
      if (data === undefined) return route.fulfill({ status: 404, body: "Not Found" });
      const mime = path.endsWith(".html") ? "text/html" :
        path.endsWith(".css") ? "text/css" :
        path.endsWith(".js") ? "text/javascript" : "text/plain";
      return route.fulfill({ contentType: mime, body: data });
    });
    await page.goto(prefix + "index.html?__proto__=inert&constructor=inert");
    const rows = page.locator("[data-client-list] [data-row]");
    await expect(rows).toHaveCount(payload.length);
    for (let i = 0; i < payload.length; i++) {
      await expect(rows.nth(i).locator("#row-title")).toHaveText(payload[i].name);
      await expect(rows.nth(i).locator("#row-link")).toHaveText("Open " + payload[i].name);
      await expect(rows.nth(i).locator("#row-link")).toHaveAttribute("href",
        i === 2 ? "https://example.com/path?q=1" : "#");
    }
    expect(await page.evaluate(() => (window as any).auditJExecuted)).toBeUndefined();
    expect(await page.evaluate(() => ({} as Record<string, unknown>).inert)).toBeUndefined();
    await rows.nth(0).locator("#row-link").click();
    expect(await page.evaluate(() => (window as any).auditJExecuted)).toBeUndefined();
    expect(requests.filter(path => path === "items.json")).toHaveLength(1);
    expect(errors).toEqual([]);
  });
}
