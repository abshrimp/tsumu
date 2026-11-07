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
    window, location: { search }, URLSearchParams,
    document: { querySelector: () => ({ textContent: raw }) },
    fetch: implementation,
    console: { warn: (...args: unknown[]) => warnings.push(args.map(String).join(" ")) },
  }, { timeout: 1000 });
  assert.ok(window.__pageDataReady);
  const values = await window.__pageDataReady;
  return { values: JSON.parse(JSON.stringify(values)), warnings };
}

test("native HTML fetches JSON and computes derived fields, counts and joined strings", async () => {
  const doc = fixture([
    { id: "request", kind: "fetch", url: "https://data.example.test/items?group={group}", as: "rows",
      sample: [{ id: 999, name: "editor-only" }] },
    { id: "find", kind: "array-find", array: "rows", field: "id", value: "{id}", into: "selected" },
    { id: "field", kind: "array-field", array: "rows", field: "display", value: "Name: {name}" },
    { id: "count", kind: "count", array: "rows", into: "total" },
    { id: "join", kind: "join", array: "rows", field: "display", sep: " / ", into: "names" },
  ]);
  const project = generateExportProject(doc, "html");
  assert.ok(project.files["scripts.js"].includes("__pageDataReady"));
  assert.match(project.files["index.html"], /data-client-list/);
  assert.doesNotMatch(project.files["index.html"], /editor-only/);
  const calls: string[] = [];
  const { values, warnings } = await runBrowserData(project, "?group=news&id=2", async (url) => {
    calls.push(url);
    return {
      ok: true, headers: { get: () => null },
      text: async () => JSON.stringify([{ id: 1, name: "A" }, { id: 2, name: "B" }]),
    };
  });
  assert.deepEqual(calls, ["https://data.example.test/items?group=news"]);
  assert.equal(values.total, 2);
  assert.equal(values.names, "Name: A / Name: B");
  assert.equal(values.selected.id, 2);
  assert.equal(values.rows[1].display, "Name: B");
  assert.deepEqual(warnings, []);
});

test("native HTML sends an interpolated JSON POST when the public API permits it", async () => {
  const doc = fixture([{
    id: "request", kind: "fetch", url: "https://data.example.test/search", as: "data",
    method: "POST", headers: [{ name: "X-Locale", value: "{lang}" }],
    body: '{"text":"{query}","limit":{limit}}',
  }]);
  const project = generateExportProject(doc, "html");
  let request: any;
  const { values } = await runBrowserData(project, "?query=hello%20world&limit=3&lang=ja", async (url, options) => {
    request = { url, options };
    return { ok: true, headers: { get: () => "13" }, text: async () => '{"answer":true}' };
  });
  assert.equal(request.url, "https://data.example.test/search");
  assert.equal(request.options.method, "POST");
  assert.equal(request.options.headers["X-Locale"], "ja");
  assert.equal(request.options.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(request.options.body), { text: "hello world", limit: 3 });
  assert.equal(values.data.answer, true);
});

test("native HTML fails safely when CORS or the network blocks a request", async () => {
  const project = generateExportProject(fixture([{
    id: "fetch", kind: "fetch", url: "https://data.example.test/private", as: "privateData",
  }]), "html");
  const { values, warnings } = await runBrowserData(project, "", async () => {
    throw new TypeError("CORS blocked");
  });
  assert.equal(values.privateData, null);
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
