import { expect, test } from "@playwright/test";
import { generateExportProject, prepareExportProject } from "../lib/export-formats";
import { toSingleHtmlProject } from "../lib/generator/single-html";
import { makeBox, makeLink, makeText } from "../lib/presets";
import type { SiteDoc } from "../lib/types";

test("standalone HTML selects query-variant pages before loading their data", async ({ page }) => {
  const defaultNode = { ...makeBox(), id: "default-heading", text: { content: "Default page", heading: 1 } };
  const specialNode = { ...makeBox(), id: "special-heading", text: { content: "Query-specific page", heading: 1 } };
  const doc: SiteDoc = {
    schemaVersion: 1, siteName: "Query variants",
    pages: {
      default: { id: "default", name: "Default", slug: "", title: "Default", description: "",
        children: ["default-heading"] },
      special: { id: "special", name: "Special", slug: "", title: "Special", description: "Details for this view", noindex: true,
        query: "tab=2", children: ["special-heading"],
        pageScripts: [{
          id: "load", trigger: "load", steps: [
            { id: "fetch", kind: "fetch", url: "/__query_probe__/items.json?tab={tab}", as: "items" },
            { id: "count", kind: "transform", source: "items", into: "count", transform: { kind: "length" } },
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
  await expect(page.locator('head meta[name="description"]')).toHaveAttribute("content", "Details for this view");
  await expect(page.locator('head meta[name="robots"]')).toHaveAttribute("content", /noindex/);

  await page.goto("/__query_probe__/index.html?tab=3");
  await expect(page.locator("[data-variant-root]")).toContainText("Default page");
  await expect(page.locator("[data-page-body]")).toHaveAttribute("data-page-body", "default");
  await expect(page.locator('head meta[name="robots"]')).toHaveCount(0);
});

/** 生成した HTML・JSON の読み込み・DOM のランタイムを、実際の Chromium で動かす。 */
test("standalone HTML fetches JSON, executes transform and condition blocks, and renders live text and list rows", async ({ page }) => {
  const doc: SiteDoc = {
    schemaVersion: 1, siteName: "Composable HTML data",
    pageOrder: ["home"],
    pages: {
      home: { id: "home", name: "Home", slug: "", title: "Composable", description: "",
        children: ["count", "list"],
        pageScripts: [{
          id: "load", trigger: "load", steps: [
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
  await expect(page.locator("[data-client-list] [data-row]").last()).toContainText("Beta");
  // HTML のページに、バンドラーのソースやエディタの署名を含めてはならない。
  expect(output.files["package.json"]).toBeUndefined();
  expect(output.files["index.html"]).not.toMatch(/tsumu/i);
  expect(errors).toEqual([]);
});

test("standalone HTML uses form and query operands and clears missing transform output", async ({ page }) => {
  const doc: SiteDoc = {
    schemaVersion: 1, siteName: "Dynamic operands", pageOrder: ["home"],
    pages: { home: {
      id: "home", name: "Home", slug: "", title: "Home", description: "",
      children: ["rate", "shadow", "button", "result"],
      pageScripts: [{
        id: "load", trigger: "load", steps: [{ id: "records", kind: "fetch", as: "records",
          url: "/__operand_probe__/records.json" }],
      }],
    }},
    nodes: {
      rate: { ...makeBox(), id: "rate", type: "field", attrId: "rate",
        field: { kind: "input", inputType: "number", defaultValue: "7", placeholder: "Rate" } },
      shadow: { ...makeBox(), id: "shadow", type: "field", attrId: "chosen",
        field: { kind: "input", inputType: "text", defaultValue: "field-shadow", placeholder: "Shadow" } },
      button: { ...makeBox(), id: "button", semantic: "button",
        text: { content: "Calculate", heading: 0 },
        scripts: [{ id: "calculate", trigger: "click", steps: [
          { id: "base", kind: "set-var", into: "base", value: "4" },
          { id: "mul", kind: "transform", source: "base", into: "scaled",
            transform: { kind: "math", operation: "multiply",
              operand: "rate", operandType: "variable" } },
          { id: "add", kind: "transform", source: "scaled", into: "total",
            transform: { kind: "math", operation: "add",
              operand: "extra", operandType: "variable" } },
          { id: "old", kind: "set-var", into: "chosen", value: "stale" },
          { id: "missing", kind: "transform", source: "records.0", into: "chosen",
            transform: { kind: "field", key: "absent" } },
          { id: "fallback", kind: "transform", source: "chosen", into: "chosen",
            transform: { kind: "fallback", when: "missing", text: "not found" } },
          { id: "conditional", kind: "if",
            cond: { subject: "var", left: "{total}", op: "gte", value: "31" },
            conditions: [{ subject: "var", left: "", op: "eq", value: "", not: true, and: true }],
            then: [{ id: "pass", kind: "set-var", into: "check", value: "pass" }],
            else: [{ id: "fail", kind: "set-var", into: "check", value: "fail" }] },
          { id: "missing-target-if", kind: "if",
            cond: { subject: "visible", target: "no-such-element", not: true },
            then: [{ id: "incorrect", kind: "set-var", into: "visibility", value: "incorrect" }],
            else: [{ id: "correct", kind: "set-var", into: "visibility", value: "safe" }] },
          { id: "or-with-empty", kind: "if",
            cond: { subject: "var", left: "{total}", op: "gte", value: "100" },
            conditions: [
              { subject: "var", left: "", op: "eq", value: "", and: false },
              { subject: "var", left: "{total}", op: "eq", value: "31", and: true },
            ],
            then: [{ id: "or-ok", kind: "set-var", into: "joined", value: "accepted" }],
            else: [{ id: "or-no", kind: "set-var", into: "joined", value: "rejected" }] },
        ] }] as unknown as NonNullable<SiteDoc["nodes"][string]["scripts"]>,
      },
      result: { ...makeBox(), id: "result", attrId: "result",
        text: { content: "Total: {total} / {chosen} / {check} / {visibility} / {joined}", heading: 0 } },
    },
    assets: {},
  };
  const files = generateExportProject(doc, "html").files;
  await page.route("**/__operand_probe__/**", async (route) => {
    const path = new URL(route.request().url()).pathname.slice("/__operand_probe__/".length);
    if (path === "records.json") {
      await route.fulfill({ contentType: "application/json", body: '[{"name":"first"}]' });
      return;
    }
    const text = files[path];
    await route.fulfill({ status: text === undefined ? 404 : 200,
      contentType: path.endsWith(".html") ? "text/html" :
        path.endsWith(".css") ? "text/css" : "text/javascript", body: text ?? "Not Found" });
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/__operand_probe__/index.html?extra=3&chosen=query-shadow");
  await page.locator("#rate").fill("7");
  const compiled = await page.getByRole("button", { name: "Calculate" }).getAttribute("data-scripts");
  const steps = (JSON.parse(compiled || "[]") as { steps: { kind: string; cond?: unknown; conditions?: unknown[] }[] }[])
    .flatMap((script) => script.steps);
  const grouped = steps.filter((step) => step.kind === "if" && step.conditions?.length === 2);
  expect(grouped).toHaveLength(1);
  expect(grouped[0].conditions).toMatchObject([
    { subject: "var", left: "", and: false },
    { subject: "var", op: "eq", value: "31", and: true },
  ]);
  const secondCondition = grouped[0].conditions![1] as { left: { inputRef: string } };
  expect(secondCondition.left.inputRef).toMatch(/^[a-zA-Z0-9_]+$/);
  expect(grouped[0].cond).toMatchObject({ left: secondCondition.left });
  await page.getByRole("button", { name: "Calculate" }).click();
  await expect(page.locator("#result")).toHaveText("Total: 31 / not found / pass / safe / accepted");
  expect(errors).toEqual([]);
});

/** 監査 F: 実際の単一ファイルの HTML の書き出し全体を、Chromium で動かす。 */
test("single HTML executes page-load scripts and renders dynamic variables without external files", async ({ page }) => {
  const doc: SiteDoc = {
    schemaVersion: 1, siteName: "Standalone runtime",
    pageOrder: ["home"],
    pages: {
      home: {
        id: "home", slug: "", name: "Home", title: "Standalone", description: "",
        children: ["status"],
        pageScripts: [{
          id: "load", trigger: "load", steps: [{ id: "assign", kind: "set-var", into: "status", value: "ready" }],
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
          id: "load", trigger: "load", steps: [{ id: "assign", kind: "set-var", into: "status", value: "ready" }],
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
      await new Promise((resolve) => setTimeout(resolve, 40));
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
    pageDataInitialized: typeof (await (window as any).__pageDataReady) === "object",
    activePlanCount: document.querySelectorAll("script[data-page-plan]").length,
  }));
  expect(results).toEqual({ order: "correct", end: true, pageDataInitialized: true, activePlanCount: 1 });
  expect(failures).toEqual([]);
});

// 応答は信頼できない。生成したサイトがページのデータを読み込むとき、取り込んだ文字やリンクが
// 動作する HTML や JavaScript になってはならない。
const securityPrefix = "/__external_json_security__/";
const hostilePayload = [
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

function securityFixture(): SiteDoc {
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
        id: "fetch-items", trigger: "load", steps: [{ id: "fetch", kind: "fetch", url: securityPrefix + "items.json", as: "items" }],
      }],
    }},
    nodes: { "row-title": text, "row-link": link, rows: list },
    assets: {},
  };
}

for (const format of ["html", "single-html"] as const) {
  test(`${format} treats hostile external JSON as text and prevents active link injection`, async ({ page }) => {
    const doc = securityFixture();
    const original = generateExportProject(doc, "html");
    const project = format === "single-html" ? await toSingleHtmlProject(original) : original;
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    const requests: string[] = [];
    await page.route("**/__external_json_security__/**", async route => {
      const url = new URL(route.request().url());
      const path = url.pathname.slice(securityPrefix.length);
      requests.push(path);
      if (path === "items.json") {
        return route.fulfill({ contentType: "application/json", body: JSON.stringify(hostilePayload) });
      }
      const data = project.files[path];
      if (data === undefined) return route.fulfill({ status: 404, body: "Not Found" });
      const mime = path.endsWith(".html") ? "text/html" :
        path.endsWith(".css") ? "text/css" :
        path.endsWith(".js") ? "text/javascript" : "text/plain";
      return route.fulfill({ contentType: mime, body: data });
    });
    await page.goto(securityPrefix + "index.html?__proto__=inert&constructor=inert");
    const rows = page.locator("[data-client-list] [data-row]");
    await expect(rows).toHaveCount(hostilePayload.length);
    for (let i = 0; i < hostilePayload.length; i++) {
      await expect(rows.nth(i).locator("#row-title")).toHaveText(hostilePayload[i].name);
      await expect(rows.nth(i).locator("#row-link")).toHaveText("Open " + hostilePayload[i].name);
      const href = await rows.nth(i).locator("#row-link").getAttribute("href");
      expect(href).toBeTruthy();
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
