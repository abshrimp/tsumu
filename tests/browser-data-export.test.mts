import assert from "node:assert/strict";
import { test, describe } from "node:test";
import vm, { runInNewContext } from "node:vm";
import { generateExportProject, exportLimitations } from "../lib/export-formats";
import { listRuntimeDom } from "./helpers/list-runtime-dom";
import { makeBox, makeText } from "../lib/presets";
import { type ScriptStep, type SiteDoc } from "../lib/types";
import { filterPredicate } from "../lib/generator/render-helpers";
import { matchesValueCondition, parseValueLiteral } from "../lib/value-semantics";
import { interpolate, lookupVar } from "../lib/vars";
import { PAGE_DATA_RUNTIME } from "../lib/generator/browser-data";
import { nativeDataModule } from "../lib/generator/native-data";
import { fetchRequestOf, type FetchOptions } from "../lib/fetch-request";
import { applyList, toListItems, type ListOp, filterItems } from "../lib/data";
import { resolvedListOps } from "../components/canvas/render";

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
      return {
        ok: true, headers: { get: () => null },
        text: async () => JSON.stringify([{ id: 1, name: "A" }, { id: 2, name: "B" }]),
      };
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
      return { ok: true, headers: { get: () => "13" }, text: async () => '{"answer":true}' };
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

  test("generated code has no framework-editor brand markers (documentation and build-package identity excepted)", () => {
    const doc = fixture([]);
    for (const format of ["nextjs", "react", "html"] as const) {
      const p = generateExportProject(doc, format);
      for (const [path, source] of Object.entries(p.files)) {
        if (/\.(md|txt)$/i.test(path) || path === "vendor/picomatch/package.json") continue;
        assert.doesNotMatch(source, /tsumu/i, format + ": " + path);
      }
    }
    const css = generateExportProject(doc, {
      framework: "react", language: "typescript", style: "css-modules", scope: "project",
    });
    for (const [path, source] of Object.entries(css.files)) {
      if (/\.(md|txt)$/i.test(path) || path === "vendor/picomatch/package.json") continue;
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
      fetch: async (_url: string, init: unknown) => { request = JSON.parse(JSON.stringify(init)); return { ok: true, headers: { get: () => null }, text: async () => "{}" }; },
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
      fetch: async () => ({ ok: true, headers: { get: () => null }, text: async () => JSON.stringify(data) }),
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
