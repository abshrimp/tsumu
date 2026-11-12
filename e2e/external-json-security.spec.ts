import { expect, test } from "@playwright/test";
import { makeLink, makeText } from "../lib/presets";
import { generateExportProject } from "../lib/export-formats";
import { toSingleHtmlProject } from "../lib/generator/single-html";
import type { SiteDoc } from "../lib/types";

// 応答は信頼できない。生成したサイトがページのデータを読み込むとき、取り込んだ文字やリンクが
// 動作する HTML や JavaScript になってはならない。
const prefix = "/__external_json_security__/";
const payload = [
  {
    name: '<img src=x onerror="globalThis.externalPayloadExecuted=1">',
    link: 'javascript:globalThis.externalPayloadExecuted=2',
  },
  {
    name: '</script><svg onload="globalThis.externalPayloadExecuted=3">',
    link: 'data:text/html,<script>globalThis.externalPayloadExecuted=4</script>',
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
    schemaVersion: 1, siteName: "External JSON security fixture",
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
  test(`${format} treats hostile external JSON as text and prevents active link injection`, async ({ page }) => {
    const doc = fixture();
    const original = generateExportProject(doc, "html");
    const project = format === "single-html" ? await toSingleHtmlProject(original) : original;
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    const requests: string[] = [];
    await page.route("**/__external_json_security__/**", async route => {
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
      const href = await rows.nth(i).locator("#row-link").getAttribute("href");
      expect(href).toBeTruthy();
      // ランタイムは、対応していないスキームを "#" に置き換える代わりに、パーセントエンコードして、
      // 害の無い同じオリジンの相対パスにすることがある。
      // どちらも安全。不具合になるのは、実行できる URL や、攻撃者への移動になる URL だけ。
      if (i === 2) {
        expect(href).toBe("https://example.com/path?q=1");
      } else {
        expect(href).not.toMatch(/^(?:javascript|vbscript|data):/i);
        expect(new URL(href!, page.url()).origin).toBe(new URL(page.url()).origin);
      }
      await expect(rows.nth(i).locator("#row-title img, #row-title svg")).toHaveCount(0);
    }
    expect(await page.evaluate(() => (window as any).externalPayloadExecuted)).toBeUndefined();
    expect(await page.evaluate(() => ({} as Record<string, unknown>).inert)).toBeUndefined();
    await rows.nth(0).locator("#row-link").click();
    expect(await page.evaluate(() => (window as any).externalPayloadExecuted)).toBeUndefined();
    expect(requests.filter(path => path === "items.json")).toHaveLength(1);
    expect(errors).toEqual([]);
  });
}
