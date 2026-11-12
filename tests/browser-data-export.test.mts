import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";
import { generateExportProject, exportLimitations } from "../lib/export-formats";
import { listRuntimeDom } from "./helpers/list-runtime-dom";
import { makeBox, makeText } from "../lib/presets";
import type { ScriptStep, SiteDoc } from "../lib/types";

function fixture(steps: ScriptStep[]): SiteDoc {
  const title = { ...makeBox(), id: "title", attrId: "summary", text: { content: "{total} records", heading: 1 } };
  const list = { ...makeBox(), id: "list", type: "list" as const, list: { from: "rows" }, children: ["entry"] };
  const entry = { ...makeBox(), id: "entry", text: { content: "{name}", heading: 0 } };
  return {
    siteName: "Data demonstration",
    pages: {
      main: {
        id: "main", name: "Home", slug: "", title: "Home", description: "", children: ["title", "list"],
        pageScripts: [{ id: "load", trigger: "load", pos: { x: 0, y: 0 }, steps }],
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
      { id: id + "-click", trigger: "click", pos: { x: 0, y: 0 }, steps: [
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
