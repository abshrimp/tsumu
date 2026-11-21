import { describe, before, test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import vm, { runInNewContext } from "node:vm";
import { generateExportProject, exportLimitations, prepareExportProject } from "../lib/export-formats";
import { listRuntimeDom } from "./helpers/list-runtime-dom";
import { makeBox, makeText, createInitialDoc, makeImage, makeMedia } from "../lib/presets";
import { type ScriptStep, type SiteDoc, type Asset, type NodeStyles } from "../lib/types";
import { filterPredicate } from "../lib/generator/render-helpers";
import { matchesValueCondition, parseValueLiteral } from "../lib/value-semantics";
import { interpolate, lookupVar } from "../lib/vars";
import { PAGE_DATA_RUNTIME } from "../lib/generator/browser-data";
import { nativeDataModule } from "../lib/generator/native-data";
import { fetchRequestOf, type FetchOptions } from "../lib/fetch-request";
import { applyList, toListItems, type ListOp, filterItems, pageDataSteps } from "../lib/data";
import { resolvedListOps } from "../components/canvas/render";
import { runChecks } from "../lib/generator/checks";
import { generateProject } from "../lib/generator";
import { createRequire } from "node:module";
import { transformSync } from "./helpers/bundle";
import { parseFragment, type DefaultTreeAdapterTypes as Html, parse } from "parse5";
import { renderToStaticMarkup } from "react-dom/server";
import { headHtmlToJsx } from "../lib/generator/head";
import { deferRunnableScripts } from "../lib/generator/defer-scripts";
import { ZipArchive } from "../lib/zip";
import { exportProjectZip } from "../lib/exportZip";
import { parseSiteImport, restoreImportAssets, EDITABLE_DOC_PATH, EDITABLE_ASSETS_PATH } from "../lib/site-import";
import { attachZipDependencies, zipCssUrl } from "../lib/zip-css";
import { assetSrc, fetchWithRetry } from "../lib/assets";
import { readResponseBytes } from "../lib/response-bytes";
import { buildAssetNames } from "../lib/generator/names";
import { generateSiteCss, rewriteHtmlAssetUrls } from "../lib/generator/css";
import { buildCanvasCss } from "../components/canvas/css";
import { splitCssModule } from "../lib/generator/style-export";
import { toSingleHtmlProject } from "../lib/generator/single-html";
import { reactSource } from "../lib/generator/react-export";
import { readRestoreJson } from "../lib/publish-security";
import { retainImportedDependencies } from "../lib/generator/imported-dependencies";
import { toJavaScriptProject } from "../lib/generator/javascript-export";
import { cssAssetReferences } from "../lib/css-assets";
import { applyPagePayload, buildPagePayload } from "../lib/page-transfer";
import { singleHtmlResources, EXPORT_BASE } from "../lib/generator/single-html-resources";
import { createHash } from "node:crypto";

describe("browser-data-export", () => {
describe("browser-data-export", () => {
  function fixture(steps: ScriptStep[]): SiteDoc {
    const title = { ...makeBox(), id: "title", attrId: "summary", text: { content: "{total} records", heading: 1 } };
    const list = { ...makeBox(), id: "list", type: "list" as const, list: { from: "rows" }, children: ["entry"] };
    const entry = { ...makeBox(), id: "entry", text: { content: "{name}", heading: 0 } };
    return {
      siteName: "Data demonstration",
      pages: {
        main: {
          id: "main", name: "Home", slug: "", title: "Home", description: "", children: ["title", "list"],
          pageScripts: [{ id: "load", trigger: "load", steps }],
        },
      },
      pageOrder: ["main"],
      nodes: { title, list, entry },
      assets: {},
    };
  }

  async function runBrowserData(
    project: ReturnType<typeof generateExportProject>,
    search: string,
    implementation: (url: string, options: any) => Promise<any>,
  ) {
    const html = project.files["index.html"];
    const raw = /<script type="application\/json" data-page-plan>([\s\S]*?)<\/script>/.exec(html)?.[1];
    assert.ok(raw, "a JSON plan is embedded in the HTML");
    const window: { __pageDataReady?: Promise<any> } = {};
    const warnings: string[] = [];
    vm.runInNewContext(project.files["data-loader.js"], {
      window, location: { search }, URLSearchParams, TextDecoder, TextEncoder,
      document: { querySelector: () => ({ textContent: raw }) },
      fetch: implementation,
      console: { warn: (...args: unknown[]) => warnings.push(args.map(String).join(" ")) },
    }, { timeout: 1000 });
    assert.ok(window.__pageDataReady);
    const values = await window.__pageDataReady;
    return { values: JSON.parse(JSON.stringify(values)), warnings, steps: JSON.parse(raw).steps as ScriptStep[] };
  }

  test("native HTML fetches JSON and composes list loops, length, and join", async () => {
    const doc = fixture([
      { id: "request", kind: "fetch", url: "https://data.example.test/items?group={group}", as: "rows",
        preview: { sample: [{ id: 999, name: "editor-only" }] } },
      { id: "requested-id", kind: "set-var", value: "{id}", into: "requestedId" },
      { id: "selected-init", kind: "set-var", value: "null", into: "selected" },
      { id: "find", kind: "for-each", array: "rows", then: [
        { id: "match", kind: "if", cond: { subject: "var", target: "",
          left: "{ループ.値.id}", op: "eq", value: "{requestedId}" }, then: [
          { id: "choose", kind: "set-var", into: "selected", value: "{ループ.値}" },
          { id: "break", kind: "break-loop" },
        ] },
      ] },
      { id: "count", kind: "transform", source: "rows", into: "total",
        transform: { kind: "length" } },
      { id: "labels-init", kind: "set-var", value: "[]", into: "labels" },
      { id: "field", kind: "for-each", array: "rows", then: [
        { id: "add-name", kind: "set-list-item", list: "labels",
          key: "", value: "{ループ.値.name}" },
      ] },
      { id: "join", kind: "transform", source: "labels", into: "names",
        transform: { kind: "join", separator: " / " } },
    ]);
    const project = generateExportProject(doc, "html");
    assert.ok(project.files["scripts.js"].includes("__pageDataReady"));
    assert.match(project.files["index.html"], /data-client-list/);
    assert.doesNotMatch(project.files["index.html"], /editor-only/);
    const calls: string[] = [];
    const { values, warnings, steps } = await runBrowserData(project, "?group=news&id=2", async (url) => {
      calls.push(url);
      return Response.json([{ id: 1, name: "A" }, { id: 2, name: "B" }]);
    });
    assert.deepEqual(calls, ["https://data.example.test/items?group=news"]);
    const target = (id: string): string => {
      const step = steps.find((item) => item.id === id);
      if (!step) throw new Error("Missing step " + id);
      return ("into" in step ? step.into : "as" in step ? step.as : undefined) || "";
    };
    assert.equal(values[target("count")], 2);
    assert.equal(values[target("join")], "A / B");
    assert.equal(values[target("selected-init")].id, 2);
    const rows = steps.find((item) => item.id === "request");
    assert.ok(rows && rows.kind === "fetch");
    assert.equal(values[rows.as!][1].name, "B");
    assert.deepEqual(warnings, []);
  });

  test("published HTML keeps dictionary list filters and sorting when a script updates a row", async () => {
    const doc = fixture([
      { id: "fetch", kind: "fetch", url: "/items.json", as: "rows" },
      { id: "filter", kind: "list-display", mode: "filter", array: "rows", field: "rank", op: "gte", value: "2", dir: "asc" },
      { id: "sort", kind: "list-display", mode: "sort", array: "rows", field: "rank", dir: "desc", op: "eq", value: "" },
    ]);
    doc.nodes.list.list!.limit = 2;
    for (const [id, rank] of [["refresh", 8], ["change", 0]] as const) {
      doc.nodes[id] = { ...makeText(id), id, attrId: id, semantic: "button", scripts: [
        { id: id + "-click", trigger: "click", steps: [
          { id: id + "-set", kind: "set-list-item", list: "rows", key: "8", value: JSON.stringify({ rank }) },
        ] },
      ] };
      doc.pages.main.children.push(id);
    }
    const { files } = generateExportProject(doc, "html");
    const html = files["index.html"];
    const plan = /<script type="application\/json" data-page-plan>([\s\S]*?)<\/script>/.exec(html)![1];
    const window: Record<string, any> = {};
    const source = { "1": { rank: 1 }, "3": { rank: 3 }, "5": { rank: 5 }, "8": { rank: 8 } };
    vm.runInNewContext(files["data-loader.js"], {
      window, location: { search: "" }, URLSearchParams, TextDecoder, TextEncoder,
      document: { querySelector: () => ({ textContent: plan }) },
      fetch: async () => Response.json(source),
    });
    const dom = listRuntimeDom(html, files["scripts.js"], { window });
    await dom.dispose;
    const ranks = () => dom.active("[data-item]").map(row => JSON.parse(row.getAttribute("data-item")!).rank);
    assert.deepEqual(ranks(), [8, 5]);
    await dom.click("refresh");
    assert.deepEqual(ranks(), [8, 5]);
    await dom.click("change");
    assert.deepEqual(ranks(), [5, 3]);
  });

  test("native HTML decodes streamed multibyte JSON across chunk boundaries", async () => {
    const project = generateExportProject(fixture([
      { id: "fetch", kind: "fetch", url: "https://data.example.test/utf8", as: "rows" },
    ]), "html");
    const encoded = new TextEncoder().encode('[{"name":"東京"}]');
    const split = encoded.indexOf(0xe6) + 1;
    assert.ok(split > 0);
    const { values, steps, warnings } = await runBrowserData(project, "", async () =>
      new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoded.subarray(0, split));
          controller.enqueue(encoded.subarray(split));
          controller.close();
        },
      })));
    const step = steps.find((item) => item.kind === "fetch");
    assert.ok(step && step.kind === "fetch");
    assert.equal(values[step.as!][0].name, "東京");
    assert.deepEqual(warnings, []);
  });

  test("native HTML cancels a large streamed API response before buffering it", async () => {
    const project = generateExportProject(fixture([
      { id: "fetch", kind: "fetch", url: "https://data.example.test/unbounded", as: "rows" },
    ]), "html");
    let pulls = 0, cancellations = 0;
    const { values, warnings, steps } = await runBrowserData(project, "", async () =>
      new Response(new ReadableStream<Uint8Array>({
        pull(controller) {
          pulls++;
          controller.enqueue(new Uint8Array(1024 * 1024));
        },
        cancel() { cancellations++; },
      })));
    const step = steps.find((item) => item.kind === "fetch");
    assert.ok(step && step.kind === "fetch");
    assert.equal(values[step.as!], null);
    assert.ok(warnings.some((warning) => warning.includes("Response exceeds 5 MB")));
    assert.equal(cancellations, 1);
    assert.ok(pulls <= 8);
  });

  test("native HTML sends an interpolated JSON POST when the public API permits it", async () => {
    const doc = fixture([{
      id: "request", kind: "fetch", url: "https://data.example.test/search", as: "data",
      method: "POST", headers: [{ name: "X-Locale", value: "{lang}" }],
      body: '{"text":"{query}","limit":{limit}}',
    }]);
    const project = generateExportProject(doc, "html");
    let request: any;
    const { values, steps } = await runBrowserData(project, "?query=hello%20world&limit=3&lang=ja", async (url, options) => {
      request = { url, options };
      return new Response('{"answer":true}', { headers: { "content-length": "15" } });
    });
    assert.equal(request.url, "https://data.example.test/search");
    assert.equal(request.options.method, "POST");
    assert.equal(request.options.headers["X-Locale"], "ja");
    assert.equal(request.options.headers["Content-Type"], "application/json");
    // クエリのパラメーターは文字列。差し込みでは、その値の型を保つ。
    assert.deepEqual(JSON.parse(request.options.body), { text: "hello world", limit: "3" });
    const fetchStep = steps.find((step) => step.kind === "fetch");
    assert.ok(fetchStep && fetchStep.kind === "fetch");
    assert.equal(values[fetchStep.as!].answer, true);
  });

  test("native HTML fails safely when CORS or the network blocks a request", async () => {
    const project = generateExportProject(fixture([{
      id: "fetch", kind: "fetch", url: "https://data.example.test/private", as: "privateData",
    }]), "html");
    const { values, warnings, steps } = await runBrowserData(project, "", async () => {
      throw new TypeError("CORS blocked");
    });
    const fetchStep = steps.find((step) => step.kind === "fetch");
    assert.ok(fetchStep && fetchStep.kind === "fetch");
    assert.equal(values[fetchStep.as!], null);
    assert.equal(warnings.length, 1);
  });

  test("native HTML does not expose authorization credentials or token-bearing URLs", () => {
    const doc = fixture([{
      id: "fetch", kind: "fetch", url: "https://data.example.test/private", as: "privateData",
      headers: [{ name: "Authorization", value: "Bearer should-not-be-exported" }],
    }]);
    const problems = exportLimitations(doc, "html");
    assert.ok(problems.some((problem) => /credentials|secret API key/i.test(problem)));
    assert.throws(() => generateExportProject(doc, "html"), /credentials|secret API key/i);
    doc.pages.main.pageScripts![0].steps[0] = {
      id: "fetch", kind: "fetch", url: "https://data.example.test/items?api_key=secret", as: "data",
    };
    assert.ok(exportLimitations(doc, "html").length > 0);
  });

  test("generated code has no framework-editor brand markers (documentation excepted)", () => {
    const doc = fixture([]);
    for (const format of ["nextjs", "react", "html"] as const) {
      const p = generateExportProject(doc, format);
      for (const [path, source] of Object.entries(p.files)) {
        if (/\.(md|txt)$/i.test(path)) continue;
        assert.doesNotMatch(source, /tsumu/i, format + ": " + path);
      }
    }
    const css = generateExportProject(doc, {
      framework: "react", language: "typescript", style: "css-modules", scope: "project",
    });
    for (const [path, source] of Object.entries(css.files)) {
      if (/\.(md|txt)$/i.test(path)) continue;
      assert.doesNotMatch(source, /tsumu/i, path);
    }
  });

  test("native HTML runs top-level list removal before the next page-load operation", async () => {
    const doc = fixture([
      { id: "seed", kind: "set-var", into: "rows", value: '["A","B","A"]' },
      { id: "remove", kind: "remove-list-item", list: "rows", mode: "value", value: "A" },
      { id: "use", kind: "fetch", url: "https://example.com/{rows.0}", as: "result" },
    ]);
    const calls: string[] = [];
    const { warnings } = await runBrowserData(generateExportProject(doc, "html"), "", async (url) => {
      calls.push(url);
      return Response.json({});
    });
    assert.deepEqual(calls, ["https://example.com/B"]);
    assert.deepEqual(warnings, []);
  });
});

describe("generated-filter-parity", () => {
  function actual(left: unknown, op: string, value: string) {
    const source = filterPredicate([{kind:"filter", conds:[{field:"value",op,value}]}] as any, "vars");
    return new Function("item", "vars", "interpolate", "lookupVar", `return ${source}`)({value:left}, {}, interpolate, lookupVar);
  }
  for (const [label,left,op,value] of [
    ["number text equality", "2", "eq", "2"],
    ["boolean text equality", "true", "eq", "true"],
    ["nested scalar equality", {a:"2"}, "eq", '{"a":2}'],
    ["array contains scalar text", ["2"], "contains", "2"],
    ["boolean comma membership", true, "in", "false,true"],
    ["numeric spelling preserved", 1, "in", "1.0,2"],
    ["overflow equality rejected", Infinity, "eq", "1e999"],
  ] as const) test(`generated filter matches preview: ${label}`, () => {
    assert.equal(actual(left,op,value), matchesValueCondition(left,op,parseValueLiteral(value)));
  });
  test("generated nested equality respects the same depth budget", () => {
    let left: any = {v:1}; for (let i=0;i<17;i++) left={next:left};
    assert.equal(actual(left,"eq",JSON.stringify(left)), matchesValueCondition(left,"eq",JSON.parse(JSON.stringify(left))));
  });
  test("ordinary filter operator matrix keeps preview parity", () => {
    for (const left of [null,undefined,false,true,0,1,2,"2","02","true","abc","null","annulling",[],[1,"2"],{}, {a:2}])
      for (const op of ["eq","contains","in","empty","has-key","starts-with","ends-with","gt","gte","lt","lte"])
        for (const value of ["null","false","true","0","2","02","abc","a","[]","[1,2]",'{"a":2}'])
          assert.equal(actual(left,op,value), matchesValueCondition(left,op,parseValueLiteral(value)), JSON.stringify({left,op,value}));
  });
});

describe("generated-fetch-request-parity", () => {
  async function generated(options: FetchOptions, native: boolean, vars: Record<string, string> = {}) {
    let request: any;
    const step = { id: "fetch", kind: "fetch", as: "data", url: "https://example.test/data", ...options };
    const context: any = {
      window: {}, location: { search: new URLSearchParams(vars).toString() }, URLSearchParams, TextDecoder, TextEncoder,
      document: { querySelector: () => ({ textContent: JSON.stringify({ steps: [step] }) }) },
      console: { warn() {} },
      fetch: async (_url: string, init: unknown) => { request = JSON.parse(JSON.stringify(init)); return Response.json({}); },
    };
    if (native) {
      runInNewContext(nativeDataModule().replace(/\bexport /g, "") + "\nglobalThis.run = loadPageData;", context);
      await context.run({ steps: [step] }, context.location.search, context.fetch);
    } else {
      runInNewContext(PAGE_DATA_RUNTIME, context);
      await context.window.__pageDataReady;
    }
    assert.ok(request, "request must reach fetch");
    return request;
  }
  const normalized = (value: any) => ({ method: value?.method ?? "GET", headers: value?.headers ?? {}, ...(value?.body !== undefined ? { body: value.body } : {}) });
  for (const native of [false, true]) {
    const variant = native ? "native SSR/module" : "browser loader";
    for (const method of ["GET", "DELETE", "POST", "PUT", "PATCH"] as const) test(`${variant}: ${method} payload matches editor request`, async () => {
      const options = { method, body: '{"value":"{name}"}' }, vars = { name: "value" };
      assert.deepEqual(await generated(options, native, vars), normalized(fetchRequestOf(options, vars)));
    });
    for (const name of ["Content-Type", "content-type", " CONTENT-TYPE "]) test(`${variant}: preserves explicit ${name}`, async () => {
      const options: FetchOptions = { method: "POST", body: '{"value":1}', headers: [{ name, value: "application/vnd.example+json" }] };
      assert.deepEqual(await generated(options, native), normalized(fetchRequestOf(options, {})));
    });
    test(`${variant}: escaped literal braces remain valid JSON`, async () => {
      for (let count = 0; count <= 8; count++) {
        const options: FetchOptions = { method: "POST", body: JSON.stringify({ literal: "\\".repeat(count) + "{name}", dynamic: "{name}" }) };
        const actual = await generated(options, native, { name: "a\"b" });
        assert.deepEqual(actual, normalized(fetchRequestOf(options, { name: "a\"b" })));
        assert.doesNotThrow(() => JSON.parse(actual.body));
      }
    });
  }
});

describe("generated-list-order-parity", () => {
  async function load(data: unknown, operations: ListOp[], native: boolean) {
    const plan = { steps: [{ kind: "fetch", url: "https://example.com/", as: "rows" }], listOps: { rows: operations } };
    const context: any = { URLSearchParams, TextDecoder, TextEncoder, window: {}, location: { search: "" },
      document: { querySelector: () => ({ textContent: JSON.stringify(plan) }) },
      fetch: async () => Response.json(data),
    };
    let vars, rows;
    if (native) {
      runInNewContext(nativeDataModule().replace(/\bexport /g, "") + "\nglobalThis.run = loadPageData; globalThis.rows = listItemsWithOps;", context);
      vars = await context.run(plan, "", context.fetch);
      rows = context.rows(plan.listOps, vars, "rows", 0);
    } else {
      runInNewContext(PAGE_DATA_RUNTIME, context);
      vars = await context.window.__pageDataReady;
      rows = context.window.__pageListRows(vars.rows, "rows", vars);
    }
    assert.deepEqual(JSON.parse(JSON.stringify(vars.rows)), data, "display operations preserve source keys, values and order");
    return JSON.parse(JSON.stringify(rows));
  }
  for (const native of [false, true]) {
    test(`${native ? "native" : "browser"}: filters nested array rows by their displayed value`, async () => {
      const data = [null, [2, 3], { 値: [2, 3] }, [4]];
      const ops: ListOp[] = [{ kind: "filter", conds: [{ field: "値", op: "eq", value: "[2,3]" }] }];
      const result = await load(data, ops, native);
      assert.deepEqual(result, [{ 値: [2, 3] }, { 値: [2, 3] }]);
      assert.deepEqual(result, applyList(toListItems(data), {}, ops));
    });

    for (const data of [{ a: [3], b: [1], c: [2] }, [3, 1, 2], ["item10", "item2", "item1"], [[3], [1], [2]], [null, false, true]]) {
      test(`${native ? "native" : "browser"}: sorts raw rows ${JSON.stringify(data)} by their displayed value`, async () => {
        for (const dir of ["asc", "desc"] as const) {
          const ops: ListOp[] = [{ kind: "sort", field: "値", dir }];
          const result = await load(data, ops, native);
          assert.deepEqual(result, applyList(toListItems(data), {}, ops));
          assert.deepEqual(result.slice(0, 2), applyList(toListItems(data), { limit: 2 }, ops));
        }
      });
    }
  }
});

describe("list-filter-value-parity", () => {
  const passesStart = PAGE_DATA_RUNTIME.indexOf("  function passes(");
  const passesEnd = PAGE_DATA_RUNTIME.indexOf("  function filter(", passesStart);
  assert.ok(passesStart >= 0 && passesEnd > passesStart);
  const browserPasses = runInNewContext(PAGE_DATA_RUNTIME.slice(passesStart, passesEnd) + "\npasses", {
    read: lookupVar, compare: (left: unknown, right: unknown, op: string) => matchesValueCondition(left, op, right), parseValueLiteral, interpolate,
  });

  const examples = [null, undefined, true, false, 2, "null", "false", "[1,2]", "", [1, 2], { name: "A", enabled: true }];
  function evaluate(left: unknown, template: string, vars: Record<string, unknown>, op = "eq", not = false) {
    const ops: ListOp[] = [{ kind: "filter", conds: [{ field: "value", op: op as any, value: template, not }] }];
    const item = { value: left };
    const canvas = filterItems([item], resolvedListOps(new Map([["items", ops]]), "items", vars)).length > 0;
    const next = new Function("item", "vars", "lookupVar", "interpolate", `return ${filterPredicate(ops, "vars")}`)(item, vars, lookupVar, interpolate);
    const browser = browserPasses(item, (ops[0] as any).conds, vars);
    assert.equal(browser, next, JSON.stringify({ left, template, vars, op, not }));
    return { canvas, next };
  }
  for (const wanted of examples) test(`whole reference retains its JSON value: ${JSON.stringify(wanted)}`, () => {
    for (const left of examples) for (const not of [false, true]) {
      const expected = not !== matchesValueCondition(left, "eq", wanted);
      for (const template of ["{wanted}", " {wanted} ", "{nested.value}", "[slug]"]) {
        const actual = evaluate(left, template, { wanted, nested: { value: wanted }, slug: wanted }, "eq", not);
        assert.deepEqual(actual, { canvas: expected, next: expected }, JSON.stringify({left,wanted,template,not}));
      }
    }
  });
  test("missing variables remain undefined, not empty text or null", () => {
    for (const left of [undefined, null, ""]) {
      const expected = left === undefined;
      assert.deepEqual(evaluate(left, "{missing}", {}), { canvas: expected, next: expected });
    }
  });
  test("literal and mixed-template parsing keeps existing text and escape semantics", () => {
    const vars = { name: "A", count: 2, wanted: { name:"A" } };
    for (const template of ['{"name":"A"}', 'prefix {name}', '\\{name}', '"{name}"', '[{count}]', '{count}{count}', '{wanted} suffix', '[slug] suffix']) {
      const right = parseValueLiteral(interpolate(template, vars));
      for (const left of [...examples, right]) {
        const expected = matchesValueCondition(left,"eq",right);
        assert.deepEqual(evaluate(left,template,vars), {canvas:expected,next:expected},template);
      }
    }
  });
  test("typed references are preserved for all collection comparisons", () => {
    for (const op of ["in","contains","eq","has-key","empty","starts-with","ends-with","gte"])
      for (const wanted of examples) for (const left of examples) {
        const expected = matchesValueCondition(left,op,wanted);
        assert.deepEqual(evaluate(left,"{wanted}",{wanted},op), {canvas:expected,next:expected}, JSON.stringify({left,wanted,op}));
      }
  });
});
});

describe("checks", () => {
describe("checks", () => {
  const messages = (doc: ReturnType<typeof createInitialDoc>) => runChecks(doc).map((c) => c.message);

  function withPage(slug: string, title: string, name = "Page") {
    const doc = createInitialDoc();
    doc.siteName = "Cafe";
    doc.pages.x = { id: "x", name, slug, title, description: "", children: [] };
    doc.pageOrder.push("x");
    return doc;
  }

  test("a fresh site with a real name has no default-naming warnings", () => {
    const doc = createInitialDoc();
    doc.siteName = "Cafe";
    assert.ok(!messages(doc).some((m) => /自動で付け|初期値|タイトルが同じ/.test(m)), messages(doc).join("\n"));
  });

  test("the default site name is reported", () => {
    assert.ok(messages(createInitialDoc()).some((m) => m.includes("My Site")));
  });

  test("automatic URLs from adding and duplicating pages are reported", () => {
    for (const slug of ["page-3", "about-copy", "about-copy-2", "blog/post-copy", "copy"]) {
      assert.ok(messages(withPage(slug, "About")).some((m) => m.includes(`/${slug}`)), slug);
    }
    for (const slug of ["about", "pages", "copywriting", "page-intro"]) {
      assert.ok(!messages(withPage(slug, "About")).some((m) => m.includes(`/${slug}」が自動`)), slug);
    }
  });

  test("automatic titles and shared titles are reported", () => {
    for (const title of ["Page 3", "ページ 3"]) {
      assert.ok(messages(withPage("about", title)).some((m) => m.includes(`"${title}"`) && m.includes("automatic")));
    }
    // タイトルが空なら、ページ名がタイトルになる
    assert.ok(messages(withPage("about", "", "ページ 12")).some((m) => m.includes('"ページ 12"') && m.includes("automatic")));
    assert.ok(messages(withPage("menu", "Home")).some((m) => m.includes("same search and share title")));
    assert.ok(!messages(withPage("about", "ページの作り方")).some((m) => m.includes("still the automatic")));
  });

  test("unpublished pages are not checked", () => {
    const doc = withPage("page-3", "ページ 3");
    doc.pages.x.unpublished = true;
    assert.ok(!messages(doc).some((m) => m.includes("page-3") || m.includes("ページ 3")));
  });

  async function fresh(pages: Record<string, { name: string; slug: string; title: string }>) {
    const { useEditor } = await import("../lib/store");
    const doc = createInitialDoc();
    for (const [id, p] of Object.entries(pages)) {
      doc.pages[id] = { id, ...p, description: "", children: [] };
      doc.pageOrder.push(id);
    }
    useEditor.setState({ doc });
    const st = useEditor.getState;
    return { st, page: (id: string) => st().doc.pages[id], bySlug: (slug: string) => Object.values(st().doc.pages).find((p) => p.slug === slug)! };
  }

  test("MCP can create a named page with a single edit and a unique route", async () => {
    const { st } = await fresh({});
    const before = st().doc.pageOrder.length;
    const pageId = st().addPage(undefined, "Menu");
    const page = st().doc.pages[pageId];
    assert.equal(page.name, "Menu");
    assert.equal(page.title, "Menu");
    assert.equal(page.titlePending, undefined);
    assert.equal(st().activePageId, pageId);
    assert.equal(st().doc.pageOrder.length, before + 1);
    assert.ok(page.slug);
    assert.throws(() => st().addPage(undefined, "Menu"), /already exists/);
    assert.equal(st().doc.pageOrder.length, before + 1);
  });

  test("a new page takes its first confirmed name as its title, and is not linked afterwards", async () => {
    const { st } = await fresh({});
    const number = st().doc.pageOrder.length + 1;
    st().addPage();
    const added = Object.values(st().doc.pages).find((p) => p.titlePending)!;
    assert.ok(added, "new page is marked");
    assert.equal(added.name, `Page ${number}`);
    assert.equal(added.title, added.name);
    // 触れただけ（同じ名前で確定した）では、決まらない
    st().updatePage(added.id, { name: added.name });
    assert.equal(st().doc.pages[added.id].titlePending, true);
    st().updatePage(added.id, { name: "About us" });
    assert.equal(st().doc.pages[added.id].title, "About us");
    assert.equal(st().doc.pages[added.id].titlePending, undefined);
    // 2回目以降は連動しない
    st().updatePage(added.id, { name: "会社案内" });
    assert.equal(st().doc.pages[added.id].title, "About us");
  });

  test("titles without an explicit pending marker stay unchanged when a page is renamed", async () => {
    const { st, page } = await fresh({ x: { name: "ページ 2", slug: "page-2", title: "ページ 2" }, y: { name: "News", slug: "news", title: "News" } });
    st().updatePage("x", { name: "About us" });
    assert.equal(page("x").title, "ページ 2");
    st().updatePage("x", { name: "会社案内" });
    assert.equal(page("x").title, "ページ 2");
    // 自分で決めた名前と同じタイトルは、連動しない
    st().updatePage("y", { name: "News" });
    assert.equal(page("y").title, "News");
  });

  test("a copied page keeps the source title until its name is first confirmed", async () => {
    const { st, page, bySlug } = await fresh({ a: { name: "About", slug: "about", title: "About our cafe" } });
    st().duplicatePage("a");
    const id = bySlug("about-copy").id;
    assert.equal(page(id).title, "About our cafe");
    // 同じタイトルで確定しても、触れただけなので、しるしは残る
    st().updatePage(id, { title: "About our cafe" });
    assert.equal(page(id).titlePending, true);
    st().updatePage(id, { name: "Access" });
    assert.equal(page(id).title, "Access");
    st().updatePage(id, { name: "Map" });
    assert.equal(page(id).title, "Access");
    assert.equal(page("a").title, "About our cafe");
  });

  test("editing the title first stops it from following the name", async () => {
    const { st, page, bySlug } = await fresh({ a: { name: "About", slug: "about", title: "About our cafe" } });
    st().duplicatePage("a");
    const id = bySlug("about-copy").id;
    st().updatePage(id, { title: "Our menu" });
    st().updatePage(id, { name: "Menu" });
    assert.equal(page(id).title, "Our menu");
    // 名前とタイトルを一緒に指定したときは、指定したタイトルになる
    st().updatePage(id, { name: "Drinks", title: "Drinks list" });
    assert.equal(page(id).title, "Drinks list");
  });

  test("empty raw HTML blocks publishing instead of generating a blank page", () => {
    const doc = withPage("tokimeki-dreamworld", "Dream World", "Dream World");
    doc.pages.x.rawHtml = "";
    const errors = runChecks(doc).filter(result => result.level === "error" && result.message.includes("Dream World"));
    assert.ok(errors.some(result => result.message.includes("empty")), JSON.stringify(errors));
    doc.pages.x.rawHtml = "<!doctype html><body>Story</body>";
    assert.ok(!runChecks(doc).some(result => result.level === "error" && result.message.includes("empty")));
    doc.pages.x.rawHtml = undefined;
    assert.ok(!runChecks(doc).some(result => result.level === "error" && result.message.includes("empty")));
    doc.pages.x.rawHtml = " ";
    doc.pages.x.unpublished = true;
    assert.ok(!runChecks(doc).some(result => result.level === "error" && result.message.includes("empty")));
  });
});

describe("checks-fetch-detail", () => {
  function fixture():SiteDoc {
   return {siteName:'Detail',assets:{},nodes:{},pageOrder:['home','detail'],pages:{
    home:{id:'home',name:'Home',title:'Home',description:'',slug:'',children:[]},
    detail:{id:'detail',name:'Detail',title:'Detail',description:'',slug:'posts/[slug]',children:[],pageScripts:[{id:'load',trigger:'load',steps:[{id:'fetch',kind:'fetch',url:'https://example.com/posts/{slug}',as:'post'}]}]},
   }};
  }
  const missingData=(doc:SiteDoc)=>runChecks(doc).filter(r=>r.help==='data-detail'&&r.message.includes("doesn't fetch any data"));
  test('detail page with a generated server fetch does not warn that no data is fetched',()=>{
   const doc=fixture();
   assert.equal(pageDataSteps(doc,'detail').some(s=>s.kind==='fetch'&&s.as==='post'),true);
   const output=generateProject(doc).files['app/posts/[slug]/page.tsx'];
   assert.match(output,/await fetchJson\(interpolateUrl\("https:\/\/example.com\/posts\/\{slug\}"/);
   assert.deepEqual(missingData(doc),[]);
  });
  test('detail page without server data still reports the missing-data warning',()=>{
   const doc=fixture();doc.pages.detail.pageScripts=[];
   assert.equal(missingData(doc).length,1);
  });
  test('empty fetch URL still reports its separate blocking error',()=>{
   const doc=fixture();const step=doc.pages.detail.pageScripts![0].steps[0];
   if(step.kind==='fetch')step.url='';
   assert.ok(runChecks(doc).some(r=>r.level==='error'&&r.help==='data-fetch'));
  });
});
});

describe("custom-head-body-parsing", () => {
const require = createRequire(import.meta.url);
function renderHead(html: string) {
  const source = headHtmlToJsx(html, '');
  const mod = { exports: {} as any };
  new Function('require', 'module', 'exports', transformSync('export default <>' + source + '</>', { loader: 'tsx', format: 'cjs', jsx: 'automatic' }).code)(require, mod, mod.exports);
  return { source, tree: mod.exports.default, html: renderToStaticMarkup(mod.exports.default) };
}
const emitted = (html: string) => renderHead(html).html;
function content(html: string) {
  return parseFragment(html).childNodes.filter((n): n is Html.Element => 'tagName' in n).map(n => ({
    tag: n.tagName, attrs: n.attrs,
    text: n.childNodes.filter((c): c is Html.TextNode => c.nodeName === '#text').map(c => c.value).join(''),
  })).sort((a, b) => a.tag.localeCompare(b.tag));
}
function attributes(html: string) {
  const node = parseFragment(html).childNodes[0] as Html.Element;
  return Object.fromEntries(node.attrs.map(a => [a.name, a.value]));
}
test('custom head preserves complete double-escaped script body in executable output', () => {
  const body = '<!--\nconst tag="<script>";\nconst end="</script>";\nconst marker=42;\n// -->';
  const input = `<script>${body}</script><meta name="after" content="kept">`;
  const result = emitted(input);
  assert.deepEqual(content(result), content(input));
  const script = content(result).find(n => n.tag === 'script')!.text;
  assert.equal(new Function(script + '\nreturn marker')(), 42);
});
for (const [name, input] of [
  ['raw text with entities and quoted markup', '<style>.x:after{content:"&copy; <meta>"}</style><title>A &amp;amp; &copy; &lt;meta&gt;</title><noscript><link href="/fallback.css" rel="stylesheet"></noscript>'],
  ['HTML comment boundaries', '<!-- empty --!><meta name="kept" content="yes"><!-- <meta name="hidden"> -->'],
  ['unfinished title consumes apparent markup', '<title>Title &amp; <meta name="not-an-element">'],
  ['unclosed script body remains code', '<script>const value=42;'],
]) test(`custom head matches HTML body semantics: ${name}`, () => {
  assert.deepEqual(content(emitted(input)), content(input));
});
test('custom head does not promote tags inside body-only elements', () => {
  assert.equal(headHtmlToJsx('<div><meta name="nested"></div>', ''), '');
});
for (const value of ['&copy; &NotEqualTilde; &Alpha;', '&#0; &#x80; &#xD800; &#1114112;', '&copy no-semicolon &#65 &#x42', '&copy=literal &notit; &amp;amp;', 'line\r\nnext\rtab\tend', '&constructor; &unknown; &AMP;']) test(`head attributes preserve HTML entity semantics: ${JSON.stringify(value)}`, () => {
  for (const attr of ['content', 'scheme', 'data-value']) {
    const input = `<meta ${attr}="${value}">`;
    assert.deepEqual(attributes(emitted(input)), attributes(input), attr);
  }
});
test('head unquoted slash and empty attributes follow HTML parsing', () => {
  for (const input of ['<meta name=x content=a/>', '<link rel=stylesheet href=/style.css />', '<meta name content="" scheme>'])
    assert.deepEqual(attributes(emitted(input)), attributes(input));
});
test('custom head prototype-named attributes cannot become executable JSX attribute names', () => {
  const { source, tree, html } = renderHead('<meta name="example" constructor="metadata" CONSTRUCTOR="ignored">');
  assert.equal(tree.props.children.props.constructor, 'metadata');
  assert.match(html, /constructor="metadata"/);
  assert.doesNotMatch(source, /function Object|native code/);
});
test('unknown named references in custom attributes remain literal rather than reading Object.prototype', () => {
  const { tree, html } = renderHead('<meta scheme="&constructor; &amp; &#65;" content="plain">');
  assert.equal(tree.props.children.props.scheme, '&constructor; & A');
  assert.match(html, /scheme="&amp;constructor; &amp; A"/);
});
test('ordinary mapped, boolean and unknown head attributes retain their output', () => {
  const { tree } = renderHead('<script charset="utf-8" async="false" language="javascript" src="/app.js"></script>');
  assert.deepEqual(tree.props.children.props, { charSet: 'utf-8', async: true, language: 'javascript', src: '/app.js' });
});
});

describe("custom-head-reserved-props", () => {
const require = createRequire(import.meta.url);

function evaluate(source: string) {
  const module = { exports: {} as any };
  const code = transformSync(source, { loader: "tsx", format: "cjs", jsx: "automatic" }).code;
  new Function("require", "module", "exports", code)(
    (id: string) => id.endsWith(".css") ? {} : require(id), module, module.exports,
  );
  return module.exports.default;
}

function emitted(html: string) {
  return renderToStaticMarkup(evaluate(`export default <>${headHtmlToJsx(html, "")}</>`));
}

function element(html: string) {
  return parseFragment(html).childNodes.find((node): node is Html.Element => "tagName" in node)!;
}

for (const tag of ["meta", "link", "base"]) {
  test(`custom head ${tag} ignores the inert HTML children attribute rather than crashing SSR`, () => {
    const node = element(emitted(`<${tag} children="not child content" data-kept="yes">`));
    assert.equal(node.tagName, tag);
    assert.deepEqual(node.attrs, [{ name: "data-kept", value: "yes" }]);
    assert.deepEqual(node.childNodes, []);
  });
}

for (const [tag, body] of [
  ["script", "globalThis.authored = true;"],
  ["style", "body { color: green; }"],
  ["title", "Authored &amp; title"],
  ["noscript", '<link rel="stylesheet" href="/fallback.css">'],
]) {
  test(`custom head ${tag} does not confuse an HTML children attribute with its authored body`, () => {
    const expected = element(`<${tag}>${body}</${tag}>`).childNodes;
    const actual = element(emitted(`<${tag} children="not child content">${body}</${tag}>`)).childNodes;
    assert.deepEqual(actual.map(node => "value" in node ? node.value : node.nodeName),
      expected.map(node => "value" in node ? node.value : node.nodeName));
  });
}

test("custom head does not turn an inert children attribute into script or stylesheet content", () => {
  for (const tag of ["script", "style", "title", "noscript"]) {
    const node = element(emitted(`<${tag} children="globalThis.notAuthored = true;"></${tag}>`));
    assert.deepEqual(node.childNodes, []);
  }
});

test("generated Next layout renders head metadata containing a children attribute", () => {
  const doc: SiteDoc = {
    siteName: "Metadata test", assets: {}, nodes: {}, pageOrder: ["home"],
    pages: { home: { id: "home", name: "Home", title: "Home", slug: "", description: "", children: [] } },
    customHeadHtml: '<meta name="description" children="inert" content="Preserved"><script children="globalThis.notAuthored = true;"></script>',
  };
  const layout = evaluate(generateProject(doc).files["app/layout.tsx"]);
  const html = renderToStaticMarkup(layout({ children: "Body remains available" }));
  assert.match(html, /<meta name="description" content="Preserved"\/>/);
  assert.match(html, /<body>Body remains available<\/body>/);
  assert.doesNotMatch(html, /notAuthored/);
});
});

describe("deferred-scripts", () => {
const scriptsIn = (html: string) => {
  const fragment = parseFragment(html);
  const scripts: Html.Element[] = [];
  const walk = (nodes: Html.ChildNode[]) => {
    for (const node of nodes) {
      if (!("tagName" in node)) continue;
      if (node.tagName === "script") scripts.push(node);
      else if (node.tagName !== "template" && node.tagName !== "noscript") walk(node.childNodes);
    }
  };
  walk(fragment.childNodes);
  return scripts;
};

test("executable scripts are inert for SSR while data scripts remain unchanged", () => {
  const html = [
    '<div class="marquee"><span>WELCOME</span></div>',
    '<script src="/marquee.js" data-control="x"></script>',
    '<script type="module" nonce="a&amp;b">window.moduleLoaded = true;</script>',
    '<script type="text/javascript">window.classicLoaded = true;</script>',
    '<script type="application/ld+json">{"@type":"Thing"}</script>',
    '<script type="importmap">{"imports":{}}</script>',
    '<script type="text/plain">inert</script>',
    '<template><script>window.neverRun = true;</script></template>',
    '<textarea><script>literal</script></textarea>',
  ].join("");
  const output = deferRunnableScripts(html);
  const scripts = scriptsIn(output);
  assert.equal(scripts.length, 6);
  assert.deepEqual(scripts.slice(0, 3).map(s => s.attrs.find(a => a.name === "type")?.value),
    Array(3).fill("application/x-tsumu-deferred"));
  assert.equal(scripts[1].attrs.find(a => a.name === "data-tsumu-original-type")?.value, "module");
  assert.equal(scripts[2].attrs.find(a => a.name === "data-tsumu-original-type")?.value, "text/javascript");
  assert.deepEqual(scripts.slice(3).map(s => s.attrs.find(a => a.name === "type")?.value),
    ["application/ld+json", "importmap", "text/plain"]);
  assert.match(output, /<template><script>window\.neverRun = true;<\/script><\/template>/);
  assert.match(output, /<textarea><script>literal<\/script><\/textarea>/);
  assert.match(output, /<span>WELCOME<\/span>/);
});

test("script bodies, source order, and quoted attributes survive deferral", () => {
  const source = [
    '<script data-a="&quot;hello&quot;" type = \'text/javascript\' src="/first.js"></script>',
    '<script><!--\nconst s="<script>";\nconst marker=42;\n// --></script>',
    '<script type=module>import "/second.js";</script>',
    '<script type="application/json">{"count":1}</script>',
  ].join("\n");
  const deferred = deferRunnableScripts(source);
  assert.match(deferred, /data-tsumu-original-type="text\/javascript"/);
  assert.match(deferred, /data-tsumu-original-type="module"/);
  assert.match(deferred, /data-a="&quot;hello&quot;"/);
  assert.match(deferred, /const s="<script>";/);
  assert.match(deferred, /const marker=42;/);
  assert.match(deferred, /import "\/second\.js";/);
  assert.match(deferred, /<script type="application\/json">/);
  assert.equal((deferred.match(/data-tsumu-deferred/g) ?? []).length, 3);
});

test("Next.js page and site footer export inert HTML but preserve the authored script", () => {
  const doc: SiteDoc = {
    siteName: "Hydration regression",
    pages: {
      home: {
        id: "home", name: "Home", title: "Home", slug: "", description: "",
        children: [], customEndHtml: '<script>document.querySelector(".marquee-track").textContent += "WELCOME";</script>',
      },
    },
    pageOrder: ["home"], nodes: {}, assets: {},
    customBodyEndHtml: '<script src="/site.js"></script>',
  };
  const files = generateProject(doc).files;
  assert.ok(files["components/PageHtml.tsx"]);
  assert.match(files["app/page.tsx"], /<PageHtml html=/);
  assert.match(files["app/page.tsx"], /staticHtml=/);
  assert.match(files["app/page.tsx"], /application\/x-tsumu-deferred/);
  assert.match(files["app/layout.tsx"], /<PageHtml html=/);
  assert.match(files["app/layout.tsx"], /application\/x-tsumu-deferred/);
  assert.doesNotMatch(files["app/layout.tsx"], /<script src="\/site\.js">/);
});
});

describe("export-css-roundtrip", () => {
describe("export-css-roundtrip", () => {
  for (const framework of ["nextjs", "html", "react", "vue", "nuxt", "sveltekit"] as const) {
    for (const remote of [false, true]) test(`${framework} ZIP restores original ${remote ? "uploaded" : "embedded"} CSS bytes and script-relative dependencies`, async () => {
      const sources: Record<string, string> = {
        "css/main.css": '\uFEFF@import "nested/theme.css";\n@font-face{font-family:demo;src:url("../fonts/demo.woff2?v=2#font")}',
        "css/nested/theme.css": "body{color:navy}",
        "fonts/demo.woff2": "font fixture",
        "js/main.js": 'const link = document.createElement("link");link.rel="stylesheet";link.href=new URL("../css/main.css",import.meta.url);document.head.append(link);',
      };
      const stored = new Map<string, Uint8Array>();
      const assets = Object.entries(sources).map(([path, source], i): Asset => {
        const id = "asset-" + i;
        const bytes = new TextEncoder().encode(source);
        const mimeType = path.endsWith(".css") ? "text/css" : path.endsWith(".js") ? "text/javascript" : "font/woff2";
        stored.set("assets/" + id, bytes);
        return { id, name: path.replaceAll("/", "-"), width: 0, height: 0, mimeType,
          ...(remote ? { path: "assets/" + id } : { dataUrl: `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}` }),
          zip: { version: 1, group: "roundtrip", path,
            ...(path.endsWith(".css") ? { stylesheet: { source: source.replace(/^\uFEFF/, ""), references: [] } } : {}) },
        };
      });
      attachZipDependencies(assets);
      const doc: SiteDoc = { schemaVersion: 1, siteName: "CSS roundtrip", nodes: {},
        pageOrder: ["p"], pages: { p: { id: "p", name: "Home", slug: "", title: "", description: "", children: [],
          ...(["vue", "nuxt", "sveltekit"].includes(framework) ? {} : {
            customTopHtml: `<link rel="stylesheet" href="${zipCssUrl(assets[0].id)}">`,
            customEndHtml: `<script type="module" src="${assetSrc(assets[3])}"></script>`,
          }) } },
        assets: Object.fromEntries(assets.map(asset => [asset.id, asset])),
      };
      const original = structuredClone(doc);
      const globals = Object.getOwnPropertyDescriptors(globalThis);
      const createUrl = URL.createObjectURL;
      let download: Blob | undefined;
      let uploads = 0;
      URL.createObjectURL = blob => { download = blob; return "blob:css-roundtrip"; };
      Object.assign(globalThis, {
        document: { createElement: () => ({ href: "", download: "", click() {} }) },
        fetch: async (input: string, init?: RequestInit) => {
          if (input === "/api/status") return Response.json({ assets: true });
          if (input.startsWith("data:")) return globals.fetch.value(input, init);
          if (input.startsWith("/api/assets/file?")) {
            const bytes = stored.get(new URL(input, "https://editor.test").searchParams.get("path")!);
            assert.ok(bytes, input);
            return new Response(bytes);
          }
          assert.equal(input, "/api/assets");
          assert.equal(init?.method, "POST");
          const file = (init!.body as FormData).get("file") as File;
          const path = "assets/restored-" + ++uploads;
          stored.set(path, new Uint8Array(await file.arrayBuffer()));
          return Response.json({ path });
        },
      });
      try {
        const exportZip = async (value: SiteDoc) => {
          download = undefined;
          assert.deepEqual(await exportProjectZip(value, framework), []);
          assert.ok(download);
          return new Uint8Array(await (download as Blob).arrayBuffer());
        };
        const bytes = await exportZip(doc);
        const zip = await ZipArchive.open(bytes);
        const assetRoot = framework === "html" ? "assets/" : framework === "sveltekit" ? "static/assets/" : "public/assets/";
        const names = buildAssetNames(doc);
        const generated = await zip.file("css-roundtrip/" + assetRoot + names.get(assets[0].id))!.text();
        assert.ok(generated.includes(names.get(assets[1].id)!));
        assert.ok(generated.includes(names.get(assets[2].id)! + "?v=2#font"));
        assert.ok(!generated.includes("../fonts/"), "website CSS still uses generated filenames");

        const imported = await parseSiteImport(bytes, "zip");
        assert.deepEqual(imported.doc, original);
        for (const asset of assets) {
          assert.deepEqual(imported.assets.get(asset.id), new TextEncoder().encode(sources[asset.zip!.path]),
            "editable archive must preserve original bytes: " + asset.zip!.path);
        }
        const restored = await restoreImportAssets(imported);
        assert.deepEqual(restored.warnings, []);
        const next = await ZipArchive.open(await exportZip(restored.doc));
        for (const asset of assets) {
          const alias = `css-roundtrip/${assetRoot}_imports/roundtrip/${asset.zip!.path}`;
          assert.deepEqual(await next.file(alias)!.bytes(), new TextEncoder().encode(sources[asset.zip!.path]),
            "script-relative assets must survive re-import: " + alias);
        }
        assert.deepEqual(doc, original, "export does not mutate the active document");
      } finally {
        URL.createObjectURL = createUrl;
        for (const key of ["document", "fetch"]) {
          if (globals[key]) Object.defineProperty(globalThis, key, globals[key]);
          else Reflect.deleteProperty(globalThis, key);
        }
      }
    });
  }

  for (const mode of ["percent", "metadata", "missing", "forbidden"] as const) {
    test(`CSS-only ZIP preserves source or reports unavailable bytes: ${mode}`, async () => {
      const source = 'body::before{content:"日本語"}';
      const asset: Asset = { id: "css", name: "theme.css", width: 0, height: 0, mimeType: "text/css",
        ...(mode === "percent" ? { dataUrl: "data:text/css;charset=utf-8," + encodeURIComponent(source) } :
          mode === "metadata" ? {} : { path: "assets/unavailable" }),
        zip: { version: 1, group: "css-only", path: "theme.css", stylesheet: { source, references: [] } },
      };
      const doc: SiteDoc = { schemaVersion: 1, siteName: "CSS only", assets: { css: asset }, nodes: {}, pageOrder: ["p"],
        pages: { p: { id: "p", name: "Home", slug: "", title: "", description: "", children: [],
          customTopHtml: `<link rel="stylesheet" href="${zipCssUrl(asset.id)}">` } },
      };
      const globals = Object.getOwnPropertyDescriptors(globalThis);
      const createUrl = URL.createObjectURL;
      let download: Blob | undefined;
      URL.createObjectURL = blob => { download = blob; return "blob:css-only"; };
      Object.assign(globalThis, {
        document: { createElement: () => ({ href: "", download: "", click() {} }) },
        fetch: async (input: string) => input.startsWith("data:") ? globals.fetch.value(input) :
          new Response(null, { status: mode === "forbidden" ? 403 : 404 }),
      });
      try {
        if (mode === "forbidden") {
          await assert.rejects(exportProjectZip(doc, "html"), /403/);
          assert.equal(download, undefined, "failed asset reads must not offer an incomplete download");
          return;
        }
        const missing = await exportProjectZip(doc, "html");
        assert.deepEqual(missing, mode === "missing" ? ["_tsumu/assets/theme.css"] : []);
        assert.ok(download);
        const imported = await parseSiteImport(new Uint8Array(await (download as Blob).arrayBuffer()), "zip");
        if (mode === "missing") {
          assert.equal(imported.assets.has(asset.id), false);
          assert.ok(imported.warnings.some(warning => warning.includes(asset.name)));
        } else {
          assert.deepEqual(imported.assets.get(asset.id), new TextEncoder().encode(source));
          assert.deepEqual(imported.warnings, []);
        }
      } finally {
        URL.createObjectURL = createUrl;
        for (const key of ["document", "fetch"]) {
          if (globals[key]) Object.defineProperty(globalThis, key, globals[key]);
          else Reflect.deleteProperty(globalThis, key);
        }
      }
    });
  }
});

describe("export-positioning-breakpoints", () => {
  function css(styles: NodeStyles) {
    const doc: SiteDoc = { siteName: "Position", assets: {}, pageOrder: ["p"],
      pages: { p: { id: "p", name: "Home", title: "Home", description: "", slug: "", children: ["parent"] } },
      nodes: {
        parent: { ...makeBox(), id: "parent", children: ["child"], styles },
        child: { ...makeBox(), id: "child", styles: { base: { default: { position: "absolute", top: "0px" } } } },
      },
    };
    return {
      exported: generateSiteCss(doc, new Map([["parent", "parent"], ["child", "child"]]), new Map()),
      preview: buildCanvasCss(doc, ["parent"], "base", "preview", null, "default"),
    };
  }
  for (const position of ["relative", "absolute", "static", "fixed", "sticky"]) test(`narrow ${position} does not suppress desktop absolute-child containing block`, () => {
    const { exported, preview } = css({ sm: { default: { position } } });
    assert.match(preview, /position: relative/);
    const base = exported.slice(0, exported.indexOf("@media"));
    assert.match(base, /\.parent\s*\{[^}]*position: relative;/);
    assert.match(exported.slice(exported.indexOf("@media")), new RegExp(`position: ${position};`));
  });
  test("explicit base static remains intentional and is not replaced", () => {
    const { exported } = css({ base: { default: { position: "static" } }, sm: { default: { position: "relative" } } });
    assert.match(exported.slice(0, exported.indexOf("@media")), /\.parent\s*\{[^}]*position: static;/);
  });
});

describe("export-custom-css-comments", () => {
  const postcss=createRequire(import.meta.url)('postcss');
  function css(source:string) {
    const doc:SiteDoc={siteName:'Comments',assets:{},pageOrder:['p'],pages:{p:{id:'p',name:'P',title:'P',description:'',slug:'',children:['box']}},nodes:{box:{...makeBox(),id:'box',customCss:source}}};
    return { exported:generateSiteCss(doc,new Map([['box','box']]),new Map()),
      canvas:buildCanvasCss(doc,['box'],'base','preview',null,'default') };
  }
  function declarations(source:string) {
    const result:Record<string,string>={};
    postcss.parse(source).walkDecls((decl:any)=>{result[decl.prop]=decl.value;});
    return result;
  }
  for(const source of [
    'color:red; /* note */ background:blue;',
    '/* punctuation ; : ) \' */ color:red; /* more */ background:blue;',
    'color:/* ; ) " */red; background:blue;',
    'color /* property note */ : red; background: blue;',
    String.raw`color:red; --literal: \/*not-comment*/; background:blue;`,
    'color:red; content:"/* keep ; quote */"; background:blue;',
  ]) test(`export preserves commented custom declarations: ${source}`,()=>{
    const actual=css(source);
    const expected=declarations(actual.canvas),result=declarations(actual.exported);
    assert.equal(result.color,expected.color);
    assert.equal(result.background,expected.background);
    if(source.includes('--literal:'))assert.equal(result['--literal'],expected['--literal']);
    if(source.includes('content:'))assert.equal(result.content,expected.content);
  });
  for (const [closingStyle, openingScript] of [
    ['</style>', '<script>'],
    ['</STYLE>', '<SCRIPT>'],
    ['</StYlE>', '<ScRiPt>'],
  ]) test(`comment tokens do not make rule-breaking custom declarations valid: ${closingStyle}`, () => {
    const result = css(`color: red; /* note */ background: blue; bad property: x; content: "${closingStyle}${openingScript}x</script>";`);
    assert.equal(declarations(result.exported).background, 'blue');
    assert.doesNotMatch(result.exported, /bad property|<\/style>|<script>/i);
  });
});

describe("export-responsive-containing-block", () => {
  function fixture(child: NodeStyles, parent: NodeStyles = {}) {
    const doc: SiteDoc = { siteName: "Position", assets: {}, pageOrder: [], pages: {}, nodes: {
      parent: { ...makeBox(), id: "parent", children: ["child"], styles: parent },
      child: { ...makeBox(), id: "child", styles: child },
    } };
    const exported = generateSiteCss(doc, new Map([["parent", "parent"], ["child", "child"]]), new Map());
    const at = exported.indexOf("@media");
    return { doc, exported, base: at < 0 ? exported : exported.slice(0, at), media: at < 0 ? "" : exported.slice(at) };
  }
  test("a mobile-only absolute child does not position its parent on desktop", () => {
    const { doc, base, media } = fixture({ sm: { default: { position: "absolute" } } });
    assert.doesNotMatch(buildCanvasCss(doc, ["parent"], "base", "preview", null, "default"), /position: relative/);
    assert.doesNotMatch(base, /\.parent(?:,\s*\.[\w-]+)*\s*\{[^}]*position: relative/);
    assert.match(media, /\.parent(?:,\s*\.[\w-]+)*\s*\{[^}]*position: relative/);
  });
  test("automatic containing block ends when its last absolute child becomes static", () => {
    const { doc, base, media } = fixture({ base: { default: { position: "absolute" } }, sm: { default: { position: "static" } } });
    assert.doesNotMatch(buildCanvasCss(doc, ["parent"], "sm", "preview", null, "default"), /position: relative/);
    assert.match(base, /\.parent(?:,\s*\.[\w-]+)*\s*\{[^}]*position: relative/);
    assert.match(media, /\.parent(?:,\s*\.[\w-]+)*\s*\{[^}]*position: static/);
  });
  test("authored containing block remains when a child stops being absolute", () => {
    const { base, media } = fixture({ base: { default: { position: "absolute" } }, sm: { default: { position: "static" } } }, { base: { default: { position: "relative" } } });
    assert.match(base, /\.parent(?:,\s*\.[\w-]+)*\s*\{[^}]*position: relative/);
    assert.doesNotMatch(media, /\.parent(?:,\s*\.[\w-]+)*\s*\{[^}]*position: static/);
  });
  test("explicit static parent prevents automatic positioning at every breakpoint", () => {
    const { base, media } = fixture({ sm: { default: { position: "absolute" } } }, { base: { default: { position: "static" } } });
    assert.match(base, /\.parent(?:,\s*\.[\w-]+)*\s*\{[^}]*position: static/);
    assert.doesNotMatch(base + media, /\.parent(?:,\s*\.[\w-]+)*\s*\{[^}]*position: relative/);
  });

  test("custom CSS positioning is not overwritten by inferred media rules", () => {
    const { doc } = fixture({ base: { default: { position: "absolute" } }, sm: { default: { position: "static" } } });
    doc.nodes.parent.customCss = "position: absolute; top: 20px";
    const exported = generateSiteCss(doc, new Map([["parent", "parent"], ["child", "child"]]), new Map());
    assert.match(exported, /\.parent(?:,\s*\.[\w-]+)*\s*\{[^}]*position: absolute/);
    assert.doesNotMatch(exported, /\.parent(?:,\s*\.[\w-]+)*\s*\{[^}]*position: (relative|static)/);
  });
});

describe("css-module-escaped-values", () => {
  const require = createRequire(import.meta.url);
  const postcss = require("postcss");
  const local = require("next/dist/compiled/postcss-modules-local-by-default");
  const scope = require("next/dist/compiled/postcss-modules-scope");
  const compile = (css: string) => postcss([
    local(), scope({ generateScopedName: (name: string) => "scoped_" + name }),
  ]).process(css, { from: "site.module.css" });

  function declarations(css: string): [string, string][] {
    const values: [string, string][] = [];
    postcss.parse(css).walkDecls((decl: { prop: string; value: string; parent: { selector: string } }) => {
      if (decl.parent.selector !== ":export" && decl.prop !== "display") values.push([decl.prop, decl.value]);
    });
    return values;
  }

  for (const value of [
    String.raw`url(/assets/owner\'s-photo.png)`,
    String.raw`url(/assets/icon\"small.png)`,
    String.raw`url(/assets/icon\{small.png)`,
    String.raw`url(/assets/icon\}small.png)`,
  ]) {
    for (const responsive of [false, true]) {
      test(`CSS Modules preserves escaped CSS tokens ${value} (responsive=${responsive})`, async () => {
        const rules = `.card { --authored: ${value}; color: red; }\n.after { color: blue; }`;
        const source = responsive ? `@media (max-width: 600px) { ${rules} }` : rules;
        const expected = declarations(source);
        const split = splitCssModule(source);
        assert.ok(split.module.includes(`--authored: ${value};`));
        const result = await compile(split.module);
        assert.deepEqual(declarations(result.css), expected);
        assert.match(result.css, /\.scoped_siteRoot \.after/);
        assert.equal(split.global.trim(), "");
        if (responsive) {
          result.root.walkDecls("--authored", (decl: any) => {
            assert.equal(decl.parent.parent.name, "media");
            assert.equal(decl.parent.parent.params, "(max-width: 600px)");
          });
        }
      });
    }
  }

  for (const framework of ["nextjs", "react", "vue", "nuxt", "sveltekit"] as const) {
    test(`${framework} CSS Modules exports valid escaped URLs from authored styles`, async () => {
      const image = String.raw`url(/assets/owner\'s-photo.png)`;
      const narrowImage = String.raw`url(/assets/icon\}small.png)`;
      const doc: SiteDoc = {
        siteName: "Escaped CSS", assets: {}, pageOrder: ["p"],
        pages: { p: { id: "p", name: "Home", title: "Home", description: "", slug: "", children: ["card", "after"],
          bodyStyles: { base: { default: { backgroundImage: image } } } } },
        nodes: {
          card: { ...makeBox(), id: "card", customCss: `background-image: ${image};`,
            styles: { sm: { default: { backgroundImage: narrowImage } } } },
          after: { ...makeBox(), id: "after", styles: { base: { default: { color: "blue" } } } },
        },
      };
      const options = { framework, language: "typescript", scope: "project" } as const;
      const original = generateExportProject(doc, { ...options, style: "css" });
      const originalCss = Object.entries(original.files).find(([path]) => path.endsWith("/site.css"))![1];
      const generated = generateExportProject(doc, { ...options, style: "css-modules" });
      const module = Object.entries(generated.files).find(([path]) => path.endsWith("site.module.css"))![1];
      const global = Object.entries(generated.files).find(([path]) => path.endsWith("site-global.css"))![1];
      const compiled = await compile(module);
      assert.deepEqual(declarations(global + compiled.css), declarations(originalCss));
      assert.equal(declarations(compiled.css).filter(([prop]) => prop === "background-image").length, 2);
      assert.ok(global.includes(image));
    });
  }
});

describe("css-module-keyframe-parity", () => {
  const require = createRequire(import.meta.url);
  const postcss = require("postcss");
  const local = require("next/dist/compiled/postcss-modules-local-by-default");
  const scope = require("next/dist/compiled/postcss-modules-scope");
  for (const prefix of ["", "-webkit-"]) test(`CSS Modules keeps ${prefix}keyframes paired with compiled animation names`, async () => {
    const source = `body { animation: shared 2s; }
  .card { animation: shared 1s ease, other 2s linear; }
  @${prefix}keyframes shared { from { opacity: 0; } to { opacity: 1; } }
  @${prefix}keyframes other { from { transform: translateX(2px); } to { transform: none; } }`;
    const split = splitCssModule(source);
    const result = await postcss([local(), scope({ generateScopedName: (name: string) => "scoped_" + name })]).process(split.module, { from: "site.module.css" });
    const names: string[] = [];
    result.root.walkAtRules(/keyframes$/, (rule: any) => names.push(rule.params));
    assert.ok(names.includes("scoped_shared"), "module animation must have the matching local definition");
    assert.ok(names.includes("scoped_other"));
    assert.match(result.css, /animation: scoped_shared 1s ease, scoped_other 2s linear/);
    assert.ok(split.global.includes(`@${prefix}keyframes shared`), "global body animation retains its original definition");
  });
  test("responsive module keyframes retain their enclosing media condition", async () => {
    const split = splitCssModule('@media (max-width:600px) { .card { animation-name: narrow; } @keyframes narrow { to { opacity: 0; } } }');
    const result = await postcss([local(), scope({ generateScopedName: (name: string) => "scoped_" + name })]).process(split.module, { from: "site.module.css" });
    let checked = false;
    result.root.walkAtRules("keyframes", (rule: any) => {
      assert.equal(rule.params, "scoped_narrow");
      assert.equal(rule.parent.name, "media");
      assert.equal(rule.parent.params, "(max-width:600px)");
      checked = true;
    });
    assert.ok(checked);
  });

  test("an authored motion survives the actual CSS Modules export pipeline", async () => {
    const { generateExportProject } = await import("../lib/export-formats");
    const { makeBox } = await import("../lib/presets");
    const doc = { siteName: "Motion", assets: {}, pageOrder: ["p"],
      pages: { p: { id: "p", name: "Home", title: "Home", description: "", slug: "", children: ["box"] } },
      nodes: { box: { ...makeBox(), id: "box", motions: [{ id: "fade", trigger: "load" as const,
        keyframes: "custom", customKeyframes: "from { opacity: 0; } to { opacity: 1; }", duration: 1, delay: 0, easing: "ease" }] } },
    };
    for (const framework of ["nextjs", "react", "vue", "nuxt", "sveltekit"] as const) {
      const { files } = generateExportProject(doc, { framework, language: "typescript", style: "css-modules", scope: "project" });
      const module = Object.entries(files).find(([path]) => path.endsWith("site.module.css"))![1];
      const result = await postcss([local(), scope({ generateScopedName: (name: string) => "scoped_" + name })]).process(module, { from: "site.module.css" });
      const names: string[] = [];
      result.root.walkAtRules("keyframes", (rule: any) => names.push(rule.params));
      assert.ok(names.length > 0, framework);
      let matched = false;
      result.root.walkDecls(/^animation(?:-name)?$/, (decl: any) => {
        if (names.some(name => decl.value.includes(name))) matched = true;
      });
      assert.ok(matched, framework + " animation references its emitted scoped keyframes");
    }
  });
});
});

describe("export-editable-zip", () => {
test("ZIP export preserves the editable SiteDoc and archive asset IDs for direct re-import", async () => {
  const doc = createInitialDoc();
  doc.siteName = "ZIP roundtrip";
  doc.customHeadHtml = '<meta name="test-roundtrip" content="yes">';
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>';
  doc.assets["original-asset"] = {
    id: "original-asset", name: "mark.svg",
    width: 10, height: 10, mimeType: "image/svg+xml",
    dataUrl: "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64"),
  };
  const draft = "private-draft";
  doc.pages[draft] = { ...doc.pages[doc.pageOrder[0]], id: draft, slug: "draft", unpublished: true, children: ["draft-code"] };
  doc.pageOrder.push(draft);
  doc.nodes["draft-code"] = {
    ...makeBox(), id: "draft-code", type: "code",
    code: { html: '<link rel="stylesheet" href="tsumu-zip-css:removed-stylesheet">' },
  };
  let blob: Blob | null = null;
  const createUrl = URL.createObjectURL;
  const previousDoc = globalThis.document;
  try {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true, value: (b: Blob) => { blob = b; return "blob:export-test"; },
    });
    Object.defineProperty(globalThis, "document", {
      configurable: true, value: {
        createElement: () => ({ href: "", download: "", click() {} }),
      },
    });
    const missing = await exportProjectZip(doc);
    assert.deepEqual(missing, []);
    assert.ok(blob);
    const bytes = new Uint8Array(await (blob as Blob).arrayBuffer());
    const zip = await ZipArchive.open(bytes);
    const roundtrip = await zip.file("zip-roundtrip/" + EDITABLE_DOC_PATH)!.text();
    assert.deepEqual(JSON.parse(roundtrip), doc);
    assert.equal(zip.file("zip-roundtrip/app/draft/page.tsx"), null);
    const mapped = JSON.parse(await zip.file("zip-roundtrip/" + EDITABLE_ASSETS_PATH)!.text());
    assert.equal(mapped.version, 1);
    assert.equal(mapped.assets["original-asset"], "public/assets/mark.svg");
    assert.ok(zip.file("zip-roundtrip/public/assets/mark.svg"));
    const imported = await parseSiteImport(bytes, "zip");
    assert.deepEqual(imported.doc, doc);
    assert.equal(imported.doc.assets["original-asset"].id, "original-asset");
    assert.equal(new TextDecoder().decode(imported.assets.get("original-asset")), svg);
  } finally {
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createUrl });
    Object.defineProperty(globalThis, "document", { configurable: true, value: previousDoc });
  }
});

test("HTML, Vue and SvelteKit ZIP exports round-trip editable data and asset IDs", async () => {
  const doc = createInitialDoc();
  doc.siteName = "Format roundtrip";
  // 初期のサイトには、静的なフレームワークが意図的に拒否する動的なルートが含まれている。
  for (const page of Object.values(doc.pages)) {
    if (/\[[^\]]+\]/.test(page.slug)) page.unpublished = true;
  }
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>';
  doc.assets["roundtrip-logo"] = {
    id: "roundtrip-logo", name: "logo.svg", mimeType: "image/svg+xml",
    width: 10, height: 10,
    dataUrl: "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64"),
  };
  const createUrl = URL.createObjectURL;
  const previousDoc = globalThis.document;
  let blob: Blob | null = null;
  try {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true, value: (value: Blob) => { blob = value; return "blob:roundtrip"; },
    });
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: { createElement: () => ({ href: "", download: "", click() {} }) },
    });
    for (const framework of ["html", "vue", "sveltekit"] as const) {
      blob = null;
      const missing = await exportProjectZip(doc, {
        framework, language: "javascript", style: "css", scope: "project",
      });
      assert.deepEqual(missing, []);
      assert.ok(blob, `Missing ${framework} ZIP`);
      const archive = new Uint8Array(await (blob as Blob).arrayBuffer());
      const imported = await parseSiteImport(archive, "zip");
      assert.deepEqual(imported.doc, doc);
      assert.equal(imported.doc.assets["roundtrip-logo"].id, "roundtrip-logo");
      assert.equal(new TextDecoder().decode(imported.assets.get("roundtrip-logo")), svg);
      const zip = await ZipArchive.open(archive);
      const mapPath = "format-roundtrip/" + EDITABLE_ASSETS_PATH;
      const assetMap = JSON.parse(await zip.file(mapPath)!.text());
      const prefix = framework === "html" ? "assets/" :
        framework === "sveltekit" ? "static/assets/" : "public/assets/";
      assert.equal(assetMap.assets["roundtrip-logo"], prefix + "logo.svg");
    }
  } finally {
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createUrl });
    Object.defineProperty(globalThis, "document", { configurable: true, value: previousDoc });
  }
});


test("page-scoped ZIP round-trip does not include other pages, nodes or private assets", async () => {
  const doc = createInitialDoc();
  doc.siteName = "Scope audit";
  const home = doc.pageOrder[0];
  doc.pages = { [home]: { ...doc.pages[home], slug: "", unpublished: false } };
  doc.pageOrder = [home];
  doc.pages.private = {
    ...structuredClone(doc.pages[home]), id: "private",
    name: "Private", title: "PRIVATE-PAGE-TITLE", slug: "private",
    children: ["private-node"], unpublished: true,
  };
  doc.pageOrder.push("private");
  doc.nodes["private-node"] = { ...doc.nodes[doc.pages[home].children[0]],
    id: "private-node", text: { content: "PRIVATE-NODE-CONTENT", heading: 0 } };
  doc.assets["private-asset"] = {
    id: "private-asset", name: "secret.svg", width: 10, height: 10,
    mimeType: "image/svg+xml",
    dataUrl: "data:image/svg+xml;base64," +
      Buffer.from("<svg>SECRET_ASSET_MARKER</svg>").toString("base64"),
  };
  doc.pages[home].customEndHtml = '<img src="https://external.test/assets/secret.svg"><img src="//export.invalid/assets/secret.svg"><!-- <img src="/assets/secret.svg"> -->';
  doc.pages[home].description = "Example local filename: /assets/secret.svg";
  doc.pages[home].folderId = "guides";
  doc.pageFolders = [{ id: "guides", name: "Guides", beforePageId: "private" }];
  doc.loadingScreen = { enabled: true, pageId: "private" };
  for (const id of ["heading-font", "draft-font"]) {
    doc.assets[id] = { id, name: id + ".woff2", width: 0, height: 0,
      mimeType: "font/woff2", dataUrl: "data:font/woff2;base64,AQID" };
  }
  doc.uploadedFonts = [
    { family: "Heading Font", assetId: "heading-font" },
    { family: "Draft Font", assetId: "draft-font" },
  ];
  doc.pages[home].bodyDarkStyles = { base: { default: { fontFamily: "Heading Font" } } };
  doc.nodes["private-node"].styles = { base: { default: { fontFamily: "Draft Font" } } };
  const create = URL.createObjectURL;
  const previous = globalThis.document;
  let blob: Blob | null = null;
  try {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true, value: (value: Blob) => { blob = value; return "blob:scoped"; },
    });
    Object.defineProperty(globalThis, "document", { configurable: true,
      value: { createElement: () => ({ href: "", download: "", click() {} }) },
    });
    await exportProjectZip(doc, {
      framework: "html", language: "javascript", style: "css",
      scope: "page", pageId: home,
    });
    assert.ok(blob);
    const archive = await ZipArchive.open(await (blob as Blob).arrayBuffer());
    const names = Object.keys(archive.files);
    assert.ok(!names.some((name) => name.endsWith("/assets/secret.svg")));
    const entry = archive.file("scope-audit/" + EDITABLE_DOC_PATH);
    assert.ok(entry);
    const scoped = JSON.parse(await entry.text());
    assert.deepEqual(scoped.pageOrder, [home]);
    assert.equal(scoped.pages.private, undefined);
    assert.equal(scoped.nodes["private-node"], undefined);
    assert.equal(scoped.assets["private-asset"], undefined);
    assert.deepEqual(scoped.pageFolders, [{ id: "guides", name: "Guides" }]);
    assert.equal(scoped.loadingScreen, undefined);
    assert.deepEqual(scoped.uploadedFonts, [doc.uploadedFonts[0]]);
    assert.ok(names.some(name => name.endsWith("/assets/heading-font.woff2")));
    assert.ok(!names.some(name => name.endsWith("/assets/draft-font.woff2")));
    assert.equal(doc.pageFolders[0].beforePageId, "private");
    assert.equal(doc.uploadedFonts.length, 2);
    const imported = await parseSiteImport(new Uint8Array(await (blob as Blob).arrayBuffer()), "zip");
    assert.deepEqual(imported.doc.pageOrder, [home]);
  } finally {
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: create });
    Object.defineProperty(globalThis, "document", { configurable: true, value: previous });
  }
});
});

describe("export-embedded-asset-parity", () => {
const require = createRequire(import.meta.url);
const { parse } = require("next/dist/compiled/node-html-parser");
const source = "/api/assets/file?path=assets%2Fprivate-photo.png";
const inline = "data:image/png;base64,AQID";

function fixture(): SiteDoc {
  return {
    siteName: "Embedded assets", pageOrder: ["p"],
    pages: { p: { id: "p", name: "Home", title: "Home", description: "", slug: "guide/details", children: ["code", "icon"] } },
    nodes: {
      code: { ...makeBox(), id: "code", type: "code", code: { html:
        `<img id="remote" src="${source}&amp;v=1#photo">` +
        `<img id="inline" src="${inline}">` +
        `<div id="background" style="background-image:url(&quot;${source}&quot;)">Literal {value} &amp; text</div>` } },
      icon: { ...makeBox(), id: "icon", type: "icon", icon: { name: "picture", svg:
        `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">` +
        `<image id="svg-image" href="${source}#picture" />` +
        `<image id="svg-xlink" xlink:href="${source}#picture" /></svg>` } },
    },
    assets: {
      remote: { id: "remote", name: "photo.png", path: "assets/private-photo.png", mimeType: "image/png", width: 1, height: 1 },
      inline: { id: "inline", name: "photo.png", dataUrl: inline, mimeType: "image/png", width: 1, height: 1 },
    },
  };
}

async function pageMarkup(files: Record<string, string>, framework: string, language: string): Promise<string> {
  if (framework === "nextjs" || framework === "react") {
    const path = framework === "nextjs" ? "app/guide/details/page" : "src/pages/Page0";
    const code = transformSync(files[path + (language === "typescript" ? ".tsx" : ".jsx")], {
      loader: "tsx", format: "cjs", jsx: "automatic",
    }).code;
    const module = { exports: {} as any };
    new Function("require", "module", "exports", code)(require, module, module.exports);
    return renderToStaticMarkup(await module.exports.default({ searchParams: Promise.resolve({}) }));
  }
  const path = framework === "vue" ? "src/pages/Page0.vue"
    : framework === "nuxt" ? "app/generated/pages/Page0.vue" : "src/lib/pages/Page0.svelte";
  // これらの定数は、v-html / {@html} に渡す HTML そのもの。出力したリテラルを評価して、
  // SFC のエスケープを含めた実行時の値を確かめる。
  return [...files[path].matchAll(/const rawBlock\d+ = ("(?:\\.|[^"\\])*");/g)]
    .map(match => JSON.parse(match[1])).join("\n");
}

function assertMarkup(html: string, prefix: string, remote = "photo.png", embedded = "photo-2.png") {
  const tree = parse(html);
  assert.equal(tree.querySelector("#remote")?.getAttribute("src"), prefix + `assets/${remote}?v=1#photo`);
  assert.equal(tree.querySelector("#inline")?.getAttribute("src"), prefix + `assets/${embedded}`);
  assert.equal(tree.querySelector("#svg-image")?.getAttribute("href"), prefix + `assets/${remote}#picture`);
  assert.equal(tree.querySelector("#svg-xlink")?.getAttribute("xlink:href"), prefix + `assets/${remote}#picture`);
  assert.equal(tree.querySelector("#background")?.getAttribute("style"), `background-image:url("${prefix}assets/${remote}")`);
  assert.equal(tree.querySelector("#background")?.textContent, "Literal {value} & text");
  assert.doesNotMatch(html, /\/api\/assets\/file|private-photo/);
}

for (const framework of ["nextjs", "react", "vue", "nuxt", "sveltekit"] as const) {
  for (const language of ["typescript", "javascript"] as const) {
    for (const style of ["css", "css-modules", "tailwind"] as const) {
      test(`${framework} ${language} ${style} embeds exported asset URLs in code and SVG`, async () => {
        const doc = fixture(), before = structuredClone(doc);
        const project = await prepareExportProject(doc, { framework, language, style, scope: "page", pageId: "p" });
        const root = framework === "sveltekit" ? "static/" : "public/";
        // 範囲を絞ったアセットの探索では、重複を避ける接尾辞の割り当てが変わることがある。
        // 結果のリソースの対応表で、URL が正しいバイト列を指していなければならない。
        const [remote] = Object.keys(project.remoteAssets);
        const [embedded] = Object.keys(project.binaries);
        assert.ok(remote.startsWith(root + "assets/"));
        assert.ok(embedded.startsWith(root + "assets/"));
        assert.notEqual(remote, embedded);
        assert.equal(project.remoteAssets[remote], "assets/private-photo.png");
        assert.equal(project.binaries[embedded], "AQID");
        assertMarkup(await pageMarkup(project.files, framework, language), "/", remote.split("/").at(-1), embedded.split("/").at(-1));
        assert.deepEqual(doc, before);
      });
    }
  }
}

test("nested HTML code and SVG use relative exported asset URLs", () => {
  const doc = fixture();
  doc.pages.home = { ...doc.pages.p, id: "home", slug: "", children: [] };
  doc.pageOrder.unshift("home");
  doc.pages.p.customEndHtml = '<style>.hero{background:url(/assets/photo.png)}';
  const untouched = '<script>const example = "<img src=/assets/example.png>";</script>';
  doc.pages.p.customTopHtml = '<!-- note --!><img src=/assets/photo.png>' +
    '<template><img src=&#47;assets/photo.png></template>' +
    '<img src="' + source + '&amp;v=2&amp;size=3#icon">' + untouched;
  const project = generateExportProject(doc, "html");
  const html = project.files["guide/details/index.html"];
  assertMarkup(html, "../../");
  assert.ok(html.includes('<!-- note --!><img src="../../assets/photo.png">'));
  assert.ok(html.includes('<template><img src="../../assets/photo.png"></template>'));
  assert.ok(html.includes('<img src="../../assets/photo.png?v=2&amp;size=3#icon">'));
  assert.ok(html.includes(untouched));
  assert.ok(html.includes('<style>.hero{background:url(../../assets/photo.png)}'));
});

test("React browser-data rendering keeps embedded assets portable", async () => {
  const doc = fixture();
  doc.nodes.live = { ...makeBox(), id: "live", text: { content: "Hello {visitor}", heading: 0 } };
  doc.pages.p.children.push("live");
  doc.pages.p.pageScripts = [{ id: "load", trigger: "load",    steps: [{ id: "visitor", kind: "set-var", into: "visitor", value: "Guest" }] }];
  const project = await prepareExportProject(doc, "react");
  assert.ok(project.files["public/data-loader.js"]);
  assertMarkup(await pageMarkup(project.files, "react", "typescript"), "/");
});

test("single HTML embeds code and SVG assets from the exported resource map", async () => {
  const doc = fixture();
  doc.pages.p.slug = "";
  const requests: string[] = [];
  const project = await toSingleHtmlProject(generateExportProject(doc, "single-html"), async (url) => {
    requests.push(String(url));
    assert.equal(url, source);
    return new Response(Uint8Array.from([4, 5, 6]), { headers: { "Content-Type": "image/png" } });
  });
  const tree = parse(project.files["index.html"]);
  assert.match(tree.querySelector("#remote").getAttribute("src"), /^data:image\/png;base64,BAUG/);
  assert.equal(tree.querySelector("#inline").getAttribute("src"), inline);
  assert.match(tree.querySelector("#svg-image").getAttribute("href"), /^data:image\/png;base64,BAUG/);
  assert.match(tree.querySelector("#svg-xlink").getAttribute("xlink:href"), /^data:image\/png;base64,BAUG/);
  assert.match(tree.querySelector("#background").getAttribute("style"), /data:image\/png;base64,BAUG/);
  assert.deepEqual(requests, [source]);
  assert.deepEqual(Object.keys(project.files), ["index.html"]);
  assert.deepEqual(project.remoteAssets, {});
});
});

describe("export-formats", () => {
function fixture(): SiteDoc {
  const box = { ...makeBox(), id: "hero", text: { content: "Hello", heading: 1 } };
  const image = { ...makeImage(), id: "photo" };
  return {
    siteName: "Export Test",
    pages: {
      home: { id: "home", name: "Home", slug: "", title: "Home", description: "Welcome", children: ["hero", "photo"] },
    },
    pageOrder: ["home"],
    nodes: { hero: box, photo: image },
    assets: {},
  };
}

test("Next.js export remains identical to the publish generator", async () => {
  const { generateProject } = await import("../lib/generator");
  assert.deepEqual(generateExportProject(fixture(), "nextjs"), generateProject(fixture()));
});

test("React output includes Vite entrypoints, routes, CSS and assets", () => {
  const result = generateExportProject(fixture(), "react");
  assert.match(result.files["package.json"], /"vite"/);
  assert.match(result.files["src/main.tsx"], /createRoot/);
  assert.match(result.files["src/App.tsx"], /const routes: Route\[\]/);
  assert.match(result.files["src/pages/Page0.tsx"], /Hello/);
  assert.match(result.files["src/pages/Page0.tsx"], /<img/);
  assert.doesNotMatch(result.files["src/pages/Page0.tsx"], /next\/image/);
  assert.ok(result.files["src/site.css"]);
  assert.ok(result.files["src/globals.css"]);
  assert.match(result.files["index.html"], /<div id="root"><\/div>/);
  assert.equal(result.files["next.config.mjs"], undefined);
});

test("HTML export downloads ready-to-open pages, styles and assets without a build", () => {
  const result = generateExportProject(fixture(), "html");
  assert.match(result.files["index.html"], /<!doctype html>/);
  assert.match(result.files["index.html"], /Hello/);
  assert.match(result.files["index.html"], /styles\/globals\.css/);
  assert.match(result.files["index.html"], /styles\/site\.css/);
  assert.ok(result.files["styles/site.css"]);
  assert.ok(result.files["styles/globals.css"]);
  assert.equal(result.files["package.json"], undefined);
  assert.equal(result.files["next.config.mjs"], undefined);
  assert.equal(result.files["vite.config.ts"], undefined);
  assert.match(result.files["README.txt"], /No npm install/);
});

test("HTML export produces independent nested pages and relative links", () => {
  const doc = fixture();
  doc.pages.about = { ...doc.pages.home, id: "about", name: "About", slug: "about", title: "About", children: [] };
  doc.pageOrder.push("about");
  doc.nodes.hero.link = { kind: "page", pageId: "about" };
  const result = generateExportProject(doc, "html");
  assert.match(result.files["index.html"], /href="\.\/about\/index\.html"/);
  assert.match(result.files["about/index.html"], /href="\.\.\/styles\/site\.css"/);
  assert.equal(result.files["src/App.tsx"], undefined);
});

test("standalone HTML keeps explicit URL queries independent of page-variant queries", () => {
  const doc = fixture();
  const about = { ...doc.pages.home, id: "about", slug: "about", query: "lang=ja", children: [] };
  doc.pages.about = about;
  doc.pages.english = { ...about, id: "english", query: "lang=en" };
  doc.pageOrder.push("about", "english");
  doc.nodes.hero.link = { kind: "url", url: "/about/?lang=en&view=list#section" };
  doc.nodes.nav = { ...makeBox(), id: "nav", link: { kind: "page", pageId: "about" } };
  doc.pages.home.children.push("nav");
  const html = generateExportProject(doc, "html").files["index.html"];
  assert.ok(html.includes('href="./about/index.html?lang=en&amp;view=list#section"'));
  assert.ok(html.includes('href="./about/index.html?lang=ja"'));
});

test("relative links from a nested static page resolve from its editor URL", () => {
  const doc = fixture();
  doc.pages.home.slug = "guide/start";
  doc.pages.contact = { ...doc.pages.home, id: "contact", slug: "guide/連絡", children: [] };
  doc.pageOrder.push("contact");
  doc.nodes.hero.link = { kind: "url", url: "./連絡?view={filter}#hours" };
  const map = { ...makeBox(), id: "map", link: { kind: "url" as const, url: "./map.pdf" } };
  doc.nodes.map = map;
  doc.pages.home.children.push(map.id);
  const form = { ...makeBox(), id: "form", semantic: "form" as const, htmlAttrs: { action: "連絡", method: "post" } };
  doc.nodes.form = form;
  doc.pages.home.children.push(form.id);
  const { files } = generateExportProject(doc, "html");
  const html = files["guide/start/index.html"];
  assert.ok(files["guide/連絡/index.html"]);
  const links = [...html.matchAll(/<a\b[^>]* href="([^"]+)"/g)].map(match =>
    new URL(match[1], "file:///archive/guide/start/index.html").href);
  assert.ok(links.includes(new URL("guide/連絡/index.html?view={filter}#hours", "file:///archive/").href));
  assert.match(html, /data-live-href="[^"]*\?view=\{filter\}#hours"/);
  assert.ok(links.includes("file:///archive/guide/map.pdf"));
  assert.ok(html.includes('action="../../guide/%E9%80%A3%E7%B5%A1"'));
  for (const location of ["head", "body"]) {
    const base = '<base href="https://docs.example.test/handbook/">';
    doc.customHeadHtml = location === "head" ? base : "";
    doc.pages.home.customTopHtml = location === "body" ? base : "";
    const withBase = generateExportProject(doc, "html").files["guide/start/index.html"];
    assert.ok(withBase.includes('href="./map.pdf"'));
    assert.ok(withBase.includes('href="./連絡?view={filter}#hours"'));
  }
});

test("a URL link to the only exported page uses index.html without inheriting its query", () => {
  const doc = fixture();
  doc.pages.home.slug = "about";
  doc.pages.home.query = "lang=ja";
  doc.nodes.hero.link = { kind: "url", url: "/about#section" };
  const html = generateExportProject(doc, "html").files["index.html"];
  assert.ok(html.includes('href="./index.html#section"'));
});

test("relative media sources keep their targets when static export moves a clean URL into a directory", () => {
  const doc = fixture();
  const image = makeImage();
  image.image!.src = "./poster.svg?size=large#frame";
  const video = makeMedia("video");
  video.media!.src = "../clips/intro.mp4";
  video.media!.sources = [{ src: "clips/intro.webm", type: "video/webm" }];
  doc.nodes[image.id] = image;
  doc.nodes[video.id] = video;
  doc.pages.detail = { ...doc.pages.home, id: "detail", slug: "guide/detail", children: [image.id, video.id] };
  doc.pageOrder.push("detail");
  const path = "guide/detail/index.html";
  const root = "https://example.test/portfolio/";
  function sources() {
    return [...generateExportProject(doc, "html").files[path].matchAll(/<(?:img|video|source)\b[^>]*? src="([^"]+)"/g)]
      .map(match => match[1]);
  }
  assert.deepEqual(sources().map(src => new URL(src, root + path).href), [
    root + "guide/poster.svg?size=large#frame", root + "clips/intro.mp4", root + "guide/clips/intro.webm",
  ]);
  doc.customHeadHtml = '<base href="https://cdn.example.test/media/">';
  assert.deepEqual(sources(), ["./poster.svg?size=large#frame", "../clips/intro.mp4", "clips/intro.webm"]);
});

test("standalone HTML treats a favicon URL as a resource even if it matches a page slug", () => {
  const doc = fixture();
  doc.favicon = { url: "/icon.svg" };
  doc.pages.icon = { ...doc.pages.home, id: "icon", slug: "icon.svg", children: [] };
  doc.pageOrder.push("icon");
  const { files } = generateExportProject(doc, "html");
  assert.ok(files["index.html"].includes('<link rel="icon" href="./icon.svg">'));
  assert.ok(files["icon.svg/index.html"].includes('<link rel="icon" href="../icon.svg">'));
});

test("HTML export keeps raw HTML routes without transpiling their content", () => {
  const doc = fixture();
  doc.pages.home.rawHtml = '<!doctype html><html><head><title>Raw</title></head><body><main id="raw-html">Raw body</main></body></html>';
  const result = generateExportProject(doc, "html");
  assert.match(result.files["index.html"], /id="raw-html"/);
  assert.doesNotMatch(result.files["index.html"], /react-dom|__next/);
});

test("unsupported dynamic routes and reverse proxies fail explicitly", () => {
  const doc = fixture();
  doc.pages.home.slug = "articles/[slug]";
  assert.ok(exportLimitations(doc, "react").some((x) => x.includes("[slug]")));
  assert.throws(() => generateExportProject(doc, "html"), /slug/);
  doc.pages.home.slug = "";
  doc.pages.home.rewriteTo = "https://example.com";
  assert.ok(exportLimitations(doc, "react").length);
  assert.throws(() => generateExportProject(doc, "react"));
});

test("client-only variables do not force a server-only export error", () => {
  const doc = fixture();
  doc.nodes.hero.text!.content = "Hello {username}";
  const react = generateExportProject(doc, "react");
  assert.match(react.files["src/pages/Page0.tsx"], /export default function Page/);
  assert.match(react.files["src/pages/Page0.tsx"], /new URLSearchParams\(window\.location\.search\)/);
  // 単独のページでも、訪問者のクエリから、クライアントの文字を更新できる。
  const html = generateExportProject(doc, "html").files["index.html"];
  assert.match(html, /data-live="Hello \{username\}"/);
});

test("React uses the same browser data loader for API calls and transformations", () => {
  const doc = fixture();
  doc.nodes.hero.text!.content = "Found {total} records";
  doc.pages.home.pageScripts = [{
    id: "load", trigger: "load",    steps: [
      { id: "fetch", kind: "fetch", url: "https://example.com/data.json?tab={tab}", as: "results" },
      { id: "count", kind: "count", array: "results", into: "total" },
    ],
  }];
  assert.deepEqual(exportLimitations(doc, "react"), []);
  const project = generateExportProject(doc, "react");
  assert.ok(project.files["public/data-loader.js"].includes("fetch(url, init)"));
  assert.ok(project.files["public/scripts.js"].includes("__pageDataReady"));
  assert.match(project.files["src/pages/Page0.tsx"], /data-page-plan/);
  assert.match(project.files["src/pages/Page0.tsx"], /data-live/);
  assert.match(project.files["src/pages/Page0.tsx"], /Found .* records/);
  assert.match(project.files["src/App.tsx"], /data-loader\.js/);
  assert.doesNotMatch(project.files["src/pages/Page0.tsx"], /fetchPublic|next\/navigation/);
});

test("React preserves list-display operations even without a fetch", () => {
  const doc = fixture();
  doc.pages.home.pageScripts = [{
    id: "filter-on-load", trigger: "load",    steps: [{ id: "filter", kind: "list-display", mode: "filter",
      array: "products", field: "status", op: "eq",
      value: "published", dir: "asc" }],
  }] as unknown as typeof doc.pages.home.pageScripts;
  const output = generateExportProject(doc, "react");
  assert.ok(output.files["public/data-loader.js"]);
  assert.ok(output.files["src/pages/Page0.tsx"].includes("data-page-plan"));
  assert.ok(output.files["src/pages/Page0.tsx"].includes("filter"));
});

test("React JSX adaptation removes only framework-specific JSX wrappers", () => {
  const source = 'import type { Metadata } from "next";\n' +
    'import Link from "next/link";\nimport Image from "next/image";\n' +
    'export const metadata: Metadata = {\n  title: "X",\n};\n' +
    'export default function Page() { return <><Link href="/a">A</Link><Image src="/x" alt="X" width={10} height={10} /></>; }';
  const result = reactSource(source);
  assert.match(result, /<a href/);
  assert.match(result, /<img src/);
  assert.doesNotMatch(result, /next\/|export const metadata/);
  assert.throws(() => reactSource('import { notFound } from "next/navigation";'));
});


test("React export preserves query-variant routing", () => {
  const doc = fixture();
  doc.pages.tab = { ...doc.pages.home, id: "tab", name: "Tab", title: "Tab", query: "tab=2" };
  doc.pageOrder.push("tab");
  const result = generateExportProject(doc, "react");
  assert.match(result.files["src/App.tsx"], /Object\.fromEntries\(\[\["tab","2"\]\]\)/);
  assert.match(result.files["src/App.tsx"], /matches\.sort/);
  assert.ok(result.files["src/pages/Page1.tsx"]);
});

test("HTML supports query-based page variants without a server rewrite", () => {
  const doc = fixture();
  doc.nodes.hero.text!.content = "Default";
  doc.pages.other = {
    ...doc.pages.home, id: "other", title: "Other", query: "tab=2",
    children: ["other-text"],
  };
  doc.nodes["other-text"] = {
    ...makeBox(), id: "other-text", text: { content: "Second tab", heading: 1 },
  };
  doc.pageOrder.push("other");
  doc.pages.home.noindex = true;
  doc.nodes.hero.link = { kind: "page", pageId: "other" };
  assert.deepEqual(exportLimitations(doc, "html"), []);
  const html = generateExportProject(doc, "html");
  assert.ok(html.files["query-router.js"]);
  assert.match(html.files["index.html"], /data-page-variants/);
  assert.match(html.files["index.html"], /query-router\.js/);
  assert.match(html.files["index.html"], /index\.html\?tab=2/);
  assert.match(html.files["index.html"], /Second tab/);
  assert.doesNotMatch(html.files["index.html"].split("</head>")[0], /name="robots"/);
  doc.pages.other.noindex = true;
  assert.match(generateExportProject(doc, "html").files["index.html"].split("</head>")[0], /name="robots" content="noindex,nofollow"/);
  assert.equal(Object.keys(html.files).filter((name) => name.endsWith("index.html")).length, 1);
});

test("HTML accepts ordinary query variables even without separate page variants", () => {
  const doc = fixture();
  doc.pages.home.query = "tab=default";
  doc.nodes.hero.text!.content = "Tab {tab}";
  assert.deepEqual(exportLimitations(doc, "html"), []);
  assert.match(generateExportProject(doc, "html").files["index.html"], /data-live="Tab \{tab\}"/);
});

test("React export includes native forms and PWA manifest", () => {
  const doc = fixture();
  const form = { ...makeBox(), id: "search", semantic: "form" as const, children: ["hero"] };
  doc.nodes.search = form;
  doc.pages.home.children = ["search"];
  doc.pwa = { enabled: true };
  const result = generateExportProject(doc, "react");
  assert.match(result.files["src/components/SearchForm.tsx"], /window\.location\.assign/);
  assert.ok(result.files["public/manifest.webmanifest"]);
  assert.match(result.files["index.html"], /manifest\.webmanifest/);
});

test("submit button IDs are independent of submission names across export formats", () => {
  const doc = fixture();
  doc.nodes.send = { ...makeBox(), id: "send", attrId: "send", type: "field", field: { kind: "submit", label: "Send" } };
  doc.nodes.save = { ...doc.nodes.send, id: "save", attrId: "save", field: { kind: "submit", label: "Save", name: "intent", submitValue: "save" } };
  doc.pages.home.children = ["send", "save"];
  for (const [format, path] of [
    ["html", "index.html"], ["nextjs", "app/page.tsx"], ["react", "src/pages/Page0.tsx"],
    ["vue", "src/pages/Page0.vue"], ["nuxt", "app/generated/pages/Page0.vue"], ["sveltekit", "src/lib/pages/Page0.svelte"],
  ] as const) {
    const markup = generateExportProject(doc, format).files[path];
    const buttons = markup.match(/<button\b[^>]*>/g) ?? [];
    assert.equal(buttons.length, 2, format);
    assert.doesNotMatch(buttons[0], /\bname=/, format);
    assert.match(buttons[1], /\bname="intent"/, format);
    assert.match(buttons[1], /\bvalue="save"/, format);
  }
});

test("export scope isolates one page or the selected node", () => {
  const doc = fixture();
  doc.pages.other = { id: "other", name: "Other", title: "Other", slug: "other", description: "", children: [] };
  doc.pageOrder.push("other");
  const opts = { framework: "react" as const, language: "typescript" as const, style: "css" as const, pageId: "home" };
  const page = generateExportProject(doc, { ...opts, scope: "page" });
  assert.doesNotMatch(page.files["src/App.tsx"], /"\/other"/);
  const component = generateExportProject(doc, { ...opts, scope: "component", nodeId: "hero" });
  assert.match(component.files["src/pages/Page0.tsx"], /Hello/);
  assert.ok(exportLimitations(doc, { ...opts, scope: "component" }).length > 0);
});

test("CSS Modules and Tailwind retain Tsumu's authored CSS", () => {
  const doc = fixture();
  const options = { framework: "react" as const, language: "typescript" as const, scope: "project" as const };
  const modules = generateExportProject(doc, { ...options, style: "css-modules" });
  assert.match(modules.files["src/App.tsx"], /siteStyles\.siteRoot/);
  assert.ok(modules.files["src/site.module.css"]);
  assert.ok(modules.files["src/site-global.css"]);
  const tailwind = generateExportProject(doc, { ...options, style: "tailwind" });
  assert.match(tailwind.files["src/globals.css"], /tailwindcss\/utilities\.css/);
  assert.match(tailwind.files["package.json"], /@tailwindcss\/vite/);
  assert.ok(tailwind.files["src/site.css"]);
});

test("JavaScript option produces actual JS and JSX files", async () => {
  const { toJavaScriptProject } = await import("../lib/generator/javascript-export");
  const output = await toJavaScriptProject(generateExportProject(fixture(), "react"), "react");
  assert.ok(output.files["src/App.jsx"]);
  assert.ok(output.files["src/main.jsx"]);
  assert.equal(output.files["src/main.tsx"], undefined);
  assert.ok(output.files["index.html"].includes("src/main.jsx"));
  assert.ok(!output.files["index.html"].includes("src/main.tsx"));
  assert.ok(output.files["vite.config.js"]);
  assert.equal(output.files["src/App.tsx"], undefined);
  assert.ok(output.files["jsconfig.json"]);
  assert.doesNotMatch(output.files["src/App.jsx"], /type Route =/);
  assert.match(output.files["package.json"], /"build": "vite build"/);
});

test("nested HTML exports rewrite real resource URLs without changing scripts, comments, or attribute text", () => {
  const doc = fixture();
  doc.pages.details = {
    ...doc.pages.home, id: "details", slug: "guide/details",
    children: [], customTopHtml: [
      "<script>window.template = 'src=\"/literal\" url(/literal)';</script>",
      '<script src="/scripts/app.js"></script>',
      '<!-- <img src="/comment.svg"> -->',
      '<textarea>href="/textarea.txt"</textarea>',
      '<style>.background { background-image: url(/assets/paint.svg); }</style>',
      '<style>@import "/assets/theme.css"; /* url(/comment) */ .literal { content: "url(/literal)"; }</style>',
      "<div data-example='src=\"/untouched\"' style='background:url(/assets/paint.svg)'>",
      '<img src="/assets/photo.png">',
      "</div>",
    ].join("\n"),
  };
  doc.pageOrder.push("details");
  doc.customHeadHtml =
    '<script>window.headLiteral = \'href="/head-literal"\';</script>' +
    '<link rel="preload" href="/assets/font.woff2">';

  const html = generateExportProject(doc, "html").files["guide/details/index.html"];
  assert.ok(html);
  assert.match(html, /window\.template = 'src="\/literal" url\(\/literal\)'/);
  assert.match(html, /window\.headLiteral = 'href="\/head-literal"'/);
  assert.match(html, /<script src="\.\.\/\.\.\/scripts\/app\.js"><\/script>/);
  assert.match(html, /<link rel="preload" href="\.\.\/\.\.\/assets\/font\.woff2">/);
  assert.match(html, /<img src="\.\.\/\.\.\/assets\/photo\.png">/);
  assert.match(html, /background-image: url\(\.\.\/\.\.\/assets\/paint\.svg\)/);
  assert.match(html, /@import "\.\.\/\.\.\/assets\/theme\.css"/);
  assert.match(html, /\/\* url\(\/comment\) \*\//);
  assert.match(html, /content: "url\(\/literal\)"/);
  assert.match(html, /style='background:url\(\.\.\/\.\.\/assets\/paint\.svg\)'/);
  assert.match(html, /data-example='src="\/untouched"'/);
  assert.match(html, /<!-- <img src="\/comment\.svg"> -->/);
  assert.match(html, /<textarea>href="\/textarea\.txt"<\/textarea>/);
});

test("generated Next.js projects include the editor's security overrides for shared build tooling", async () => {
  const { readFile } = await import("node:fs/promises");
  const root = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const generated = JSON.parse(generateExportProject(fixture(), "nextjs").files["package.json"]);
  assert.ok(root.overrides.glob);
  assert.equal(generated.overrides.glob, root.overrides.glob);
  assert.equal(generated.overrides.next.postcss, root.overrides.next.postcss);
});

test("scoped files are selected by local URLs, CSS tokens and JavaScript literals", () => {
  const doc = fixture();
  for (const id of ["html", "css", "js", "snippet"]) doc.assets[id] = {
    id, name: id + ".png", mimeType: "image/png", width: 1, height: 1, dataUrl: "data:image/png;base64,AQID",
  };
  doc.pages.home.customEndHtml = '<img src="../assets/html.png?v=1">' +
    '<style>.x{background:url("./assets/css.png#mark");content:"url(/assets/snippet.png)"}</style>' +
    '<script>/* "/assets/snippet.png" */ const image="/assets/js.png";</script>';
  const options = { framework: "html", scope: "page", pageId: "home", style: "css", language: "javascript" } as const;
  assert.deepEqual(Object.keys(generateExportProject(doc, options).binaries).sort(),
    ["assets/css.png", "assets/html.png", "assets/js.png"]);
  doc.customHeadHtml = '<base href="https://outside.example/">';
  assert.deepEqual(Object.keys(generateExportProject(doc, options).binaries), []);
});

test("HTML export hydrates data-live-src, data-live-href, option data-live, and client-list field templates safely", async () => {
  const { listRuntimeDom } = await import("./helpers/list-runtime-dom");
  const doc = fixture();
  doc.nodes.liveImg = {
    ...makeBox(), id: "liveImg", attrId: "liveImg", type: "image",
    image: { src: "{avatar}", alt: "Avatar", width: 40, height: 40 },
  };
  doc.nodes.liveLink = {
    ...makeBox(), id: "liveLink", attrId: "liveLink",
    text: { content: "Visit", heading: 0 },
    link: { kind: "url", url: "{dest}" },
  };
  doc.nodes.liveSelect = {
    ...makeBox(), id: "liveSelect", attrId: "liveSelect", type: "field",
    field: { kind: "select", options: [{ label: "Pick {label}", value: "a" }] },
  };
  doc.nodes.rowInput = {
    ...makeBox(), id: "rowInput", attrId: "rowInput", type: "field",
    field: { kind: "input", inputType: "text", placeholder: "Hint {hint}", defaultValue: "{val}" },
  };
  doc.nodes.rowLink = {
    ...makeBox(), id: "rowLink", attrId: "rowLink",
    text: { content: "Item", heading: 0 },
    link: { kind: "url", url: "{url}" },
  };
  doc.nodes.clientList = {
    ...makeBox(), id: "clientList", type: "list",
    list: { from: "rows" },
    children: ["rowInput", "rowLink"],
  };
  doc.nodes.applyBtn = {
    ...makeBox(), id: "applyBtn", attrId: "applyBtn", semantic: "button",
    text: { content: "Apply", heading: 0 },
    scripts: [{
      id: "sc_apply", trigger: "click",
      steps: [
        { id: "s1", kind: "set-var", into: "avatar", value: "https://example.com/u.png" },
        { id: "s2", kind: "set-var", into: "dest", value: "https://example.com/go" },
        { id: "s3", kind: "set-var", into: "label", value: "Alpha" },
        { id: "s4", kind: "set-var", into: "rows", value: '[{"hint":"Name","val":"Alice","url":"https://example.com/alice"},{"hint":"Bad","val":"Eve","url":"javascript:alert(1)"}]' },
      ],
    }],
  };
  doc.nodes.blockBtn = {
    ...makeBox(), id: "blockBtn", attrId: "blockBtn", semantic: "button",
    text: { content: "Block", heading: 0 },
    scripts: [{
      id: "sc_block", trigger: "click",
      steps: [
        { id: "b1", kind: "set-var", into: "avatar", value: "javascript:alert(1)" },
        { id: "b2", kind: "set-var", into: "dest", value: "https:\\\\evil.example" },
      ],
    }],
  };
  doc.pages.home.children = ["liveImg", "liveLink", "liveSelect", "clientList", "applyBtn", "blockBtn"];

  const out = generateExportProject(doc, "html");
  const html = out.files["index.html"];
  assert.doesNotMatch(html, /data-static-(?:src|href|option)/);
  assert.match(html, /data-live-src="\{_\d+\}"/);
  assert.match(html, /data-live-href="\{_\d+\}"/);
  assert.match(html, /<option value="a"[^>]* data-live="Pick \{_\d+\}">/);
  assert.match(html, /data-field-placeholder-parts=/);
  assert.match(html, /data-field-value-parts=/);
  assert.match(html, /data-href-parts=/);

  const dom = listRuntimeDom(html, out.files["scripts.js"], {
    window: { __pageDataReady: Promise.resolve({}) },
    location: { search: "", href: "https://example.com/" },
  });
  await new Promise((r) => setImmediate(r));
  await dom.click("applyBtn");
  assert.equal(dom.active("#liveImg")[0].getAttribute("src"), "https://example.com/u.png");
  assert.equal(dom.active("#liveLink")[0].getAttribute("href"), "https://example.com/go");
  assert.equal(dom.active("#liveSelect")[0].options[0].textContent, "Pick Alpha");
  assert.equal(dom.active("#rowInput")[0].placeholder, "Hint Name");
  assert.equal(dom.active("#rowInput")[0].value, "Alice");
  assert.equal(dom.active("#rowLink")[0].getAttribute("href"), "https://example.com/alice");
  assert.equal(dom.active("#rowLink")[1].getAttribute("href"), "javascript%3Aalert(1)");

  await dom.click("blockBtn");
  assert.match(dom.active("#liveImg")[0].getAttribute("src") ?? "", /^data:image\/gif;base64,/);
  assert.equal(dom.active("#liveLink")[0].getAttribute("href"), "#");
});
});

describe("export-response-lifecycle", () => {
async function withoutCleanupWait<T>(work: Promise<T>, timeout = 500): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("operation waited for unread response sibling")), timeout);
      }),
    ]);
  } finally { clearTimeout(timer); }
}

function clonedResponse(t: TestContext, init?: ResponseInit, body: BodyInit = '{"value":"too large"}') {
  const original = new Response(body, init);
  const response = original.clone();
  t.after(() => { void original.body?.cancel().catch(() => {}); });
  return response;
}

for (const [name, read, error] of [
  ["history restore", readRestoreJson, /編集データが大きすぎます/],
  ["asset export", readResponseBytes, /Resource exceeds export size limit/],
] as const) {
  for (const declared of [false, true]) {
    test(`${name} rejects ${declared ? "declared" : "streamed"} oversize without waiting for an unread cloned body`, async (t) => {
      const response = clonedResponse(t, { headers: declared ? { "Content-Length": "100" } : {} });
      await assert.rejects(withoutCleanupWait(read(response, 4)), error);
      assert.equal(response.bodyUsed, true, "rejected response starts cleanup");
      assert.equal(response.body!.locked, false);
    });
  }
}

test("single HTML rejects a failed resource without waiting for its cloned body", async (t) => {
  const response = clonedResponse(t, { status: 404 });
  const source = {
    files: { "index.html": '<img src="https://cdn.example.test/missing.png">' },
    binaries: {}, remoteAssets: {},
  };
  await assert.rejects(withoutCleanupWait(toSingleHtmlProject(source, async () => response)), /resource \(404\)/);
  assert.equal(response.bodyUsed, true);
});

test("partial export rejects a failed imported module without waiting for its cloned body", async (t) => {
  const response = clonedResponse(t, { status: 404 });
  t.mock.method(globalThis, "fetch", async () => response);
  const asset: Asset = {
    id: "module", name: "main.js", width: 0, height: 0,
    mimeType: "text/javascript", dataUrl: "data:text/javascript,export{}",
    zip: { version: 1, group: "zip_test", path: "main.js" },
  };
  const scoped: SiteDoc = { siteName: "Test", pages: {}, pageOrder: [], nodes: {}, assets: { module: asset } };
  await assert.rejects(withoutCleanupWait(retainImportedDependencies(scoped, scoped.assets)), /Could not read the imported module/);
  assert.equal(response.bodyUsed, true);
});

test("asset retry proceeds while a failed response's cloned body remains unread", async (t) => {
  const response = clonedResponse(t, { status: 503 });
  const recovered = new Response("asset contents");
  let attempts = 0;
  t.mock.method(globalThis, "fetch", async () => ++attempts === 1 ? response : recovered);
  assert.equal(await withoutCleanupWait(fetchWithRetry("https://cdn.example.test/asset", 2), 1500), recovered);
  assert.equal(attempts, 2);
  assert.equal(response.bodyUsed, true);
});

for (const runtime of ["browser", "native SSR"] as const) {
  for (const failure of ["HTTP error", "declared size", "streamed size"] as const) {
    test(`generated ${runtime} data loading settles after ${failure} with an unread cloned body`, async (t) => {
      const maxBytes = 5 * 1024 * 1024;
      const response = clonedResponse(t, {
        status: failure === "HTTP error" ? 404 : 200,
        headers: failure === "declared size" ? { "Content-Length": String(maxBytes + 1) } : {},
      }, failure === "streamed size" ? new Uint8Array(maxBytes + 1) : "{}");
      const plan = { steps: [{ id: "fetch", kind: "fetch", url: "https://data.example.test/items", as: "rows" }] };
      let result: Promise<Record<string, unknown>>;
      if (runtime === "browser") {
        const window: { __pageDataReady?: Promise<Record<string, unknown>> } = {};
        vm.runInNewContext(PAGE_DATA_RUNTIME, {
          window, location: { search: "" }, URLSearchParams, TextDecoder, TextEncoder,
          document: { querySelector: () => ({ textContent: JSON.stringify(plan) }) },
          fetch: async () => response, console: { warn() {} },
        }, { timeout: 1000 });
        assert.ok(window.__pageDataReady);
        result = window.__pageDataReady;
      } else {
        t.mock.method(console, "warn", () => {});
        const source = "data:text/javascript;base64," + Buffer.from(nativeDataModule()).toString("base64");
        const module = await import(source);
        result = module.loadPageData(plan, "", async () => response);
      }
      const values = await withoutCleanupWait(result);
      assert.equal(values.rows, null);
      assert.equal(response.bodyUsed, true, "failed fetch starts cleanup");
      assert.equal(response.body!.locked, false);
    });
  }
}
});

describe("javascript-entry-rewrite", () => {
for (const [name, head] of [
  ["script literal", '<script>window.example="src/main.tsx";</script>'],
  ["comment", '<!-- <script type="module" src="/src/main.tsx"></script> -->'],
  ["other attribute", '<meta name="example" content="src/main.tsx">'],
  ["inert template", '<template><script type="module" src="/src/main.tsx"></script></template>'],
  ["earlier authored module", '<script type="module" src="/src/main.tsx" data-authored="yes"></script>'],
] as const) {
  test(`React JavaScript entry rewrite preserves ${name}`, async () => {
    const source = generateExportProject({
      siteName: "Export", customHeadHtml: head,
      pages: { home: { id: "home", name: "Home", slug: "", title: "Home", description: "", children: [] } },
      pageOrder: ["home"], nodes: {}, assets: {},
    }, "react");
    const output = await toJavaScriptProject(source, "react");
    const entry = '<script type="module" src="/src/main.tsx"></script>';
    const index = source.files["index.html"].lastIndexOf(entry);
    assert.ok(index >= 0);
    const expected = source.files["index.html"].slice(0, index) + entry.replace("main.tsx", "main.jsx") + source.files["index.html"].slice(index + entry.length);
    assert.equal(output.files["index.html"], name === "earlier authored module"
      ? expected.replace('src="/src/main.tsx" data-authored="yes"', 'src="/src/main.jsx" data-authored="yes"') : expected);
    assert.ok(output.files["src/main.jsx"]);
    assert.equal(output.files["src/main.tsx"], undefined);
  });
}

for (const src of [
  "./src/main.tsx",
  "src/main.tsx",
  "/src/main.tsx?v=1&amp;mode=preview#boot",
  "./src/main.tsx?v=1#boot",
  "src/main.tsx#boot",
  "src/main.tsx?next=/src/main.tsx#boot",
  "./src/main.tsx?literal=&quot;&amp;mode=1#boot",
]) {
  test(`React JavaScript export follows the renamed entry for ${src}`, async () => {
    const { parse } = await import("parse5");
    const output = await prepareExportProject({
      siteName: "Export", customHeadHtml: `<script type="module" src="${src}" data-authored="yes"></script>`,
      pages: { home: { id: "home", name: "Home", slug: "", title: "Home", description: "", children: [] } },
      pageOrder: ["home"], nodes: {}, assets: {},
    }, { framework: "react", language: "javascript", style: "css", scope: "project" });
    assert.ok(output.files["src/main.jsx"]);
    assert.equal(output.files["src/main.tsx"], undefined);
    assert.ok(output.files["index.html"].includes(`src="${src.replace(/\.tsx(?=[?#]|$)/, ".jsx")}" data-authored="yes"`));
    // 実際に HTML を解析した後も、モジュールが存在する生成したファイルを参照することを確かめる。
    const pending: Html.Node[] = [parse(output.files["index.html"])];
    while (pending.length) {
      const node = pending.pop()!;
      if ("tagName" in node && node.tagName === "script") {
        const source = node.attrs.find(attr => attr.name === "src")?.value;
        if (source) {
          const url = new URL(source, "https://export.invalid/index.html");
          assert.ok(output.files[url.pathname.slice(1)], `Missing module: ${source}`);
        }
      }
      if ("childNodes" in node) pending.push(...node.childNodes);
    }
  });
}

for (const src of [
  "https://cdn.example/src/main.tsx?v=1#boot",
  "//cdn.example/src/main.tsx",
  "/other/src/main.tsx",
  "./src/main.tsx.map",
  "./src/main.tsx/other",
  "./other.js?entry=/src/main.tsx",
]) {
  test(`React JavaScript entry rewrite preserves unrelated URL ${src}`, async () => {
    const head = `<script type="module" src="${src}" data-authored="yes"></script>`;
    const source = generateExportProject({
      siteName: "Export", customHeadHtml: head,
      pages: { home: { id: "home", name: "Home", slug: "", title: "Home", description: "", children: [] } },
      pageOrder: ["home"], nodes: {}, assets: {},
    }, "react");
    const output = await toJavaScriptProject(source, "react");
    assert.ok(output.files["index.html"].includes(head));
    assert.ok(output.files["index.html"].includes('src="/src/main.jsx"'));
  });
}

for (const href of ["/", "/nested/", "https://cdn.example/app/"]) {
  test(`React JavaScript entry rewrite preserves local Vite input paths with base ${href}`, async () => {
    const base = `<base href="${href}">`;
    const external = '<script type="module" src="https://cdn.example/src/main.tsx"></script>';
    const source = generateExportProject({
      siteName: "Export", customHeadHtml: base + external +
        '<script type="module" src="./src/main.tsx?v=1#boot" data-authored="yes"></script>',
      pages: { home: { id: "home", name: "Home", slug: "", title: "Home", description: "", children: [] } },
      pageOrder: ["home"], nodes: {}, assets: {},
    }, "react");
    const output = await toJavaScriptProject(source, "react");
    // Vite の入力は、base ではなく index.html が基準。相対パスを、ルートからの相対パスに変えない。
    assert.ok(output.files["index.html"].includes(base + external));
    assert.ok(output.files["index.html"].includes('src="./src/main.jsx?v=1#boot" data-authored="yes"'));
    assert.ok(output.files["index.html"].includes('src="/src/main.jsx"'));
  });
}

for (const src of ["/src/main.tsx", "./src/main.tsx", "src/main.tsx?v=1#boot"]) {
  test(`React JavaScript entry rewrite preserves browser-resolved vite-ignore URL ${src}`, async () => {
    const head = '<base href="https://cdn.example/app/">' +
      `<script type="module" vite-ignore src="${src}"></script>`;
    const source = generateExportProject({
      siteName: "Export", customHeadHtml: head,
      pages: { home: { id: "home", name: "Home", slug: "", title: "Home", description: "", children: [] } },
      pageOrder: ["home"], nodes: {}, assets: {},
    }, "react");
    const output = await toJavaScriptProject(source, "react");
    assert.ok(output.files["index.html"].includes(head));
    assert.ok(output.files["index.html"].includes('src="/src/main.jsx"'));
  });
}
});

describe("more-export-formats", () => {
const fixture = (): SiteDoc => ({
  siteName: "Example site",
  pageOrder: ["home"],
  pages: {
    home: {
      id: "home", name: "Home", slug: "", title: "Home", description: "Description",
      children: ["heading"],
    },
  },
  nodes: {
    heading: { ...makeBox(), id: "heading", text: { content: "Example heading", heading: 1 } },
  },
  assets: {},
});

test("HTML export retains imported classes and safe attributes without importing event handlers", () => {
  const doc = fixture();
  doc.nodes.heading.htmlClass = "external-heading";
  doc.nodes.heading.htmlAttrs = {
    "data-source": "imported",
    "aria-label": "Imported heading",
    "title": "Original {literal}",
    "tabIndex": "3",
    "onmouseover": "alert(1)",
    "data-tsumu-scripts": "untrusted",
  };
  const html = generateExportProject(doc, "html").files["index.html"];
  assert.match(html, /class="[^"]*external-heading/);
  assert.match(html, /data-source="imported"/);
  assert.match(html, /aria-label="Imported heading"/);
  assert.match(html, /title="Original \{literal\}"/);
  assert.match(html, /tabindex="3"/);
  assert.doesNotMatch(html, /onmouseover|data-tsumu-scripts/);
});

test("single HTML mode contains one index.html without build tooling", async () => {
  const result = await prepareExportProject(fixture(), "single-html");
  assert.deepEqual(Object.keys(result.files), ["index.html"]);
  assert.deepEqual(result.binaries, {});
  assert.deepEqual(result.remoteAssets, {});
  assert.match(result.files["index.html"], /Example heading/);
  assert.match(result.files["index.html"], /<style>/);
  assert.match(result.files["index.html"], /<script[^>]*src="data:text\/javascript;charset=utf-8;base64,/i);
  assert.doesNotMatch(result.files["index.html"], /<script[^>]*\bsrc=["'](?!data:)/);
  assert.doesNotMatch(result.files["index.html"], /<link[^>]*rel="stylesheet"/);
  assert.doesNotMatch(result.files["index.html"], /tsumu/i);
});

test("single HTML preserves head noscript markup and only embeds its real resources", async () => {
  const comment = '<!-- example: <link rel="stylesheet" href="comment.css"> -->';
  const meta = '<meta name="description" content="Example &amp; reference">';
  const cssText = 'content:"url(example.svg)"';
  const script = '<script>const example = \'<noscript><img src="quoted.png"></noscript>\';</script>';
  // The first tag belongs to the implicit head and starts at source offset zero.
  const html = '<noscript>' + comment + meta + '<style>.tip{background:url(pic.svg)}.tip::after{' + cssText + '}</style>' +
    '<link rel="stylesheet" href="fallback.css"></noscript>' + script;
  const { files } = await toSingleHtmlProject({
    files: { "index.html": html, "fallback.css": "p{color:navy}", "pic.svg": '<svg xmlns="http://www.w3.org/2000/svg"/>' },
    binaries: {}, remoteAssets: {},
  });
  const output = files["index.html"];
  for (const literal of [comment, meta, cssText, script]) assert.ok(output.includes(literal));
  const doc = parse(output, { scriptingEnabled: false });
  const element = (parent: Html.ParentNode, tag: string) => parent.childNodes.find(
    (node): node is Html.Element => "tagName" in node && node.tagName === tag)!;
  const noscript = element(element(element(doc, "html"), "head"), "noscript");
  assert.deepEqual(noscript.childNodes.filter(node => "tagName" in node).map(node => node.tagName), ["meta", "style", "link"]);
  assert.match(element(noscript, "link").attrs.find(a => a.name === "href")!.value, /^data:text\/css;/);
  assert.match(output, /background:url\(data:image\/svg\+xml;base64,/);
});

test("single HTML reuses a preloaded font in the stylesheet", async () => {
  const calls: string[] = [];
  const font = "https://fonts.example.test/site.woff2";
  const project = await toSingleHtmlProject({
    files: {
      "index.html": '<link rel="preload" as="font" type="font/woff2" crossorigin href="' + font + '">' +
        '<link rel="stylesheet" href="css/type.css">',
      "css/type.css": '@font-face {font-family: Site;src:url("' + font + '") format("woff2")}',
    }, binaries: {}, remoteAssets: {},
  }, async url => {
    calls.push(url);
    return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "font/woff2" } });
  });
  assert.deepEqual(calls, [font]);
  const html = project.files["index.html"];
  assert.match(html, /as="font"[^>]*crossorigin[^>]*href="data:font\/woff2;base64,AQID"/);
  assert.match(html, /src:url\("data:font\/woff2;base64,AQID"\)/);
});

test("single HTML inlines local media, CSS backgrounds and script source", async () => {
  const file = await toSingleHtmlProject({
    files: {
      "index.html": [
        '<!doctype html><html><head><link rel="stylesheet" href="./styles/site.css"></head>',
        '<body><img src="./assets/logo.png"><script defer src="./main.js"></script></body></html>',
      ].join(""),
      "styles/site.css": '.logo { background-image: url("../assets/logo.png"); }',
      "main.js": "window.scriptIsInline = true;",
    },
    binaries: { "assets/logo.png": "iVBORw0KGgo=" },
    remoteAssets: {},
  });
  const html = file.files["index.html"];
  assert.deepEqual(Object.keys(file.files), ["index.html"]);
  assert.ok((html.match(/data:image\/png;base64,/g) || []).length >= 2);
  assert.match(html, /<style>/);
  const script = html.match(/<script[^>]*src="data:text\/javascript;charset=utf-8;base64,([^"]+)"/);
  assert.ok(script);
  assert.equal(atob(script[1]), "window.scriptIsInline = true;");
  assert.doesNotMatch(html, /src="\.\/assets\/logo.png"|href="\.\/styles\/site.css"|src="\.\/main.js"/);
});

test("single HTML inlines fetched remote stored assets without leaking their source IDs", async () => {
  const requests: string[] = [];
  const result = await toSingleHtmlProject({
    files: {
      "index.html": '<!doctype html><html><head></head><body><img src="./assets/photo.webp"></body></html>',
    },
    binaries: {},
    remoteAssets: { "assets/photo.webp": "assets/internal-key" },
  }, async (url) => {
    requests.push(url);
    return new Response(Uint8Array.from([1, 2, 3]), {
      status: 200, headers: { "Content-Type": "image/webp" },
    });
  });
  assert.deepEqual(requests, ["/api/assets/file?path=assets%2Finternal-key"]);
  assert.match(result.files["index.html"], /data:image\/webp;base64,AQID/);
  assert.doesNotMatch(result.files["index.html"], /internal-key/);
  assert.equal(Object.keys(result.files).length, 1);
});

test("single HTML cancels oversized asset streams even when Content-Length is absent", async () => {
  let pulls = 0;
  let cancellations = 0;
  const response = new Response(new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls++;
      controller.enqueue(new Uint8Array(8 * 1024 * 1024));
    },
    cancel() { cancellations++; },
  }), { status: 200, headers: { "Content-Type": "image/png" } });
  await assert.rejects(
    toSingleHtmlProject({
      files: { "index.html": '<html><body><img src="./assets/large.png"></body></html>' },
      binaries: {}, remoteAssets: { "assets/large.png": "assets/remote-id" },
    }, async () => response),
    /Resource exceeds single HTML size limit/,
  );
  assert.equal(cancellations, 1, "the excessive stream must be cancelled");
  assert.ok(pulls <= 9, "the remote resource must not be buffered completely");
});

test("single HTML checks a declared oversized asset before reading it", async () => {
  let reads = 0;
  const response = new Response(new ReadableStream<Uint8Array>({
    pull() { reads++; },
  }), { headers: { "Content-Length": String(49 * 1024 * 1024) } });
  await assert.rejects(
    toSingleHtmlProject({
      files: { "index.html": '<html><body><img src="./assets/large.png"></body></html>' },
      binaries: {}, remoteAssets: { "assets/large.png": "assets/remote-id" },
    }, async () => response),
    /Resource exceeds single HTML size limit/,
  );
  // ストリームは Response のコンストラクターが1回だけ読み出せるが、読み切ってはいない。
  assert.ok(reads <= 1);
});

test("single HTML fails explicitly rather than retaining a CORS-blocked remote image", async () => {
  await assert.rejects(
    toSingleHtmlProject({
      files: { "index.html": '<html><body><img src="https://cdn.example.test/photo.png"></body></html>' },
      binaries: {}, remoteAssets: {},
    }, async () => { throw new TypeError("CORS blocked"); }),
    /CORS|import it as a local asset/i
  );
});

test("single HTML does not silently discard pages with different fixed URLs", () => {
  const doc = fixture();
  doc.pages.about = { ...doc.pages.home, id: "about", slug: "about" };
  doc.pageOrder.push("about");
  assert.ok(exportLimitations(doc, "single-html").some((m) => m.includes("only one page")));
  assert.throws(() => generateExportProject(doc, "single-html"), /only one page/);
  const current = {
    framework: "single-html" as const, language: "javascript" as const,
    style: "css" as const, scope: "page" as const, pageId: "about",
  };
  assert.deepEqual(exportLimitations(doc, current), []);
});

for (const framework of ["vue", "nuxt", "sveltekit"] as const) {
  test(framework + " produces native build files and browser runtime without a Next.js project", () => {
    const result = generateExportProject(fixture(), framework);
    assert.ok(result.files["package.json"]);
    assert.ok(result.files["README.md"]);
    assert.equal(result.files["next.config.mjs"], undefined);
    assert.equal(result.files["app/page.tsx"], undefined);
    const root = framework === "sveltekit" ? "static" : "public";
    assert.equal(result.files[root + "/data-loader.js"], undefined);
    assert.equal(result.files[root + "/browser-start.js"], undefined);
    if (framework === "nuxt") {
      assert.equal(result.files["app/browser-start.js"], undefined);
      assert.equal(result.files["app/site-routes.js"], undefined);
    } else if (framework === "sveltekit") {
      assert.equal(result.files["src/browser-start.js"], undefined);
      assert.equal(result.files["src/site-routes.js"], undefined);
    }
    assert.match(result.files[framework === "nuxt" ? "app/generated/site-data.js" :
      framework === "vue" ? "src/site-data.js" : "src/lib/site-data.js"], /loadPageData/);
    assert.match(result.files[root + "/scripts.js"], /__pageDataReady/);
    if (framework === "vue") {
      assert.match(result.files["src/pages/Page0.vue"], /<h1/);
      assert.doesNotMatch(result.files["src/App.vue"], /v-html/);
      assert.match(result.files["vite.config.ts"], /plugin-vue/);
      assert.match(result.files["package.json"], /"vue"/);
    } else if (framework === "nuxt") {
      assert.match(result.files["app/generated/pages/Page0.vue"], /<h1/);
      assert.doesNotMatch(result.files["app/app.vue"], /v-html/);
      assert.match(result.files["nuxt.config.ts"], /ssr: true/);
      assert.match(result.files["app/pages/index.vue"], /useAsyncData/);
      assert.match(result.files["package.json"], /"nuxt"/);
    } else {
      assert.match(result.files["src/lib/pages/Page0.svelte"], /<h1/);
      assert.doesNotMatch(result.files["src/routes/+page.svelte"], /@html html/);
      assert.match(result.files["vite.config.ts"], /adapter-node/);
      assert.equal(result.files["svelte.config.js"], undefined);
      assert.match(result.files["package.json"], /"@sveltejs\/kit": "\^3/);
      assert.doesNotMatch(result.files["package.json"], /adapter-static|@sveltejs\/kit": "\^2/);
      assert.match(result.files["vite.config.ts"], /adapter-node/);
      assert.equal(result.files["src/routes/+layout.ts"].includes("ssr = true"), true);
      assert.match(result.files["src/routes/+page.server.js"], /loadPageData/);
      assert.match(result.files["package.json"], /"@sveltejs\/kit"/);
    }
    for (const [path, content] of Object.entries(result.files)) {
      if (/\.md$/i.test(path)) continue;
      assert.doesNotMatch(content, /tsumu/i, framework + " " + path);
    }
  });

  test(framework + " supports JS mode and CSS Modules and Tailwind styles", () => {
    const options = { framework, language: "javascript" as const, scope: "project" as const };
    const js = generateExportProject(fixture(), { ...options, style: "css" });
    const root = framework === "nuxt" ? "app/generated/" :
      framework === "sveltekit" ? "src/lib/" : "src/";
    assert.ok(js.files[root + "site-routes.js"]);
    assert.equal(js.files[root + "site-routes.ts"], undefined);
    const modules = generateExportProject(fixture(), { ...options, style: "css-modules" });
    assert.ok(modules.files[framework === "nuxt" ? "app/assets/site.module.css" : "src/site.module.css"]);
    const tailwind = generateExportProject(fixture(), { ...options, style: "tailwind" });
    assert.match(tailwind.files["package.json"], /tailwindcss/);
  });

  test(framework + " supports URL query parameters without a dynamic server path", async () => {
    const doc = fixture();
    doc.pages.home.query = "tab=default";
    doc.pages.variant = { ...doc.pages.home, id: "variant", title: "Variant", query: "tab=2" };
    doc.pageOrder.push("variant");
    assert.deepEqual(exportLimitations(doc, framework), []);
    const result = generateExportProject(doc, framework);
    const path = framework === "nuxt" ? "app/generated/site-routes.js" :
      framework === "sveltekit" ? "src/lib/site-routes.js" : "src/site-routes.js";
    const routes = await import("data:text/javascript;base64," + Buffer.from(result.files[path]).toString("base64"));
    assert.equal(routes.selectPage("/", "tab=2")?.id, "variant");
    assert.match(result.files[path], /URLSearchParams/);
    doc.pages.home.slug = "[slug]";
    assert.ok(exportLimitations(doc, framework).some((m) => m.includes("[slug]")));
  });
}

test("partial HTML exports retain only referenced ZIP modules and their transitive dependencies", async () => {
  const doc = fixture();
  for (const [id, path, content] of [
    ["entry", "js/entry.mjs", 'export { value } from "./sub/reexport.js"'],
    ["reexport", "js/sub/reexport.js", 'export { value } from "../value.js"'],
    ["value", "js/value.js", "export const value = 42"],
    ["private", "js/private.js", "export const unpublishedSecret = 1"],
  ]) {
    doc.assets[id] = { id, name: id + ".js", width: 0, height: 0, mimeType: "text/javascript",
      dataUrl: "data:text/javascript;base64," + Buffer.from(content).toString("base64"),
      zip: { version: 1, group: "archive", path } };
  }
  doc.pages.home.customEndHtml = '<script type="module" src="' + doc.assets.entry.dataUrl + '"></script>';
  const options = { framework: "html", scope: "page", pageId: "home", style: "css", language: "javascript" } as const;
  const html = await prepareExportProject(doc, options);
  const path = "assets/_imports/archive/js/";
  assert.ok(html.files["index.html"].includes('src="./' + path + 'entry.mjs"'));
  assert.deepEqual(Object.keys(html.binaries).filter(name => name.startsWith(path)).sort(),
    [path + "entry.mjs", path + "sub/reexport.js", path + "value.js"]);
  assert.ok(!Object.keys(html.binaries).some(name => name.includes("private")));
  assert.equal(Object.keys(doc.assets).length, 4);
  const single = await prepareExportProject(doc, { ...options, framework: "single-html" });
  assert.ok(single.files["index.html"].includes('<script type="module" src="data:text/javascript;base64,'));
});

test("partial exports read registered modules without following redirects or fetching unrelated stored assets", async () => {
  const doc = fixture();
  for (const id of ["entry", "used", "private", "ent"]) doc.assets[id] = { id, name: id + ".js", width: 0, height: 0,
    mimeType: "text/javascript", path: "assets/" + id, zip: { version: 1, group: "archive", path: id + ".js" } };
  doc.pages.home.customEndHtml = '<script type="module" src="/api/assets/file?path=assets%2Fentry"></script>';
  const original = globalThis.fetch;
  const seen: string[] = [];
  globalThis.fetch = async (input, init) => {
    assert.equal(init?.credentials, "same-origin");
    assert.equal(init?.redirect, "error");
    const path = new URL(String(input), "https://editor.test").searchParams.get("path")!;
    seen.push(path);
    assert.ok(path === "assets/entry" || path === "assets/used");
    return new Response(path === "assets/entry" ? 'import "./used.js"' : "export const value = 1",
      { headers: { "Content-Type": "text/javascript" } });
  };
  try {
    const result = await prepareExportProject(doc, {
      framework: "single-html", scope: "page", pageId: "home", style: "css", language: "javascript",
    });
    assert.ok(result.files["index.html"].includes('<script type="module" src="data:text/javascript;base64,'));
    assert.deepEqual([...new Set(seen)].sort(), ["assets/entry", "assets/used"]);
    assert.deepEqual(result.remoteAssets, {});
  } finally { globalThis.fetch = original; }
});

test("native HTML leaves raw text alone and recognizes a real module after a script-like custom element", () => {
  const doc = fixture();
  const entry = "data:text/javascript;base64,ZXhwb3J0IHt9";
  doc.assets.js = { id: "js", name: "entry.js", width: 0, height: 0, mimeType: "text/javascript", dataUrl: entry,
    zip: { version: 1, group: "g", path: "js/entry.js" } };
  const literal = '<xmp><img src="/literal.png"></xmp>';
  doc.pages.home.customEndHtml = literal + '<script-card></script-card><script type="module" src="' + entry + '"></script>';
  const html = generateExportProject(doc, "html").files["index.html"];
  assert.ok(html.includes(literal));
  assert.ok(html.includes('<script-card></script-card><script type="module" src="./assets/_imports/g/js/entry.js"></script>'));
});

test("non-Next.js exports emit icons, social preview tags, theme-color, and PWA manifest consistently", async () => {
  const doc = fixture();
  const pngDataUrl = "data:image/png;base64,iVBORw0KGgo=";
  for (const id of ["fav", "apple", "og"]) {
    doc.assets[id] = { id, name: `${id}.png`, width: 64, height: 64, mimeType: "image/png", dataUrl: pngDataUrl };
  }
  doc.favicon = { assetId: "fav" };
  doc.appleTouchIcon = { assetId: "apple" };
  doc.ogImage = { assetId: "og" };
  doc.pwa = { enabled: true, themeColor: "#112233", backgroundColor: "#ffffff" };

  const html = generateExportProject(doc, "html");
  assert.match(html.files["index.html"], /rel="icon"/);
  assert.match(html.files["index.html"], /rel="apple-touch-icon"/);
  assert.match(html.files["index.html"], /property="og:image"/);
  assert.match(html.files["index.html"], /name="twitter:card" content="summary_large_image"/);
  assert.match(html.files["index.html"], /name="theme-color" content="#112233"/);
  assert.ok(html.files["manifest.webmanifest"]);

  const single = await prepareExportProject({ ...doc, pwa: undefined }, "single-html");
  assert.match(single.files["index.html"], /rel="apple-touch-icon" href="data:image\/png;base64,/);
  assert.match(single.files["index.html"], /property="og:image"/);

  for (const framework of ["react", "vue"] as const) {
    const out = generateExportProject(doc, { framework, language: "typescript", style: "css", scope: "project" });
    assert.match(out.files["index.html"], /rel="manifest" href="\/manifest\.webmanifest"/, framework);
    assert.match(out.files["index.html"], /rel="apple-touch-icon"/, framework);
    assert.match(out.files[framework === "vue" ? "server.mjs" : "index.html"], /property="og:image"/, framework);
    assert.match(out.files["index.html"], /name="theme-color" content="#112233"/, framework);
    assert.ok(out.files["public/manifest.webmanifest"], framework);
  }

  const nuxt = generateExportProject(doc, { framework: "nuxt", language: "typescript", style: "css", scope: "project" });
  const nuxtConfig = nuxt.files["nuxt.config.ts"];
  assert.match(nuxtConfig, /manifest\.webmanifest/);
  assert.match(nuxtConfig, /apple-touch-icon/);
  assert.match(nuxtConfig, /og:image/);
  assert.match(nuxtConfig, /#112233/);
  assert.ok(nuxt.files["public/manifest.webmanifest"]);

  const svelte = generateExportProject(doc, { framework: "sveltekit", language: "typescript", style: "css", scope: "project" });
  assert.match(svelte.files["src/app.html"], /rel="manifest" href="\/manifest\.webmanifest"/);
  assert.match(svelte.files["src/app.html"], /rel="apple-touch-icon"/);
  assert.match(svelte.files["src/routes/+page.svelte"], /property="og:image"/);
  assert.match(svelte.files["src/app.html"], /name="theme-color" content="#112233"/);
  assert.ok(svelte.files["static/manifest.webmanifest"]);
});
});

describe("raw-html-assets", () => {
const { parse } = createRequire(import.meta.url)("next/dist/compiled/node-html-parser");
const asset: Asset = { id: "hero", name: "hero.svg", path: "assets/hero.svg", width: 7, height: 5, mimeType: "image/svg+xml" };
const source = assetSrc(asset);
const target = "/assets/hero.svg";
const names = new Map([[asset.id, "hero.svg"]]);
const fixture = (html: string, item = asset): SiteDoc => ({
  siteName: "HTML assets", nodes: {}, assets: { [item.id]: item }, pageOrder: ["p"],
  pages: { p: { id: "p", name: "Home", slug: "", title: "", description: "", children: [], rawHtml: html } },
});
const rewrite = (html: string) => rewriteHtmlAssetUrls(fixture(html), html, names);
const inline = (url: string, quote = "&quot;") => `<div style="background-image:url(${quote}${url}${quote})"></div>`;
const urls = (html: string) => cssAssetReferences(parse(html).querySelector("div").getAttribute("style")).map((ref) => ref.url);

test("HTML asset export preserves serialized CSS quotes without introducing a query", () => {
  for (const quote of ["&quot;", "&QUOT;", "&#34;", "&#x22;", "&#X00022;", "&apos;", "&#39;", "&#x27;"]) {
    const output = rewrite(inline(source, quote));
    assert.equal(output, inline(target, quote), quote);
    assert.deepEqual(urls(output), [target], quote);
    const set = `<div style="background-image:image-set(${quote}${source}${quote} 1x)"></div>`;
    assert.equal(rewrite(set), set.replace(source, target));
    assert.deepEqual(urls(rewrite(set)), [target]);
  }
});

test("HTML asset export leaves adjacent character references and unrelated markup intact", () => {
  for (const entity of ["&lt;", "&gt;", "&Tab;", "&NewLine;", "&#32;", "&#xA;", "&#x260;", "&#380;", "&#00034", "&#X22", "&quot", "&QUOT"]) {
    const html = `<!-- keep -->\n<div data-note='&quot;untouched&quot;' style="background:url(&quot;${source}${entity})"></div>\n<script>window.literal = '&lt;keep&gt;';</script>`;
    assert.equal(rewrite(html), html.replace(source, target), entity);
  }
});

test("HTML asset export converts real query separators and retains the remaining query and fragment bytes", () => {
  for (const separator of ["&", "&amp;", "&AMP;", "&#38;", "&#00038;", "&#x26;", "&#X0026;", "&#38", "&#x26"]) {
    const suffix = "v=1&amp;theme=dark#paint";
    assert.equal(rewrite(inline(source + separator + suffix)), inline(target + "?" + suffix), separator);
    assert.deepEqual(urls(rewrite(inline(source + separator + suffix))), [target + "?v=1&theme=dark#paint"], separator);
  }
  for (const query of ["download", "unknown;", "unknown;=1", "Quot;", "quot=1", "amp=1", "copy=1", "ampersand=1", "v=1&other=2", "amp;quot;", "#paint"]) {
    const suffix = query.startsWith("amp;") ? query.slice(4) : query;
    assert.equal(rewrite(inline(source + "&" + query)), inline(target + "?" + suffix), query);
  }
});

test("HTML asset export preserves literal quote styles, fragments, embedded assets and multiple occurrences", () => {
  for (const quote of ["", "'", "&quot;"]) {
    for (const suffix of ["", "#paint", "#paint&part"]) {
      const html = inline(source + suffix, quote);
      assert.equal(rewrite(html), inline(target + suffix, quote));
    }
  }
  const html = `<style>.hero { background: url("${source}"); }</style>\n${inline(source)}${inline(source + "&amp;v=1")}`;
  assert.equal(rewrite(html), `<style>.hero { background: url("${target}"); }</style>\n${inline(target)}${inline(target + "?v=1")}`);
  const local = { ...asset, path: undefined, dataUrl: "data:image/svg+xml;base64,PHN2Zy8+" };
  assert.equal(rewriteHtmlAssetUrls(fixture(inline(assetSrc(local)), local), inline(assetSrc(local)), names), inline(target));
});

test("HTML asset export keeps distinct proxy paths and embedded image data with a shared prefix", () => {
  const longer = { ...asset, id: "large", path: asset.path + ".preview", name: "large.svg" };
  const small = { ...asset, id: "small", path: undefined, name: "small.png", dataUrl: "data:image/png;base64,AAAA" };
  const large = { ...small, id: "big", name: "big.png", dataUrl: small.dataUrl + "BBBB" };
  const assets = [asset, longer, small, large];
  const doc = { ...fixture(""), assets: Object.fromEntries(assets.map(item => [item.id, item])) };
  const files = new Map(assets.map(item => [item.id, item.name]));
  const longSource = assetSrc(longer);
  const html = '<img src="' + longSource + '&amp;v=2#icon"><img src="' + source + '#paint">' +
    '<img src="' + source + '.unknown"><img src="' + large.dataUrl + '"><img src="' + small.dataUrl + 'DDDD">';
  assert.equal(rewriteHtmlAssetUrls(doc, html, files),
    '<img src="/assets/large.svg?v=2#icon"><img src="/assets/hero.svg#paint">' +
    '<img src="' + source + '.unknown"><img src="/assets/big.png"><img src="' + small.dataUrl + 'DDDD">');
  for (const other of ["https://cdn.example" + source, "/archive" + source, source + "&#46;backup", source + ")copy"]) {
    const original = '<img src="' + other + '">';
    assert.equal(rewriteHtmlAssetUrls(doc, original, files), original);
  }
});

test("raw-text and comment query flags keep their existing export behavior", () => {
  for (const tag of ["style", "script", "xmp", "iframe", "noembed", "noframes"]) {
    const html = `<${tag}>url("${source}&quot;");url('${source}&unknown;')</${tag}>`;
    const expected = `<${tag}>url("${target}?quot;");url('${target}?unknown;')</${tag}>`;
    assert.equal(rewrite(html), expected, tag);
  }
  assert.equal(rewrite(`<!-- ${source}&quot; -->`), `<!-- ${target}?quot; -->`);
});

test("HTML after a closed comment resumes normal attribute and query handling", () => {
  const image = `<img src="${source}&amp;v=2#icon">`;
  const exported = `<img src="${target}?v=2#icon">`;
  for (const comment of ["<!-->", "<!--->", `<!-- ${source}-->`, `<!-- ${source}--!>`]) {
    assert.equal(rewrite(comment + inline(source) + image), comment.replace(source, target) + inline(target) + exported);
  }
});

test("raw-text boundaries respect quote entities in tag attributes and RCDATA", () => {
  for (const tag of ["style", "script", "xmp", "iframe", "noembed", "noframes"]) {
    const html = `<${tag} data-example="<style> &quot;${source}&quot; >">url("${source}&quot;");url('${source}&unknown;')</${tag}>${inline(source)}`;
    const expected = `<${tag} data-example="<style> &quot;${target}&quot; >">url("${target}?quot;");url('${target}?unknown;')</${tag}>${inline(target)}`;
    assert.equal(rewrite(html), expected, tag);
  }
  assert.equal(rewrite(`<!-- ${source}&quot; -->${inline(source)}`), `<!-- ${target}?quot; -->${inline(target)}`);
  assert.equal(rewrite(`<div data-note='<style>url("${source}&quot;)</style>'></div>`), `<div data-note='<style>url("${target}&quot;)</style>'></div>`);
  for (const tag of ["title", "textarea"]) {
    assert.equal(rewrite(`<${tag}><style>&quot;${source}&quot;</style></${tag}>`), `<${tag}><style>&quot;${target}&quot;</style></${tag}>`);
  }
});

test("custom elements with raw-text tag prefixes do not consume ordinary markup", () => {
  for (const tag of ["style-card", "script-widget", "xmp-view", "iframe-panel", "noembed-card", "noframes-card", "title-card", "textarea-widget", "style:card", "script.widget"]) {
    const html = `<${tag} data-label="Keep > this">${inline(source)}</${tag}>${inline(source)}`;
    const expected = `<${tag} data-label="Keep > this">${inline(target)}</${tag}>${inline(target)}`;
    assert.equal(rewrite(html), expected, tag);
  }
  const html = `<style-card><script>window.image = "${source}&quot;";</script>${inline(source)}</style-card><style>.hero { background:url("${source}&quot;"); }</style>${inline(source)}`;
  const expected = `<style-card><script>window.image = "${target}?quot;";</script>${inline(target)}</style-card><style>.hero { background:url("${target}?quot;"); }</style>${inline(target)}`;
  assert.equal(rewrite(html), expected);
});

test("custom elements with RCDATA tag prefixes still contain real raw-text elements", () => {
  for (const tag of ["title-card", "textarea-widget"]) {
    const html = `<${tag}><style>.hero { background:url("${source}&quot;"); }</style></${tag}>${inline(source)}`;
    const expected = `<${tag}><style>.hero { background:url("${target}?quot;"); }</style></${tag}>${inline(target)}`;
    assert.equal(rewrite(html), expected, tag);
  }
});

test("generated and copied HTML routes retain usable quoted assets without changing the stored HTML", async () => {
  const html = `<!doctype html><html><head><title>Keep &amp; preserve</title></head><body>${inline(source)}</body></html>`;
  const original = fixture(html);
  const before = structuredClone(original);
  const copied = fixture("");
  copied.assets = {};
  copied.pages = {};
  copied.pageOrder = [];
  applyPagePayload(copied, buildPagePayload(original, ["p"]));
  for (const doc of [original, copied]) {
    const project = generateProject(doc);
    const routePath = "app/route.ts";
    const route = project.files[routePath];
    assert.ok(route, `missing ${routePath}`);
    const code = transformSync(route, { loader: "ts", format: "cjs" }).code;
    const mod = { exports: {} as { GET: () => Response } };
    new Function("module", "exports", code)(mod, mod.exports);
    const exported = await mod.exports.GET().text();
    assert.ok(exported.includes(inline(target)));
    assert.deepEqual(urls(exported), [target]);
    assert.equal(project.remoteAssets["public/assets/hero.svg"], asset.path);
  }
  assert.deepEqual(original, before);
});
});

describe("single-html", () => {
describe("single-html-svg-image", () => {
  for (const attribute of ["href", "xlink:href"]) {
    test(`single HTML embeds SVG image ${attribute} instead of dropping the referenced asset`, async () => {
      const project = await toSingleHtmlProject({
        files: { "index.html": `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><image ${attribute}="picture.png" width="30" height="20"/></svg>` },
        binaries: { "picture.png": "AQID" }, remoteAssets: {},
      });
      assert.match(project.files["index.html"], new RegExp(`${attribute}="data:image/png;base64,AQID"`));
      assert.match(project.files["index.html"], /width="30" height="20"\/>/);
      const tree = parse(project.files["index.html"]);
      const elements: any[] = [];
      const visit = (node: any) => { if (node.tagName === "image") elements.push(node); node.childNodes?.forEach(visit); };
      visit(tree);
      assert.equal(elements.length, 1);
      assert.equal(elements[0].namespaceURI, "http://www.w3.org/2000/svg");
      assert.deepEqual(project.binaries, {});
    });
  }

  test("SVG image fragments remain internal and ordinary hyperlinks are not downloaded", async () => {
    const html = '<svg><image href="#local"/><a href="https://example.com/"><text>link</text></a></svg>';
    const project = await toSingleHtmlProject({ files: { "index.html": html }, binaries: {}, remoteAssets: {} }, async () => {
      throw new Error("Unexpected download");
    });
    assert.equal(project.files["index.html"], html);
  });

  test("SVG href takes precedence over an unused xlink source", async () => {
    const project = await toSingleHtmlProject({
      files: { "index.html": '<svg><image href="picture.png" xlink:href="missing.png"/></svg>' },
      binaries: { "picture.png": "AQID" }, remoteAssets: {},
    });
    assert.match(project.files["index.html"], /href="data:image\/png;base64,AQID"/);
  });
});

describe("single-html-script-types", () => {
  const legacyTypes = ["text/jscript", "text/livescript", ...Array.from({ length: 6 }, (_, i) => `text/javascript1.${i}`)];
  for (const type of legacyTypes) {
    test(`single HTML embeds executable ${type} scripts`, async () => {
      const result = await toSingleHtmlProject({ files: {
        "index.html": `<script type="${type}" src="./legacy.js" defer></script>`,
        "legacy.js": "globalThis.answer = 42;",
      }, binaries: {}, remoteAssets: {} }, async () => { throw new Error("Unexpected network request"); });
      const scripts: any[] = [];
      const visit = (node: any) => { if (node.tagName === "script") scripts.push(node); node.childNodes?.forEach(visit); };
      visit(parse(result.files["index.html"]));
      const attrs = Object.fromEntries(scripts[0].attrs.map((a: any) => [a.name, a.value]));
      assert.match(attrs.src, /^data:/);
      assert.equal(attrs.type, type);
      assert.ok(Object.hasOwn(attrs, "defer"));
      const context: any = {};
      runInNewContext(Buffer.from(attrs.src.split(",")[1].split("#")[0], "base64").toString(), context);
      assert.equal(context.answer, 42);
    });
  }
  test("single HTML preserves non-executable script type data blocks without fetching", async () => {
    for (const type of ["application/json", "text/javascript; charset=utf-8", "text/javascript1.6"]) {
      const html = `<script type="${type}" src="https://example.invalid/data">data</script>`;
      const result = await toSingleHtmlProject({ files: { "index.html": html }, binaries: {}, remoteAssets: {} }, async () => { throw new Error("Unexpected network request"); });
      assert.equal(result.files["index.html"], html);
    }
  });

  for (const type of legacyTypes) {
    test(`single HTML accepts fetched script MIME ${type}`, async () => {
      const result = await toSingleHtmlProject({ files: { "index.html": '<script src="https://cdn.example/script.js"></script>' }, binaries: {}, remoteAssets: {} }, async () => new Response("globalThis.answer = 42;", { headers: { "Content-Type": type } }));
      assert.ok(result.files["index.html"].includes(`data:${type};base64,`));
    });
  }
});

describe("single-html-inline-modules", () => {
  const noRequest = async () => { throw new Error("Unexpected network request"); };
  const run = (source: string) => import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));
  test("inline modules resolve static and dynamic dependencies relative to the document base", async () => {
    const resources = singleHtmlResources({ files: {
      "dir/entry.mjs": 'import { value } from "./child.mjs"; export const n = value + 1;',
      "dir/child.mjs": "export const value = 40;",
    }, binaries: {}, remoteAssets: {} }, noRequest, false);
    const text = await resources.inlineModule('import { n } from "./entry.mjs"; export const result = n + (await import("./child.mjs")).value;', new URL("dir/page.html", EXPORT_BASE));
    assert.ok(!text.includes('"./entry.mjs"'));
    assert.ok(!text.includes('"./child.mjs"'));
    assert.equal((await run(text)).result, 81);
  });
  test("inline modules reuse cached dependencies and retain data URL imports", async () => {
    const resources = singleHtmlResources({ files: { "value.mjs": "export const n = {};" }, binaries: {}, remoteAssets: {} }, noRequest, false);
    const text = await resources.inlineModule('import { n as a } from "./value.mjs"; import { n as b } from "./value.mjs"; import { n as c } from "data:text/javascript,export const n=2"; export const result = a === b && c === 2;', EXPORT_BASE);
    assert.equal((await run(text)).result, true);
  });
  test("inline modules reject circular dependencies and non-static resolution just like external modules", async () => {
    const resources = singleHtmlResources({ files: { "a.mjs": 'import "./b.mjs";', "b.mjs": 'import "./a.mjs";' }, binaries: {}, remoteAssets: {} }, noRequest, false);
    await assert.rejects(resources.inlineModule('import "./a.mjs";', EXPORT_BASE), /circular/);
    await assert.rejects(resources.inlineModule('import(location.href);', EXPORT_BASE), /runtime resolution/);
    await assert.rejects(resources.inlineModule('console.log(import.meta.url);', EXPORT_BASE), /runtime resolution/);
  });
  test("inline scripts with no imports retain their bytes while authored import maps fail closed", async () => {
    const resources = singleHtmlResources({ files: {}, binaries: {}, remoteAssets: {} }, noRequest, true);
    const plain = 'const text = "<script>not an import</script>";';
    assert.equal(await resources.inlineModule(plain, EXPORT_BASE), plain);
    await assert.rejects(resources.inlineModule('import "./x.mjs";', EXPORT_BASE), /import map/);
  });

  test("single HTML rewrites inline module bodies and preserves surrounding markup", async () => {
    const { toSingleHtmlProject } = await import("../lib/generator/single-html");
    const { parse } = await import("parse5");
    const html = '<!doctype html><base href="/dir/"><script type="module" nonce="test">import { n } from "./entry.mjs"; export const answer = n;</script><p>After</p>';
    const project = await toSingleHtmlProject({ files: { "index.html": html, "dir/entry.mjs": "export const n = 42;" }, binaries: {}, remoteAssets: {} }, noRequest);
    const output = project.files["index.html"];
    assert.match(output, /nonce="test"/);
    assert.ok(output.endsWith("</script><p>After</p>"));
    const scripts: any[] = [];
    const visit = (node: any) => { if (node.tagName === "script") scripts.push(node); node.childNodes?.forEach(visit); };
    visit(parse(output));
    assert.equal(scripts.length, 1);
    const source = scripts[0].childNodes.map((node: any) => node.value ?? "").join("");
    assert.equal((await run(source)).answer, 42);
    assert.deepEqual(Object.keys(project.files), ["index.html"]);
  });

  test("an EOF-terminated inline module still embeds its dependencies", async () => {
    const { toSingleHtmlProject } = await import("../lib/generator/single-html");
    const prefix = '<script type="module">';
    const project = await toSingleHtmlProject({ files: { "index.html": prefix + 'import { n } from "./entry.mjs"; export const answer = n;', "entry.mjs": "export const n = 7;" }, binaries: {}, remoteAssets: {} }, noRequest);
    assert.equal((await run(project.files["index.html"].slice(prefix.length))).answer, 7);
  });
});

describe("single-html-svg-resources", () => {
  for (const attribute of ["href", "xlink:href"]) {
    test(`single HTML embeds SVG filter image ${attribute}`, async () => {
      const result = await toSingleHtmlProject({
        files: {
          "index.html": `<svg><defs><filter id="texture"><feImage ${attribute}="texture.png" result="texture" preserveAspectRatio="xMidYMid slice"/></filter></defs><rect filter="url(#texture)" width="100" height="100"/></svg>`,
        },
        binaries: { "texture.png": "AQID" }, remoteAssets: {},
      });
      assert.match(result.files["index.html"], new RegExp(`<feImage ${attribute}="data:image/png;base64,AQID"`));
      assert.match(result.files["index.html"], /result="texture" preserveAspectRatio="xMidYMid slice"\/>/);
      assert.match(result.files["index.html"], /filter="url\(#texture\)"/);
      assert.deepEqual(result.binaries, {});
    });
  }

  test("SVG filter images use the document base and fetch remote resources once", async () => {
    const seen: string[] = [];
    const result = await toSingleHtmlProject({
      files: {
        "index.html": '<base href="https://cdn.example/art/"><svg><filter id="texture"><feImage href="paper.png"/><feImage xlink:href="paper.png"/></filter></svg>',
      },
      binaries: {}, remoteAssets: {},
    }, async url => {
      seen.push(url);
      return new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "image/png" } });
    });
    assert.deepEqual(seen, ["https://cdn.example/art/paper.png"]);
    assert.equal((result.files["index.html"].match(/data:image\/png;base64,AQID/g) ?? []).length, 2);
  });

  test("SVG filter href takes precedence over unused xlink:href", async () => {
    const result = await toSingleHtmlProject({
      files: { "index.html": '<svg><filter><feImage href="texture.png" xlink:href="missing.png"/></filter></svg>' },
      binaries: { "texture.png": "AQID" }, remoteAssets: {},
    });
    assert.match(result.files["index.html"], /href="data:image\/png;base64,AQID" xlink:href="missing.png"/);
  });

  test("SVG filter internal references, existing data URLs and empty href stay unchanged", async () => {
    const html = '<svg><filter><feImage href="#local"/><feImage xlink:href="#legacy"/><feImage href="data:image/png;base64,AQID"/><feImage href="" xlink:href="missing.png"/></filter></svg>';
    const result = await toSingleHtmlProject({ files: { "index.html": html }, binaries: {}, remoteAssets: {} }, async () => {
      throw new Error("Unexpected download");
    });
    assert.equal(result.files["index.html"], html);
  });

  test("single HTML does not treat an HTML feimage lookalike as an SVG resource", async () => {
    const html = '<feimage href="missing.png"></feimage>';
    const result = await toSingleHtmlProject({ files: { "index.html": html }, binaries: {}, remoteAssets: {} });
    assert.equal(result.files["index.html"], html);
  });

  test("SVG image URLs ignore removed xml:base attributes and retain the HTML base", async () => {
    // SVG 2 では xml:base が削除されたため、HTML の文書の基準だけを使う。
    // https://www.w3.org/TR/SVG2/changes.html#struct
    const result = await toSingleHtmlProject({
      files: {
        "index.html": '<base href="./art/"><svg xml:base="https://wrong.example/"><g xml:base="nested/"><image href="picture.png"/><image xlink:href="picture.png"/></g></svg>',
      },
      binaries: { "art/picture.png": "AQID" }, remoteAssets: {},
    }, async () => { throw new Error("Unexpected download"); });
    assert.equal((result.files["index.html"].match(/data:image\/png;base64,AQID/g) ?? []).length, 2);
    assert.match(result.files["index.html"], /xml:base="https:\/\/wrong\.example\/"/);
    assert.match(result.files["index.html"], /xml:base="nested\/"/);
  });
});

describe("single-html-script-encoding", () => {
  const empty = { files: {}, binaries: {}, remoteAssets: {} };
  const scriptUrl = "https://cdn.example/legacy.js";
  const latinScript = Buffer.from('globalThis.answer = "caf\xe9 \x80";', "latin1");
  const expected = "café €";
  const response = (bytes: Uint8Array, type: string) => new Response(bytes, { headers: { "Content-Type": type } });
  const noRequest = async () => { throw new Error("Unexpected network request"); };

  function scriptAttributes(html: string): Record<string, string> {
    const scripts: any[] = [];
    const visit = (node: any) => { if (node.tagName === "script") scripts.push(node); node.childNodes?.forEach(visit); };
    visit(parse(html));
    assert.equal(scripts.length, 1);
    return Object.fromEntries(scripts[0].attrs.map((attr: any) => [attr.name, attr.value]));
  }

  async function embedded(bytes: Uint8Array, type: string, attributes = "") {
    const result = await toSingleHtmlProject({ ...empty, files: {
      "index.html": `<meta charset="utf-8"><script src="${scriptUrl}" ${attributes}></script>`,
    } }, async () => response(bytes, type));
    const attrs = scriptAttributes(result.files["index.html"]);
    const fetched = await fetch(attrs.src);
    return { attrs, bytes: new Uint8Array(await fetched.arrayBuffer()), type: fetched.headers.get("content-type")! };
  }

  // HTML の classic script のデコードの順序: BOM → 応答の charset → 要素や文書の文字コード。
  // https://html.spec.whatwg.org/multipage/webappapis.html#fetch-a-classic-script
  function execute(bytes: Uint8Array, contentType: string, fallback = "utf-8"): unknown {
    let decoder = new TextDecoder(fallback);
    const charset = /;charset=([^;]+)/i.exec(contentType)?.[1];
    if (charset) { try { decoder = new TextDecoder(charset); } catch { /* 無効なラベルはフォールバックを使う。 */ } }
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) decoder = new TextDecoder();
    if (bytes[0] === 0xff && bytes[1] === 0xfe) decoder = new TextDecoder("utf-16le");
    if (bytes[0] === 0xfe && bytes[1] === 0xff) decoder = new TextDecoder("utf-16be");
    const context: { answer?: unknown } = {};
    runInNewContext(decoder.decode(bytes), context);
    return context.answer;
  }

  for (const [type, label] of [
    ["text/javascript; charset=windows-1252", "windows-1252"],
    ['application/javascript; CHARSET = "ISO-8859-1"', "ISO-8859-1"],
    ['text/javascript; note="ignore; charset=utf-8"; charset=windows-1252', "windows-1252"],
    ['text/javascript; charset=" windows-1252 "; charset=utf-8', "windows-1252"],
    ['text/javascript; charset="windows\\-1252"', "windows-1252"],
  ]) {
    test(`classic scripts preserve HTTP charset and executable strings: ${type}`, async () => {
      const result = await embedded(latinScript, type, 'charset="utf-8" defer async');
      assert.ok(result.attrs.src.includes(`;charset=${label};base64,`));
      assert.deepEqual(result.bytes, new Uint8Array(latinScript));
      assert.equal(execute(result.bytes, result.type), expected);
      assert.equal(execute(result.bytes, "text/javascript"), "caf� �");
      assert.equal(result.attrs.charset, "utf-8");
      assert.ok(Object.hasOwn(result.attrs, "defer"));
      assert.ok(Object.hasOwn(result.attrs, "async"));
    });
  }

  test("classic scripts preserve Shift_JIS source text", async () => {
    const bytes = Buffer.concat([Buffer.from('globalThis.answer = "'), Buffer.from([0x93, 0xfa, 0x96, 0x7b, 0x8c, 0xea]), Buffer.from('";')]);
    const result = await embedded(bytes, "text/javascript; charset=Shift_JIS");
    assert.equal(execute(result.bytes, result.type), "日本語");
  });

  for (const type of ["text/javascript", "text/javascript; charset=unknown-encoding"]) {
    test(`missing or invalid HTTP charset retains the script element fallback: ${type}`, async () => {
      const result = await embedded(latinScript, type, 'charset="windows-1252"');
      assert.equal(result.attrs.charset, "windows-1252");
      assert.equal(execute(result.bytes, result.type, result.attrs.charset), expected);
    });
  }

  for (const encoding of ["utf-8", "utf-16le", "utf-16be"] as const) {
    test(`classic ${encoding} BOM still overrides the retained HTTP charset`, async () => {
      const source = `globalThis.answer = "${expected}";`;
      const bytes = encoding === "utf-8" ? Buffer.from(source) : Buffer.from(source, "utf16le");
      if (encoding === "utf-16be") bytes.swap16();
      const bom = Buffer.from(encoding === "utf-8" ? [0xef, 0xbb, 0xbf] : encoding === "utf-16le" ? [0xff, 0xfe] : [0xfe, 0xff]);
      const original = Buffer.concat([bom, bytes]);
      const result = await embedded(original, "text/javascript; charset=windows-1252");
      assert.deepEqual(result.bytes, new Uint8Array(original));
      assert.equal(execute(result.bytes, result.type), expected);
    });
  }

  test("retaining classic script encoding preserves SRI over the original bytes", async () => {
    const integrity = "sha256-" + createHash("sha256").update(latinScript).digest("base64");
    const result = await embedded(latinScript, "text/javascript; charset=windows-1252", `integrity="${integrity}" crossorigin="anonymous"`);
    assert.equal(result.attrs.integrity, integrity);
    assert.equal(result.attrs.crossorigin, "anonymous");
    assert.equal("sha256-" + createHash("sha256").update(result.bytes).digest("base64"), integrity);
    await assert.rejects(embedded(Buffer.from("different source"), "text/javascript; charset=windows-1252", `integrity="${integrity}"`), /integrity/i);
  });

  test("script and ordinary asset caches do not discard the script charset in either access order", async () => {
    for (const firstScript of [false, true]) {
      let requests = 0;
      const resources = singleHtmlResources(empty, async () => { requests++; return response(latinScript, "text/javascript; charset=windows-1252"); }, false);
      const first = await resources.embed(scriptUrl + "#first", EXPORT_BASE, "", firstScript);
      const second = await resources.embed(scriptUrl + "#second", EXPORT_BASE, "", !firstScript);
      const script = firstScript ? first : second;
      const asset = firstScript ? second : first;
      assert.match(script, /^data:text\/javascript;charset=windows-1252;base64,/);
      assert.match(asset, /^data:text\/javascript;base64,/);
      assert.ok(first.endsWith("#first"));
      assert.ok(second.endsWith("#second"));
      assert.equal(await resources.embed(scriptUrl + "#first", EXPORT_BASE, "", firstScript), first);
      assert.equal(requests, 1);
    }
  });

  test("generated script strings declare UTF-8 while raw binaries retain the element fallback", async () => {
    const text = `globalThis.answer = "${expected}";`;
    const resources = singleHtmlResources({ files: { "generated.js": text }, binaries: { "raw.js": latinScript.toString("base64") }, remoteAssets: {} }, noRequest, false);
    const generated = await resources.embed("generated.js", EXPORT_BASE, "", true);
    assert.match(generated, /^data:text\/javascript;charset=utf-8;base64,/);
    const generatedResponse = await fetch(generated);
    assert.equal(execute(new Uint8Array(await generatedResponse.arrayBuffer()), generatedResponse.headers.get("content-type")!, "windows-1252"), expected);
    const raw = await resources.embed("raw.js", EXPORT_BASE, "", true);
    assert.match(raw, /^data:text\/javascript;base64,/);
    const rawResponse = await fetch(raw);
    assert.equal(execute(new Uint8Array(await rawResponse.arrayBuffer()), rawResponse.headers.get("content-type")!, "windows-1252"), expected);
  });

  test("unusable charset values cannot inject data URL parameters or markup", async () => {
    for (const charset of ['utf-8;base64,alert(1)', 'utf-8\"><script>', 'utf 8', 'utf-8\u0001', '']) {
      const result = await embedded(Buffer.from('globalThis.answer = 42;'), `text/javascript; charset="${charset.replaceAll('"', '\\"')}"`);
      assert.match(result.attrs.src, /^data:text\/javascript;base64,/);
      assert.equal(execute(result.bytes, result.type), 42);
    }
  });

  test("non-ASCII whitespace does not turn an invalid HTTP label into a valid encoding", async () => {
    for (const charset of ['"\u00a0utf-8\u00a0"', '\u00a0utf-8\u00a0']) {
      const result = await embedded(latinScript, 'text/javascript; charset=' + charset, 'charset="windows-1252"');
      assert.match(result.attrs.src, /^data:text\/javascript;base64,/);
      assert.equal(execute(result.bytes, result.type, result.attrs.charset), expected);
    }
  });

  test("legacy labels that TextDecoder can reject remain available to the browser", async () => {
    const result = await embedded(latinScript, "text/javascript; charset=iso-2022-cn");
    assert.match(result.attrs.src, /^data:text\/javascript;charset=iso-2022-cn;base64,/);
    assert.deepEqual(result.bytes, new Uint8Array(latinScript));
  });

  test("module scripts continue to use UTF-8 regardless of an HTTP charset", async () => {
    const source = `globalThis.answer = "${expected}";`;
    const result = await embedded(Buffer.from(source), "text/javascript; charset=windows-1252", 'type="module"');
    assert.equal(result.attrs.type, "module");
    assert.match(result.attrs.src, /^data:text\/javascript;base64,/);
    assert.equal(new TextDecoder().decode(result.bytes), source);
  });
});

describe("single-html-css-encoding", () => {
  const empty = { files: {}, binaries: {}, remoteAssets: {} };
  const sheetUrl = new URL("https://cdn.example/main.css");
  const latinCss = Buffer.from('.caf\xe9::before{content:"\x80"}', "latin1");
  const expectedCss = '.café::before{content:"€"}';
  const utf8Css = Buffer.from(expectedCss);
  const cssResponse = (bytes: Uint8Array, type = "text/css") => new Response(bytes, { headers: { "Content-Type": type } });
  const decode = async (bytes: Uint8Array, type = "text/css") => {
    const resources = singleHtmlResources(empty, async () => cssResponse(bytes, type), false);
    return resources.stylesheet(sheetUrl, new Set());
  };
  function cssDataUrls(text: string) {
    return [...text.matchAll(/data:text\/css(?:;charset=utf-8)?;base64,([a-z0-9+/=]+)/gi)].map(match => ({
      url: match[0], bytes: Buffer.from(match[1], "base64"),
    }));
  }

  for (const type of [
    "text/css; charset=windows-1252",
    'text/css; CHARSET = "ISO-8859-1"',
    'text/css; note="ignore; charset=utf-8"; charset=windows-1252',
    'text/css; charset="windows-1252"; charset=utf-8',
  ]) {
    test(`external CSS honors HTTP encoding: ${type}`, async () => {
      assert.equal(latinCss.toString("hex"), "2e636166e93a3a6265666f72657b636f6e74656e743a2280227d");
      assert.equal(await decode(latinCss, type), expectedCss);
    });
  }

  test("HTTP CSS charset takes precedence over @charset and invalid HTTP labels fall back", async () => {
    const prefix = '@charset "utf-8";';
    assert.equal(await decode(Buffer.concat([Buffer.from(prefix), latinCss]), "text/css; charset=windows-1252"), prefix + expectedCss);
    const legacyPrefix = '@charset "windows-1252";';
    assert.equal(await decode(Buffer.concat([Buffer.from(legacyPrefix), latinCss]), "text/css; charset=not-an-encoding"), legacyPrefix + expectedCss);
  });

  for (const encoding of ["utf-8", "utf-16le", "utf-16be"] as const) {
    test(`CSS ${encoding} BOM overrides HTTP charset and @charset`, async () => {
      const text = '@charset "windows-1252";' + expectedCss;
      const bytes = encoding === "utf-8" ? Buffer.from(text) : Buffer.from(text, "utf16le");
      if (encoding === "utf-16be") bytes.swap16();
      const bom = Buffer.from(encoding === "utf-8" ? [0xef, 0xbb, 0xbf] : encoding === "utf-16le" ? [0xff, 0xfe] : [0xfe, 0xff]);
      assert.equal(await decode(Buffer.concat([bom, bytes]), "text/css; charset=windows-1252"), text);
    });
  }

  for (const label of ["windows-1252", "ISO-8859-1", " latin1 "]) {
    test(`CSS detects a strict leading @charset ${label}`, async () => {
      const prefix = `@charset "${label}";`;
      assert.equal(await decode(Buffer.concat([Buffer.from(prefix), latinCss])), prefix + expectedCss);
    });
  }

  for (const prefix of [
    '\n@charset "windows-1252";',
    '/* comment */@charset "windows-1252";',
    '@CHARSET "windows-1252";',
    "@charset 'windows-1252';",
    '@charset  "windows-1252";',
    '@charset\t"windows-1252";',
    '@charset "windows-1252" ;',
    '@charset "windows-1252"',
    '@charset "not-an-encoding";',
    '@charset "windows-1252\x80";',
  ]) {
    test(`nonstandard CSS encoding declaration is not sniffed: ${JSON.stringify(prefix)}`, async () => {
      const bytes = Buffer.concat([Buffer.from(prefix), utf8Css]);
      assert.equal(await decode(bytes), prefix + expectedCss);
    });
  }

  test("CSS encoding sniff is bounded to the first 1024 bytes, including the semicolon", async () => {
    const prefix = '@charset "' + " ".repeat(1000) + 'windows-1252";';
    assert.equal(Buffer.byteLength(prefix), 1024);
    assert.equal(await decode(Buffer.concat([Buffer.from(prefix), latinCss])), prefix + expectedCss);
    const tooLong = '@charset "' + " ".repeat(1001) + 'windows-1252";';
    assert.equal(await decode(Buffer.concat([Buffer.from(tooLong), utf8Css])), tooLong + expectedCss);
  });

  for (const label of ["utf-16", "utf-16le", "utf-16be"]) {
    test(`ASCII @charset ${label} uses UTF-8`, async () => {
      const prefix = `@charset "${label}";`;
      assert.equal(await decode(Buffer.concat([Buffer.from(prefix), utf8Css])), prefix + expectedCss);
    });
  }

  test("CSS without an encoding defaults to UTF-8 and malformed bytes use replacement characters", async () => {
    assert.equal(await decode(utf8Css), expectedCss);
    assert.equal(await decode(latinCss), '.caf�::before{content:"�"}');
  });

  test("generated CSS strings stay UTF-8 when imported by a legacy stylesheet", async () => {
    const text = '@charset "windows-1252";' + expectedCss;
    const resources = singleHtmlResources({
      files: { "generated.css": text }, binaries: { "legacy.css": latinCss.toString("base64") }, remoteAssets: {},
    }, async () => cssResponse(Buffer.from('@import "https://export.invalid/generated.css";@import "https://export.invalid/legacy.css";'), "text/css; charset=windows-1252"), false);
    const [generated, legacy] = cssDataUrls(await resources.stylesheet(sheetUrl, new Set()));
    assert.equal(generated.bytes.toString("utf8"), text);
    assert.equal(legacy.bytes.toString("utf8"), expectedCss);
  });

  test("raw CSS binaries use their own @charset before the referring encoding", async () => {
    const prefix = '@charset "windows-1252";';
    const resources = singleHtmlResources({
      files: {}, binaries: { "legacy.css": Buffer.concat([Buffer.from(prefix), latinCss]).toString("base64") }, remoteAssets: {},
    }, async () => { throw new Error("Unexpected request"); }, false);
    assert.equal(await resources.stylesheet(new URL("https://export.invalid/legacy.css"), new Set()), prefix + expectedCss);
  });

  test("nested imports inherit the decoded parent encoding and remain UTF-8 data URLs", async () => {
    const seen: string[] = [];
    const resources = singleHtmlResources(empty, async url => {
      seen.push(url);
      if (url.endsWith("main.css")) return cssResponse(Buffer.from('@charset "windows-1252";@import "child.css";'));
      if (url.endsWith("/child.css")) return cssResponse(Buffer.concat([Buffer.from('@import "grandchild.css";'), latinCss]));
      if (url.endsWith("grandchild.css")) return cssResponse(latinCss, "text/css; charset=invalid");
      throw new Error("Unexpected request: " + url);
    }, false);
    const text = await resources.stylesheet(sheetUrl, new Set());
    const [child] = cssDataUrls(text);
    assert.ok(child);
    assert.match(child.url, /^data:text\/css;charset=utf-8;base64,/);
    assert.ok(child.bytes.toString("utf8").endsWith(expectedCss));
    const [grandchild] = cssDataUrls(child.bytes.toString("utf8"));
    assert.ok(grandchild);
    assert.match(grandchild.url, /^data:text\/css;charset=utf-8;base64,/);
    assert.deepEqual(grandchild.bytes, utf8Css);
    assert.deepEqual(seen, [sheetUrl.href, "https://cdn.example/child.css", "https://cdn.example/grandchild.css"]);
  });

  test("imported CSS can override its parent's encoding with HTTP, @charset or BOM", async () => {
    const cases = [
      { bytes: utf8Css, type: "text/css; charset=utf-8", expected: expectedCss },
      { bytes: Buffer.concat([Buffer.from('@charset "utf-8";'), utf8Css]), type: "text/css", expected: '@charset "utf-8";' + expectedCss },
      { bytes: Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), utf8Css]), type: "text/css", expected: expectedCss },
    ];
    for (const fixture of cases) {
      const resources = singleHtmlResources(empty, async url => url.endsWith("main.css")
        ? cssResponse(Buffer.from('@import "child.css";'), "text/css; charset=windows-1252")
        : cssResponse(fixture.bytes, fixture.type), false);
      const [child] = cssDataUrls(await resources.stylesheet(sheetUrl, new Set()));
      assert.equal(child.bytes.toString("utf8"), fixture.expected);
    }
  });

  test("CSS text and data URL caches distinguish shared imports in different encoding environments", async () => {
    const seen: string[] = [];
    const resources = singleHtmlResources(empty, async url => {
      seen.push(url);
      if (url.endsWith("legacy.css")) return cssResponse(Buffer.from('@import "shared.css";'), "text/css; charset=windows-1252");
      if (url.endsWith("modern.css")) return cssResponse(Buffer.from('@import "shared.css";'), "text/css; charset=utf-8");
      return cssResponse(utf8Css);
    }, false);
    const legacy = await resources.stylesheet(new URL("legacy.css", sheetUrl), new Set());
    const modern = await resources.stylesheet(new URL("modern.css", sheetUrl), new Set());
    const [legacyChild] = cssDataUrls(legacy), [modernChild] = cssDataUrls(modern);
    assert.equal(legacyChild.bytes.toString("utf8"), new TextDecoder("windows-1252").decode(utf8Css));
    assert.equal(modernChild.bytes.toString("utf8"), expectedCss);
    assert.notEqual(legacyChild.url, modernChild.url);
    assert.equal(await resources.stylesheet(new URL("legacy.css", sheetUrl), new Set()), legacy);
    assert.equal(await resources.stylesheet(new URL("modern.css", sheetUrl), new Set()), modern);
    assert.equal(seen.filter(url => url.endsWith("shared.css")).length, 1);
  });

  test("generated HTML preserves legacy selectors, strings and non-ASCII asset URLs after integrity verification", async () => {
    const css = Buffer.from('.caf\xe9::before{content:"\x80";background:url(caf\xe9.png)}', "latin1");
    const integrity = "sha256-" + createHash("sha256").update(css).digest("base64");
    const seen: string[] = [];
    const project = await toSingleHtmlProject({ files: {
      "index.html": `<link rel="stylesheet" href="${sheetUrl}" integrity="${integrity}"><p class="café">After</p>`,
    }, binaries: {}, remoteAssets: {} }, async url => {
      seen.push(url);
      return url.endsWith("main.css") ? cssResponse(css, "text/css; charset=windows-1252")
        : new Response(Uint8Array.of(1, 2, 3), { headers: { "Content-Type": "image/png" } });
    });
    const html = project.files["index.html"];
    assert.ok(html.includes('.café::before{content:"€";background:url(data:image/png;base64,AQID)}'));
    assert.ok(html.endsWith('<p class="café">After</p>'));
    assert.doesNotMatch(html, /�|integrity=/);
    assert.deepEqual(seen, [sheetUrl.href, "https://cdn.example/caf%C3%A9.png"]);
    assert.deepEqual(project.binaries, {});
    assert.deepEqual(project.remoteAssets, {});
  });

  test("retained stylesheet links explicitly encode UTF-8 despite an original legacy @charset", async () => {
    const prefix = '@charset "windows-1252";';
    const sourceCss = Buffer.concat([Buffer.from(prefix), latinCss]);
    const project = await toSingleHtmlProject({ files: {
      "index.html": `<link rel="stylesheet" title="Theme" href="${sheetUrl}"><p class="café">After</p>`,
    }, binaries: {}, remoteAssets: {} }, async () => cssResponse(sourceCss));
    const html = project.files["index.html"];
    const [embedded] = cssDataUrls(html);
    assert.ok(embedded);
    assert.match(embedded.url, /^data:text\/css;charset=utf-8;base64,/);
    assert.deepEqual(embedded.bytes, Buffer.from(prefix + expectedCss));
    const doc = parse(html);
    const nodes: any[] = [];
    const visit = (node: any) => { if (node.tagName === "link") nodes.push(node); node.childNodes?.forEach(visit); };
    visit(doc);
    assert.equal(nodes.length, 1);
    assert.equal(nodes[0].attrs.find((attr: any) => attr.name === "href").value, embedded.url);
  });
});

describe("single-html-raw-content-security", () => {
  test("single HTML never includes untrusted Content-Type as HTML attribute syntax", async () => {
    const project = await toSingleHtmlProject({
      files: {
        "index.html": '<!doctype html><html><body><img src="./assets/remote.png"></body></html>',
      },
      binaries: {},
      remoteAssets: { "assets/remote.png": "assets/upload-id" },
    }, async () => new Response(Uint8Array.from([1, 2, 3]), {
      headers: {
        // この値は、src="data:..." から抜け出して、onerror のハンドラーを作ろうとする。
        "Content-Type": 'image/png" onerror="globalThis.__tsumuInjected=1" fake="',
      },
    }));
    const html = project.files["index.html"];
    assert.match(html, /<img src="data:image\/png;base64,AQID">/);
    assert.doesNotMatch(html, /onerror=|fake=|__tsumuInjected/);
  });

  test("single HTML does not interpret tags or style text inside inline scripts", async () => {
    const authoredScript = [
      "window.template = '<img src=\"./missing.png\" style=\"background:url(./missing-bg.png)\">';",
      "window.styleText = 'style=\"background:url(./missing-css.png)\"';",
      "window.linkText = '<link rel=\"stylesheet\" href=\"./missing.css\">';",
    ].join("\n");
    const project = await toSingleHtmlProject({
      files: {
        "index.html": [
          "<!doctype html><html><head></head><body>",
          "<script>", authoredScript, "</script>",
          '<img src="./assets/pixel.png" style="background:url(./assets/pixel.png)">',
          "</body></html>",
        ].join("\n"),
      },
      binaries: { "assets/pixel.png": "AQID" },
      remoteAssets: {},
    });
    const html = project.files["index.html"];
    assert.ok(html.includes(authoredScript), "authored script content must remain byte-for-byte identical");
    assert.match(html, /<img src="data:image\/png;base64,AQID" style="background:url\(data:image\/png;base64,AQID\)">/);
    assert.equal((html.match(/data:image\/png;base64,AQID/g) ?? []).length, 2);
  });

  test("single HTML leaves comments and textarea raw text untouched", async () => {
    const comment = '<!-- <img src="./missing.png"> <script src="./missing.js"></script> -->';
    const rawText = '<textarea><img src="./missing-textarea.png"><script src="./missing-textarea.js"></script></textarea>';
    const project = await toSingleHtmlProject({
      files: { "index.html": '<!doctype html><html><body>' + comment + rawText + "</body></html>" },
      binaries: {},
      remoteAssets: {},
    });
    assert.ok(project.files["index.html"].includes(comment));
    assert.ok(project.files["index.html"].includes(rawText));
  });

  test("lookalike attributes and quoted tag text cannot become executable script sources", async () => {
    const authored = '<div title="literal <script src=\'./evil.js\'></script>"></div>' +
      '<script data-src="./evil.js"></script><img data-src=./missing.png alt=">">';
    const project = await toSingleHtmlProject({
      files: { "index.html": authored, "evil.js": "globalThis.payloadRan = true;" }, binaries: {}, remoteAssets: {},
    });
    assert.equal(project.files["index.html"], authored);
  });

  test("embedding respects character references, unquoted attributes and SVG fragments", async () => {
    const project = await toSingleHtmlProject({
      files: { "index.html": '<img alt=">" src=pics/a&amp;b.svg#mark>' }, binaries: { "pics/a&b.svg": "PHN2Zy8+" }, remoteAssets: {},
    });
    assert.match(project.files["index.html"], /src="data:image\/svg\+xml;base64,PHN2Zy8\+#mark"/);
  });

  test("CSS text and comments cannot cause resource downloads", async () => {
    const css = '/* @import "absent.css"; */ .x{content:"url(missing.svg)"}';
    const project = await toSingleHtmlProject({
      files: { "index.html": "<style>" + css + "</style>" }, binaries: {}, remoteAssets: {},
    });
    assert.equal(project.files["index.html"], "<style>" + css + "</style>");
  });

  test("an integrity mismatch never becomes an executable inline resource", async () => {
    for (const tag of [
      '<script src="code.js" integrity="sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="></script>',
      '<link rel=stylesheet href=theme.css integrity="sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=">',
    ]) {
      await assert.rejects(toSingleHtmlProject({
        files: { "index.html": tag, "code.js": "attack()", "theme.css": ".h{}" }, binaries: {}, remoteAssets: {},
      }), /integrity/i);
    }
  });

  test("only a registered asset can use editor credentials", async () => {
    const before = Object.getOwnPropertyDescriptor(globalThis, "location");
    Object.defineProperty(globalThis, "location", { configurable: true, value: new URL("https://editor.example") });
    const calls: [string, RequestInit][] = [];
    const request = async (url: string, init: RequestInit) => {
      calls.push([url, init]);
      return new Response(new Uint8Array([1]), { headers: { "Content-Type": "image/png" } });
    };
    try {
      const source = { files: { "index.html": '<img src="local.png"><img src="https://cdn.example/img.png">' },
        remoteAssets: { "local.png": "assets/file" }, binaries: {} };
      await toSingleHtmlProject(source, request);
      assert.deepEqual(calls, [
        ["/api/assets/file?path=assets%2Ffile", { credentials: "same-origin", redirect: "error" }],
        ["https://cdn.example/img.png", { credentials: "omit", referrerPolicy: "no-referrer" }],
      ]);
      calls.length = 0;
      source.files["index.html"] = '<img src="https://editor.example/api/doc?site=private">';
      await assert.rejects(toSingleHtmlProject(source, request));
      assert.deepEqual(calls, []);
    } finally {
      if (before) Object.defineProperty(globalThis, "location", before);
      else Reflect.deleteProperty(globalThis, "location");
    }
  });

  test("nested stylesheets retain conditions, use their own base and ignore a template base", async () => {
    const project = await toSingleHtmlProject({
      files: {
        "index.html": '<template><base href="https://wrong.example/"></template><link rel=stylesheet href="css/main.css">',
        "css/main.css": '@import "sub/child.css" layer(colors) print;',
        "css/sub/child.css": 'p{background:image-set("../images/a.svg#mark" 1x)}',
      },
      binaries: { "css/images/a.svg": "PHN2Zy8+" }, remoteAssets: {},
    }, async () => { throw new Error("unexpected network request"); });
    const html = project.files["index.html"];
    const match = /@import "data:text\/css;charset=utf-8;base64,([^"]+)" layer\(colors\) print;/.exec(html);
    assert.ok(match);
    assert.match(atob(match[1]), /data:image\/svg\+xml;base64,PHN2Zy8\+#mark/);
  });

  test("CSS import alias cycles and deep chains stop before further reads", async () => {
    const files: Record<string, string> = { "index.html": "<link rel=stylesheet href='0.css'>", "0.css": '@import "0.css?cache";' };
    await assert.rejects(toSingleHtmlProject({ files, binaries: {}, remoteAssets: {} }), /Recursive CSS/);
    for (let i = 0; i < 34; i++) files[i + ".css"] = '@import "' + (i + 1) + '.css";';
    await assert.rejects(toSingleHtmlProject({ files, binaries: {}, remoteAssets: {} }), /depth/);
  });

  test("matching integrity is checked against source bytes before rewriting CSS", async () => {
    const css = "p { color: navy }";
    const sha = await crypto.subtle.digest("SHA-384", new TextEncoder().encode(css));
    const integrity = "sha384-" + Buffer.from(sha).toString("base64");
    const files = { "index.html": '<link rel=stylesheet media=print href=main.css integrity="' + integrity + '">', "main.css": css };
    const project = await toSingleHtmlProject({ files, binaries: {}, remoteAssets: {} });
    assert.match(project.files["index.html"], /<style media="print">\s*p \{ color: navy \}/);
    files["index.html"] = files["index.html"].replace(integrity, integrity + " sha512-AAAA");
    await assert.rejects(toSingleHtmlProject({ files, binaries: {}, remoteAssets: {} }), /integrity/i);
  });

  test("repeated references stop at the output limit before fetching subsequent resources", async () => {
    const files = { "index.html": '<img src=pic.png>'.repeat(50) + '<img src="https://cdn.example/last.png">' };
    let calls = 0;
    await assert.rejects(toSingleHtmlProject({ files, binaries: { "pic.png": "A".repeat(1024 * 1024) }, remoteAssets: {} },
      async () => { calls++; return new Response(); }), /48 MB/);
    assert.equal(calls, 0);
  });

  test("a redirected external stylesheet resolves references at the response URL", async () => {
    const seen: string[] = [];
    const project = await toSingleHtmlProject({
      files: { "index.html": '<link rel=stylesheet href="https://cdn.example/start">' }, binaries: {}, remoteAssets: {},
    }, async url => {
      seen.push(url);
      if (seen.length === 1) {
        const res = new Response('.a{background:url(icon.png)}', { headers: { "Content-Type": "text/css" } });
        Object.defineProperty(res, "url", { value: "https://cdn.example/assets/css/main.css" });
        return res;
      }
      return new Response(new Uint8Array([1]), { headers: { "Content-Type": "image/png" } });
    });
    assert.deepEqual(seen, ["https://cdn.example/start", "https://cdn.example/assets/css/icon.png"]);
    assert.match(project.files["index.html"], /data:image\/png;base64,AQ==/);
  });

  test("repeated candidates in one srcset fail before an oversized attribute is assembled", async () => {
    const files = { "index.html": '<img srcset="' + "pic.png 1x, ".repeat(80) + '">' };
    await assert.rejects(toSingleHtmlProject({ files, binaries: { "pic.png": "A".repeat(1024 * 1024) }, remoteAssets: {} }),
      /srcset exceeds/);
  });

  test("non-HTTP base schemes cannot redirect resource resolution", async () => {
    for (const href of ["vbscript:ignored", "javascript:ignored", "data:text/plain,ignored", "file:///tmp/"]) {
      const { files } = await toSingleHtmlProject({
        files: { "index.html": '<base href="' + href + '"><img src=pic.png>' },
        binaries: { "pic.png": "AQ==" }, remoteAssets: {},
      });
      assert.match(files["index.html"], /src="data:image\/png;base64,AQ=="/);
    }
  });

  test("module graphs reject unsafe dependencies, invalid integrity and non-portable imports", async () => {
    const files = { "index.html": '<script type=module src="entry.mjs"></script>', "entry.mjs": 'import "./entry.mjs"' };
    const project = { files, binaries: {}, remoteAssets: {} };
    await assert.rejects(toSingleHtmlProject(project), /circular/i);
    for (const code of ['import("./" + name)', 'import.meta.resolve("./x")', 'import a from "./a.json" with {type:"json"}']) {
      files["entry.mjs"] = code;
      await assert.rejects(toSingleHtmlProject(project), /HTML ZIP/);
    }
    files["entry.mjs"] = 'import "./bad.txt"';
    await assert.rejects(toSingleHtmlProject({ ...project, files: { ...files, "bad.txt": "attack()" } }), /media type/i);
    files["index.html"] = '<script type=module src="entry.mjs" integrity="sha256-AAAA"></script>';
    await assert.rejects(toSingleHtmlProject(project), /integrity/i);
    files["index.html"] = '<script type=importmap>{"imports":{"./bad.txt":"./safe.mjs"}}</script><script type=module src="entry.mjs"></script>';
    await assert.rejects(toSingleHtmlProject(project), /import map/);
  });

  test("a remote filename cannot promote a response with a missing or malformed active media type", async () => {
    for (const tag of ['<script src="https://cdn.example/a.js"></script>', '<link rel=stylesheet href="https://cdn.example/a.css">']) {
      for (const headers of [new Headers(), new Headers({ "Content-Type": 'invalid"type' })]) {
        await assert.rejects(toSingleHtmlProject({ files: { "index.html": tag }, remoteAssets: {}, binaries: {} },
          async () => new Response(new Uint8Array([97]), { headers })), /media type/);
      }
    }
  });

  test("module specifier rewriting does not publish signed resource URLs", async () => {
    const project = await toSingleHtmlProject({ files: { "index.html": '<script type=module src="https://cdn.example/e.js?token=private-marker"></script>' },
      remoteAssets: {}, binaries: {} }, async () => new Response("export default 1", { headers: { "Content-Type": "text/javascript" } }));
    assert.doesNotMatch(project.files["index.html"], /private-marker|cdn\.example/);
  });

  test("CSS and srcset token budgets stop scanning before an oversized resource list is expanded", async () => {
    for (const [markup, error] of [
      ['<style>' + "url(#x) ".repeat(100001) + '</style>', /Too many CSS resource references/],
      ['<style>' + "x(".repeat(513) + "0" + ")".repeat(513) + '</style>', /CSS function nesting/],
      ['<img srcset="' + "absent.png 1x, ".repeat(100001) + '">', /Too many single HTML srcset candidates/],
    ] as const) {
      await assert.rejects(toSingleHtmlProject({ files: { "index.html": markup }, binaries: {}, remoteAssets: {} }), error);
    }
  });
});
});
