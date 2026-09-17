import { expect, test } from "@playwright/test";
import type { SiteDoc } from "../lib/types";
import { makeBox } from "../lib/presets";
import { generateExportProject } from "../lib/export-formats";

/** 生成した HTML・JSON の読み込み・DOM のランタイムを、実際の Chromium で動かす。 */
test("standalone HTML fetches JSON, transforms it, and renders live text and list rows", async ({ page }) => {
  const title = { ...makeBox(), id: "counter", attrId: "result-count",
    text: { heading: 1, content: "Found {total} items" } };
  const row = { ...makeBox(), id: "entry", text: { heading: 0, content: "{name}" } };
  const list = { ...makeBox(), id: "list", type: "list" as const,
    list: { from: "rows" }, children: ["entry"] };
  const doc: SiteDoc = {
    schemaVersion: 1, siteName: "Public data page",
    pages: {
      home: {
        id: "home", name: "Home", slug: "", title: "Home", description: "",
        children: ["counter", "list"],
        pageScripts: [{
          id: "load", trigger: "load", pos: { x: 0, y: 0 },
          steps: [
            { id: "get-data", kind: "fetch", url: "/__html_probe__/items.json", as: "rows" },
            { id: "count", kind: "transform", source: "rows", into: "total", transform: { kind: "length" } },
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
  // HTML のページに、バンドラーのソースやエディタの署名を含めてはならない。
  expect(project.files["package.json"]).toBeUndefined();
  expect(project.files["index.html"]).not.toMatch(/tsumu/i);
});

test("standalone HTML selects query-variant pages before loading their data", async ({ page }) => {
  const defaultNode = { ...makeBox(), id: "default-heading", text: { content: "Default page", heading: 1 } };
  const specialNode = { ...makeBox(), id: "special-heading", text: { content: "Query-specific page", heading: 1 } };
  const doc: SiteDoc = {
    schemaVersion: 1, siteName: "Query variants",
    pages: {
      default: { id: "default", name: "Default", slug: "", title: "Default", description: "",
        children: ["default-heading"] },
      special: { id: "special", name: "Special", slug: "", title: "Special", description: "",
        query: "tab=2", children: ["special-heading"],
        pageScripts: [{
          id: "load", trigger: "load", pos: { x: 0, y: 0 },
          steps: [
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

  await page.goto("/__query_probe__/index.html?tab=3");
  await expect(page.locator("[data-variant-root]")).toContainText("Default page");
  await expect(page.locator("[data-page-body]")).toHaveAttribute("data-page-body", "default");
});


test("standalone HTML executes transform and condition blocks in Chromium", async ({ page }) => {
  const doc: SiteDoc = {
    schemaVersion: 1, siteName: "Composable HTML data",
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


test("standalone HTML uses form and query operands and clears missing transform output", async ({ page }) => {
  const doc: SiteDoc = {
    schemaVersion: 1, siteName: "Dynamic operands", pageOrder: ["home"],
    pages: { home: {
      id: "home", name: "Home", slug: "", title: "Home", description: "",
      children: ["rate", "shadow", "button", "result"],
      pageScripts: [{
        id: "load", trigger: "load", pos: { x: 0, y: 0 },
        steps: [{ id: "records", kind: "fetch", as: "records",
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
        scripts: [{ id: "calculate", trigger: "click", pos: { x: 0, y: 0 }, steps: [
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
  // 2つの比較は、どちらも同じ、型のある、書き出した変数を参照する。
  const secondCondition = grouped[0].conditions![1] as { left: { inputRef: string } };
  expect(secondCondition.left.inputRef).toMatch(/^[a-zA-Z0-9_]+$/);
  expect(grouped[0].cond).toMatchObject({ left: secondCondition.left });
  await page.getByRole("button", { name: "Calculate" }).click();
  const result = page.locator("#result");
  try {
    await expect(result).toHaveText("Total: 31 / not found / pass / safe / accepted");
  } catch (error) {
    const actual = await result.textContent();
    throw new Error("Grouped if condition failed after a click: " +
      JSON.stringify({ actual, grouped }, null, 2), { cause: error });
  }
  expect(errors).toEqual([]);
});
