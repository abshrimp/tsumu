import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { transformSync } from "esbuild";
import { generateProject } from "../lib/generator";
import { previewDataVars } from "../lib/data";
import { fetchRequestOf } from "../lib/fetch-request";
import { makeBox, makeText } from "../lib/presets";
import { publishedComponentList } from "./helpers/component-list-export";
import { listRuntimeDom } from "./helpers/list-runtime-dom";
import type { SiteDoc, ScriptStep } from "../lib/types";

const require = createRequire(import.meta.url);
function execute(source: string, dependencies: Record<string, unknown> = {}) {
  const module = { exports: {} as any };
  const compiled = transformSync(source, { loader: "tsx", jsx: "automatic", format: "cjs" }).code;
  new Function("require", "module", "exports", compiled)(
    (name: string) => dependencies[name] ?? require(name), module, module.exports);
  return module.exports;
}

test("the emitted Next page sends the same JSON and headers as the editor, using its emitted vars module", async () => {
  const options: Extract<ScriptStep, { kind: "fetch" }> = {
    id: "fetch", kind: "fetch", as: "result", method: "POST",
    url: "https://example.com/api", headers: [{ name: "content-type", value: "application/vnd.test+json" }],
    body: JSON.stringify({ literal: "\\{name}", value: "{name}", next: "{slug}" }),
  };
  const node = { ...makeBox(), id: "box" };
  const doc: SiteDoc = {
    siteName: "Request parity", assets: {}, nodes: { box: node }, pageOrder: ["p"],
    pages: { p: { id: "p", name: "Home", title: "Home", description: "", slug: "", children: ["box"],
      pageScripts: [{ id: "load", trigger: "load", pos: { x: 0, y: 0 }, steps: [options] }] } },
  };
  const project = generateProject(doc);
  const sent: Array<{ url: string; init: any }> = [];
  const page = execute(project.files["app/page.tsx"], {
    "@/lib/vars": execute(project.files["lib/vars.ts"]),
    "@/lib/safe-fetch": {
      fetchPublic: async (url: string, init: any) => { sent.push({ url, init }); return { ok: true }; },
      readTextLimited: async () => "{}",
    },
  });
  const vars = { name: 'quotes" and slash\\ and newline\n', slug: "日本" };
  await page.default({ searchParams: Promise.resolve(vars) });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, options.url);
  const expected = fetchRequestOf(options, vars)!;
  assert.equal(sent[0].init.method, expected.method);
  assert.deepEqual(sent[0].init.headers, expected.headers);
  assert.equal(sent[0].init.body, expected.body);
  assert.deepEqual(JSON.parse(sent[0].init.body), { literal: "{name}", value: vars.name, next: vars.slug });
});

for (const mutation of [
  { id: "remove", kind: "remove-list-item", list: "items", mode: "value", value: "B" },
  { id: "replace", kind: "set-list-item", list: "items", key: "0", value: "C" },
] satisfies ScriptStep[]) {
  test(`emitted Next page runs standalone ${mutation.kind} on a list literal`, async () => {
    const doc: SiteDoc = {
      siteName: "List operations", assets: {}, nodes: {}, pageOrder: ["p"],
      pages: { p: { id: "p", name: "Home", title: "Home", description: "", slug: "", children: [],
        pageScripts: [{ id: "load", trigger: "load", pos: { x: 0, y: 0 }, steps: [
          { id: "seed", kind: "set-var", into: "items", value: '["B","A"]' },
          mutation,
          { id: "request", kind: "fetch", as: "result", url: "https://example.com/{items.0}" },
        ] }] } },
    };
    const { files } = generateProject(doc);
    const calls: string[] = [];
    const page = execute(files["app/page.tsx"], {
      "@/lib/vars": execute(files["lib/vars.ts"]),
      "@/lib/page-load-steps": execute(files["lib/page-load-steps.ts"]),
      "@/lib/value-recipe": execute(files["lib/value-recipe.ts"]),
      "@/lib/safe-fetch": {
        fetchPublic: async (url: string) => { calls.push(url); return { ok: true }; },
        readTextLimited: async () => "{}",
      },
    });
    await page.default({ searchParams: Promise.resolve({}) });
    assert.deepEqual(calls, ["https://example.com/" + (mutation.kind === "remove-list-item" ? "A" : "C")]);
  });
}

function fetchedListDoc(steps: ScriptStep[]): SiteDoc {
  return {
    siteName: "Fetched list", assets: {}, pageOrder: ["p"],
    pages: { p: { id: "p", name: "Home", title: "Home", description: "", slug: "", children: ["act", "list"],
      pageScripts: [{ id: "load", trigger: "load", pos: { x: 0, y: 0 }, steps: [
        { id: "fetch", kind: "fetch", url: "https://example.com/catalogue", as: "data" },
      ] }] } },
    nodes: {
      act: { ...makeText("Run"), id: "act", attrId: "act", semantic: "button", scripts: [
        { id: "click", trigger: "click", pos: { x: 0, y: 0 }, steps },
      ] },
      list: { ...makeBox(), id: "list", type: "list", list: { from: "data.0.rows" }, children: ["name"] },
      name: { ...makeText("{値}"), id: "name", attrId: "item" },
    },
  };
}

test("clicking remove in a Next page updates the fetched list without sending its unrelated fields", async () => {
  const doc = fetchedListDoc([
    { id: "remove", kind: "remove-list-item", list: "data.0.rows", mode: "key", value: "1" },
  ]);
  const html = await publishedComponentList(doc, "app/page.tsx", [{ rows: ["A", "B", "C"], other: "server-only" }]);
  assert.doesNotMatch(html, /server-only/);
  const dom = listRuntimeDom(html, generateProject(doc).files["public/scripts.js"]);
  const items = () => dom.active("#item").map(node => node.textContent);
  assert.deepEqual(items(), ["A", "B", "C"]);
  await dom.click("act");
  assert.deepEqual(items(), ["A", "C"]);
  await dom.click("act");
  assert.deepEqual(items(), ["A"]);
  dom.navigate(await publishedComponentList(doc, "app/page.tsx", [{ rows: ["D", "E"] }]));
  assert.deepEqual(items(), ["D", "E"]);
  await dom.click("act");
  assert.deepEqual(items(), ["D"]);
});

test("a click condition compares fetched records and lists with their original types", async () => {
  const doc = fetchedListDoc([
    { id: "if", kind: "if", cond: { subject: "var", target: "", left: "{data.0.meta}", op: "has-key", value: "title" },
      conditions: [{ subject: "var", target: "", left: "{data.0.rows}", op: "contains", value: "{data.0.meta.title}", and: true }],
      then: [{ id: "ok", kind: "open-url", url: "/matched", newTab: true }] },
  ]);
  const source = generateProject(doc).files["public/scripts.js"];
  for (const [rows, expected] of [[["AB"], []], [["A", "B"], ["/matched"]]] as const) {
    const html = await publishedComponentList(doc, "app/page.tsx", [{ rows, meta: { title: "A" } }]);
    const urls: string[] = [];
    const dom = listRuntimeDom(html, source, { window: { open: (url: string) => urls.push(url) } });
    await dom.click("act");
    assert.deepEqual(urls, expected);
  }
});

test("a click filter compares a row's nested list against a fetched list variable", async () => {
  const doc = fetchedListDoc([
    { id: "filter", kind: "list-display", mode: "filter", array: "data.0.rows",
      field: "tags", op: "eq", value: "{data.0.wanted}", dir: "asc" },
  ]);
  doc.nodes.name.text!.content = "{name}";
  const html = await publishedComponentList(doc, "app/page.tsx", [{
    rows: [{ name: "first", tags: ["x", "y"] }, { name: "second", tags: ["x"] }],
    wanted: ["x"],
  }]);
  const dom = listRuntimeDom(html, generateProject(doc).files["public/scripts.js"]);
  await dom.click("act");
  const visible = dom.active("[data-item]").filter(node => node.style.display !== "none");
  assert.deepEqual(visible.map(node => node.textContent), ["second"]);
});

test("list removal keeps a structured selection supplied by another fetched variable", async () => {
  const doc = fetchedListDoc([
    { id: "remove", kind: "remove-list-item", list: "data.0.rows", mode: "value", value: "{selection.0.target}" },
  ]);
  doc.pages.p.pageScripts![0].steps.push({ id: "selection", kind: "fetch", url: "https://example.com/selection", as: "selection" });
  doc.nodes.name.text!.content = "{name}";
  const html = await publishedComponentList(doc, "app/page.tsx", [{
    rows: [{ name: "A" }, { name: "B" }], target: { name: "A" },
  }]);
  const dom = listRuntimeDom(html, generateProject(doc).files["public/scripts.js"]);
  await dom.click("act");
  assert.deepEqual(dom.active("#item").map(node => node.textContent), ["B"]);
});

test("mutating a fetched list preserves sibling text, other lists and conditions through hydration", async () => {
  const doc = fetchedListDoc([
    { id: "remove", kind: "remove-list-item", list: "data.0.rows", mode: "key", value: "0" },
    { id: "count", kind: "transform", source: "data", into: "count", transform: { kind: "length" } },
    { id: "read", kind: "transform", source: "data.0.heading", into: "heading", transform: { kind: "field", key: "name" } },
    { id: "if", kind: "if", conditions: [{ subject: "var", target: "", left: "{heading}", op: "eq", value: "Reports", and: true },
      { subject: "var", target: "", left: "{count}", op: "eq", value: "2", and: true }],
      cond: { subject: "var", target: "", left: "{data.0.status}", op: "eq", value: "open" },
      then: [{ id: "ok", kind: "open-url", url: "/open", newTab: true }] },
  ]);
  doc.nodes.title = { ...makeText("{data.0.title}"), id: "title", attrId: "title" };
  doc.nodes.related = { ...makeBox(), id: "related", type: "list", list: { from: "data.0.related" }, children: ["tag"] };
  doc.nodes.tag = { ...makeText("{label}"), id: "tag", attrId: "tag" };
  doc.pages.p.children.push("title", "related");
  const html = await publishedComponentList(doc, "app/page.tsx", [{
    title: "Catalogue", rows: ["A", "B"], related: [{ label: "X", extra: "unreferenced-field" }], status: "open", heading: { name: "Reports" }, private: "unreferenced-field",
  }, { private: "unreferenced-field" }]);
  assert.doesNotMatch(html, /unreferenced-field/);
  const urls: string[] = [];
  const dom = listRuntimeDom(html, generateProject(doc).files["public/scripts.js"], {
    window: { open: (url: string) => urls.push(url) },
  });
  const visible = (selector: string) => dom.active(selector).map(node => node.textContent);
  assert.deepEqual(visible("#title"), ["Catalogue"]);
  assert.deepEqual(visible("#tag"), ["X"]);
  await dom.click("act");
  assert.deepEqual(visible("#item"), ["B"]);
  assert.deepEqual(visible("#tag"), ["X"]);
  assert.deepEqual(visible("#title"), ["Catalogue"]);
  assert.deepEqual(urls, ["/open"]);
});

test("Next length counts both fetched records and new keys in a browser-edited record", async () => {
  const doc = fetchedListDoc([
    { id: "count-record", kind: "transform", source: "data.0.static", into: "before", transform: { kind: "length" } },
    { id: "write-key", kind: "set-var", into: "data.0.mutable.added", value: "1" },
    { id: "count-edited", kind: "transform", source: "data.0.mutable", into: "after", transform: { kind: "length" } },
  ]);
  doc.nodes.counts = { ...makeText("{before}/{after}"), id: "counts", attrId: "counts" };
  doc.pages.p.children.push("counts");
  const html = await publishedComponentList(doc, "app/page.tsx", [{
    static: { label: "private-immutable-field", enabled: true }, mutable: { original: true }, rows: [],
  }]);
  assert.doesNotMatch(html, /private-immutable-field/);
  const dom = listRuntimeDom(html, generateProject(doc).files["public/scripts.js"]);
  await dom.click("act");
  assert.equal(dom.active("#counts")[0].textContent, "2/2");
});

test("preview and generated Next page load update the parent record for nested destinations", async () => {
  const doc = fetchedListDoc([]);
  const sample = [{ value: "loaded" }];
  doc.pages.p.pageScripts![0].steps = [
    { id: "record", kind: "set-var", into: "record", value: '{"keep":"old"}' },
    { id: "field", kind: "set-var", into: "record.label", value: "new" },
    { id: "request", kind: "fetch", as: "record.rows", url: "https://example.com/catalogue", preview: { sample } },
    { id: "transform", kind: "transform", source: "record.rows", into: "record.count", transform: { kind: "length" } },
    { id: "out", kind: "transform", source: "record", into: "output", transform: { kind: "stringify" } },
  ];
  doc.pages.p.children = ["result"];
  doc.nodes.result = { ...makeText("{output}"), id: "result", attrId: "result" };
  const expected = { keep: "old", label: "new", rows: sample, count: 1 };
  assert.deepEqual(JSON.parse(String(previewDataVars(doc, "p").output)), expected);
  const html = await publishedComponentList(doc, "app/page.tsx", sample);
  const dom = listRuntimeDom(html, "");
  assert.deepEqual(JSON.parse(dom.active("#result")[0].textContent), expected);
});

for (const [target, reference] of [["data.1.rows", "data.-1.rows.0"], ["data.-1.rows", "data.1.rows.0"]]) {
  test(`editing ${target} updates the fetched last item at ${reference}`, async () => {
    const doc = fetchedListDoc([
      { id: "remove", kind: "remove-list-item", list: target, mode: "key", value: "0" },
    ]);
    doc.nodes.tail = { ...makeText(`{${reference}}`), id: "tail", attrId: "tail" };
    doc.pages.p.children.push("tail");
    const html = await publishedComponentList(doc, "app/page.tsx", [
      { rows: ["A"], private: "unreferenced-field" }, { rows: ["B", "C"], private: "unreferenced-field" },
    ]);
    assert.doesNotMatch(html, /unreferenced-field/);
    const dom = listRuntimeDom(html, generateProject(doc).files["public/scripts.js"]);
    assert.equal(dom.active("#tail")[0].textContent, "B");
    await dom.click("act");
    assert.equal(dom.active("#tail")[0].textContent, "C");
  });
}
