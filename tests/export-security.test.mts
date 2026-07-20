import { runChecks } from "../lib/generator/checks";
import { fieldExpr, listItemsExpr } from "../lib/generator/render-helpers";
import { setVarPath, compareValues, filterItems, filterConds } from "../lib/data";
import { createInitialDoc } from "../lib/presets";
import assert from "node:assert/strict";
import { test } from "node:test";
import { generateExportProject } from "../lib/export-formats";
import { toSingleHtmlProject } from "../lib/generator/single-html";
import { nativeDataModule } from "../lib/generator/native-data";
import { evaluateValueRecipe } from "../lib/script-model/recipe-runtime";
import { parseValueOperandInput } from "../lib/script-model/compose";
import { makeBox } from "../lib/presets";
import type { SiteDoc } from "../lib/types";

function doc(): SiteDoc {
  return {
    siteName: "Site {1 + 2} </script>",
    lang: 'ja" onload="globalThis.__attributeExecuted=1',
    pages: {
      home: { id: "home", name: "Home", slug: "", title: 'Page </title><script>unsafe()</script>',
        description: "", children: ["text", "picture"] },
    },
    pageOrder: ["home"],
    nodes: {
      text: { ...makeBox(), id: "text", text: {
        content: "Literal {{ 3 + 4 }} and {1 + 2}", heading: 1,
      } },
      picture: { ...makeBox(), id: "picture", type: "image", image: {
        src: "data:image/png;base64,AQID",
        alt: "Image {1 + 2}", width: 1, height: 1,
      } },
    },
    assets: {},
  };
}

test("generated Vue and Svelte components never compile authored plain text into expressions", () => {
  for (const framework of ["vue", "nuxt", "sveltekit"] as const) {
    const project = generateExportProject(doc(), framework);
    const path = framework === "nuxt" ? "app/generated/pages/Page0.vue" :
      framework === "vue" ? "src/pages/Page0.vue" : "src/lib/pages/Page0.svelte";
    const source = project.files[path];
    assert.ok(source, path);
    assert.ok(source.includes('src="data:image/png;base64,AQID"'));
    // Entity-encoded braces are ordinary HTML text, not compiled expressions.
    assert.match(source, /Literal &#123;&#123; 3 \+ 4 &#125;&#125; and &#123;1 \+ 2&#125;/);
    assert.doesNotMatch(source, /Literal \{\{/);
    assert.match(source, /Image &#123;1 \+ 2&#125;/);
    if (framework === "sveltekit") {
      const template = project.files["src/app.html"];
      assert.ok(template.includes('lang="ja&amp;quot;') === false);
      assert.ok(template.includes('lang="ja&quot; onload=&quot;'));
      assert.ok(!template.includes('lang="ja" onload="'));
      assert.ok(template.includes("&lt;/script&gt;"));
      const route = project.files["src/routes/+page.svelte"];
      assert.doesNotMatch(route, /Site \{1 \+ 2\} <\/script>/);
      assert.match(route, /<title>\{data\.title\} \| \{/);
    }
    if (framework === "vue") {
      assert.doesNotMatch(project.files["index.html"], /onload="globalThis/);
      assert.match(project.files["index.html"], /ja&quot; onload=&quot;/);
      assert.doesNotMatch(project.files["server.mjs"], /req\.headers\.host/);
    }
  }
});

test("new #136 composite conditions and template operands use the current recipe semantics", () => {
  const ready = [{ status: "ready", price: 8 }, { status: "ready", price: 1 },
    { status: "draft", price: 9 }];
  const result = evaluateValueRecipe(ready, [{
    kind: "filter", field: "status", operation: "eq", operand: "ready",
    conditions: [{ field: "price", operation: "gte", operand: "5",
      and: true }],
  }], {});
  assert.equal(result.kind, "value");
  if (result.kind === "value") assert.deepEqual(result.value, [ready[0]]);
  const interpolated = evaluateValueRecipe("alphabet", [{
    kind: "compare", operation: "contains", operand: "{needle}",
  }], { needle: "pha" });
  assert.deepEqual(interpolated, { kind: "value", value: true });
});

test("native framework links reject active URL schemes without breaking images", async () => {
  const source = nativeDataModule();
  const uri = "data:text/javascript;base64," + Buffer.from(source).toString("base64");
  const resolver = await import(uri);
  for (const unsafe of [
    "javascript:alert(1)", "data:text/html,<script>alert(1)</script>",
    "data:image/svg+xml;base64,PHN2Zy8+", "//attacker.invalid/path",
    "java\\nscript:alert(1)",
  ]) {
    assert.equal(resolver.resolveUrl(unsafe, {}), "#", unsafe);
  }
  assert.equal(resolver.resolveUrl("https://example.test/", {}), "https://example.test/");
  assert.equal(resolver.resolveResourceUrl("data:image/png;base64,AQID", {}),
    "data:image/png;base64,AQID");
  assert.equal(resolver.resolveResourceUrl("javascript:alert(1)", {}), "#");
});

test("single HTML preserves srcset data URLs and filenames containing commas", async () => {
  const source = {
    files: {
      "index.html": '<!doctype html><html><body><img srcset="data:image/png;base64,AQID 1x, assets/photo,one.png 2x"></body></html>',
    },
    binaries: { "assets/photo,one.png": "BAUG" },
    remoteAssets: {},
  };
  const project = await toSingleHtmlProject(source);
  const html = project.files["index.html"];
  assert.match(html, /data:image\/png;base64,AQID 1x, data:image\/png;base64,BAUG 2x/);
  assert.doesNotMatch(html, /assets\/photo,one\.png/);
  assert.deepEqual(Object.keys(project.files), ["index.html"]);
});

test("generated SSR request policy blocks reserved hosts, sensitive headers and Host-origin bypass", async () => {
  const site = doc();
  site.pages.home.pageScripts = [{
    id: "load", trigger: "load", pos: { x: 0, y: 0 },
    steps: [{ id: "fetch", kind: "fetch", as: "data",
      url: "http://100.100.100.200/latest" }],
  }];
  const project = generateExportProject(site, "sveltekit");
  const serverModule = project.files["src/lib/server-request.js"];
  assert.ok(serverModule);
  const { requestPublic } = await import("data:text/javascript;base64," +
    Buffer.from(serverModule).toString("base64")) as {
    requestPublic: (uri: string, init: RequestInit, base: string,
      localFetch: (uri: string, init: RequestInit) => Promise<Response>) => Promise<Response>;
  };
  let remoteCalls = 0;
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    remoteCalls++;
    return new Response("{}", { status: 200 });
  };
  try {
    const localRequests: string[] = [];
    const local = async (uri: string) => {
      localRequests.push(uri);
      return new Response("{}", { status: 200 });
    };
    await assert.rejects(
      requestPublic("http://100.100.100.200/latest", {}, "https://site.example", local),
      /not allowed/);
    await assert.rejects(
      requestPublic("/private", { headers: { Authorization: "Bearer private" } },
        "https://site.example", local),
      /Sensitive headers/);
    await assert.rejects(
      requestPublic("https://site.example/private", {}, "https://site.example", local),
      /Absolute same-origin/);
    await requestPublic("/api/data?limit=1", {}, "https://site.example", local);
    assert.deepEqual(localRequests, ["/api/data?limit=1"]);
    assert.equal(remoteCalls, 0);
  } finally {
    globalThis.fetch = oldFetch;
  }
});


test("partial export and generated JS reject inherited object properties", () => {
  const vars: Record<string, unknown> = {};
  setVarPath(vars, "__proto__.polluted", true);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
  assert.equal((vars["__proto__"] as Record<string, unknown>).polluted, true);
  vars.rows = [];
  setVarPath(vars, "rows.1000001", "bad");
  assert.equal((vars.rows as unknown[]).length, 0);
  const expression = fieldExpr("item", "constructor");
  const read = new Function("item", "return " + expression) as (item: object) => unknown;
  assert.equal(read({}), undefined);
  assert.equal(read(JSON.parse('{"constructor":"own"}')), "own");
});

test("export validation checks targets in every joined if condition", () => {
  const doc = createInitialDoc();
  const page = doc.pages[doc.pageOrder[0]];
  const node = doc.nodes[page.children[0]];
  node.scripts = [{ id: "check-all", trigger: "click", pos: { x: 0, y: 0 },
    steps: [{ id: "cond", kind: "if",
      cond: { subject: "var", target: "", left: "1", op: "eq", value: "1" },
      conditions: [{ subject: "visible", target: "missing-joined-target", and: true }],
      then: [],
    }],
  }];
  const issues = runChecks(doc);
  assert.ok(issues.some((issue) => issue.message.includes("missing-joined-target")));
});


test("latest #136 quoted variable-looking operand remains an ordinary literal", () => {
  const input = parseValueOperandInput('"{name}"');
  assert.equal(input.operandType, "text");
  assert.equal(input.operand, "\\{name}");
  const computed = evaluateValueRecipe("{name}", [
    { kind: "compare", operation: "eq", operand: input.operand },
  ], { name: "not-the-same" });
  assert.deepEqual(computed, { kind: "value", value: true });
});

test("latest #136 filters, sorts and generated expressions avoid unsafe object coercion", () => {
  const objectWithShadowedToString = JSON.parse('{"toString":"not a function"}');
  const items = [
    { value: objectWithShadowedToString },
    { value: "regular" },
    { value: ["x", null, "y"] },
  ];
  assert.doesNotThrow(() => compareValues(objectWithShadowedToString, 2));
  const selected = filterItems(items, [
    { kind: "filter", conds: [
      { field: "value", op: "eq", value: "[object Object]" },
    ] },
  ]);
  assert.deepEqual(selected, [items[0]]);
  assert.deepEqual(filterItems(items, [
    { kind: "filter", conds: [
      { field: "value", op: "eq", value: "x,,y" },
    ] },
  ]), [items[2]]);
  const filters = filterConds({
    kind: "filter-array", id: "legacy-condition", array: "items",
    field: "value", op: "eq", value: "none",
    or: [
      { field: "", op: "eq", value: "", and: false },
      { field: "value", op: "eq", value: "x,,y", and: true },
    ],
  });
  assert.equal(filters[1].and, false, "Empty OR clauses must keep group boundaries");
  const expr = listItemsExpr({ from: "items" }, "vars", "items", [
    { kind: "sort", field: "value", dir: "asc" },
  ]);
  const fn = new Function("vars", "lookupVar", "toItems", "return " + expr) as
    (vars: object, get: (vars: any, name: string) => any,
     toItems: (source: unknown) => unknown[]) => unknown[];
  const sorted = fn({ items }, (vars, key) => vars[key],
    (value) => Array.isArray(value) ? [...value] : []);
  assert.equal(sorted.length, 3);
  assert.ok(sorted.includes(items[0]));
});
