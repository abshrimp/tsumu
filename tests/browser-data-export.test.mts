import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";
import { generateExportProject, exportLimitations } from "../lib/export-formats";
import { makeBox } from "../lib/presets";
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
  // Query parameters are strings; interpolation preserves their value type.
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
  assert.ok(problems.some((problem) => problem.includes("秘密のAPIキー")));
  assert.throws(() => generateExportProject(doc, "html"), /APIキー/);
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
