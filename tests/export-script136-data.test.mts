import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { createInitialDoc } from "../lib/presets";
import { pageDataPlan, pageDataServerIds, PAGE_DATA_RUNTIME } from "../lib/generator/browser-data";
import { nativeDataModule } from "../lib/generator/native-data";
import { generateExportProject } from "../lib/export-formats";
import { evaluateValueRecipe } from "../lib/script-model/recipe-runtime";

function fixture() {
  const doc = createInitialDoc();
  const page = doc.pages[doc.pageOrder[0]];
  const steps = [
    { id: "fetch", kind: "fetch", as: "data", url: "https://data.example.test/items",
      sample: { items: [{ id: "editor", price: 99 }] } },
    { id: "items", kind: "transform", source: "data", into: "items",
      transform: { kind: "field", key: "items" } },
    { id: "size", kind: "transform", source: "items", into: "size",
      transform: { kind: "length" } },
    { id: "math", kind: "transform", source: "size", into: "total",
      transform: { kind: "math", operation: "add", operand: "offset", operandType: "variable" } },
    { id: "lookup", kind: "transform", source: "items", into: "selected",
      transform: { kind: "find", field: "id", operation: "eq", operand: "second", operandType: "text" } },
    { id: "each", kind: "for-each", array: "items", then: [
      { id: "per-item", kind: "transform", source: "price", into: "lastPrice",
        transform: { kind: "math", operation: "multiply", operand: 2 } },
    ] },
    { id: "conditional", kind: "if", cond: { subject: "var", left: "{total}",
      op: "gt", value: "3" }, then: [
      { id: "yes", kind: "set-var", into: "branch", value: "high" },
    ], else: [{ id: "no", kind: "set-var", into: "branch", value: "low" }] },
    { id: "repeat", kind: "repeat", times: 2, then: [
      { id: "inc", kind: "transform", source: "total", into: "total",
        transform: { kind: "math", operation: "add", operand: 1 } },
    ] },
    { id: "list", kind: "list-display", mode: "filter", array: "items",
      field: "id", op: "eq", value: "first", not: true, dir: "asc" },
  ];
  // The current #159 types will be replaced by #136's script model. Test the
  // actual saved JSON shape without reintroducing deleted block kinds.
  page.pageScripts = [{ id: "load-new", trigger: "load", pos: { x: 0, y: 0 },
    steps }] as unknown as typeof page.pageScripts;
  return { doc, page };
}

const response = { items: [
  { id: "first", price: 1 },
  { id: "second", price: 3 },
] };

const expected = (result: Record<string, unknown>) => {
  assert.equal(result.size, 2);
  assert.equal(result.total, 6);
  assert.equal(result.branch, "high");
  assert.equal(result.lastPrice, 6);
  assert.deepEqual(JSON.parse(JSON.stringify(result.selected)), response.items[1]);
  assert.deepEqual(JSON.parse(JSON.stringify(result.items)), [response.items[1]]);
};

test("the #136 document exports its pure transform, nested loop, conditions and list display", async () => {
  const { doc, page } = fixture();
  const plan = pageDataPlan(doc, page);
  assert.deepEqual(plan.steps.map((step) => step.kind), [
    "fetch", "transform", "transform", "transform", "transform",
    "for-each", "if", "repeat",
  ]);
  assert.ok(!JSON.stringify(plan).includes("editor"));
  const sandbox: Record<string, any> = {
    window: {}, location: { search: "?offset=2" }, URLSearchParams,
    document: { querySelector: () => ({ textContent: JSON.stringify(plan) }) },
    fetch: async () => ({
      ok: true, status: 200,
      headers: { get: () => null },
      text: async () => JSON.stringify(response),
    }),
    console,
  };
  runInNewContext(PAGE_DATA_RUNTIME, sandbox, { timeout: 5000 });
  expected(await sandbox.window.__pageDataReady);
});

test("the same #136 transform semantics run in native SSR without browser globals", async () => {
  const { doc, page } = fixture();
  const plan = pageDataPlan(doc, page);
  const uri = "data:text/javascript;base64," + Buffer.from(nativeDataModule()).toString("base64");
  const { loadPageData } = await import(uri);
  const vars = await loadPageData(plan, "?offset=2", async () => ({
    ok: true, status: 200,
    headers: { get: () => null },
    text: async () => JSON.stringify(response),
  }));
  expected(vars);
});

test("exported HTML carries the #136 page plan and executable data runtime", () => {
  const { doc, page } = fixture();
  // This test exercises the actual exported files, not only the interpreter.
  // Other starter pages include a dynamic [slug] path that HTML intentionally rejects.
  doc.pages = { [page.id]: page };
  doc.pageOrder = [page.id];
  const project = generateExportProject(doc, "html");
  const html = project.files["index.html"];
  assert.ok(html, "The HTML export must have a downloadable entry point");
  assert.match(html, /data-page-plan/);
  const planSource = html.split("data-page-plan>")[1]?.split("</script>")[0];
  assert.ok(planSource, "The generated HTML must embed a serializable page plan");
  const exported = JSON.parse(planSource);
  assert.equal(exported.steps.filter((s: { kind: string }) => s.kind === "transform").length, 4);
  assert.ok(project.files["data-loader.js"].includes("runPurePageSteps"));
  assert.ok(project.files["data-loader.js"].includes("evaluateValueRecipe"));
});

test("generated browser event runtime retains #136 transform and list-display actions", () => {
  const { doc, page } = fixture();
  doc.pages = { [page.id]: page };
  doc.pageOrder = [page.id];
  const node = doc.nodes[page.children[0]];
  node.scripts = [{
    id: "click-value", trigger: "click", pos: { x: 0, y: 0 },
    steps: [
      { id: "increment", kind: "transform", source: "total", into: "total",
        transform: { kind: "math", operation: "add", operand: 1 } },
      { id: "filter", kind: "list-display", mode: "filter", array: "items",
        field: "id", op: "eq", value: "second" },
    ],
  }] as unknown as typeof node.scripts;
  const project = generateExportProject(doc, "html");
  const html = project.files["index.html"];
  assert.match(html, /data-scripts=/);
  assert.ok(html.includes("transform"));
  assert.ok(html.includes("list-display"));
  assert.ok(project.files["scripts.js"].includes("Invalid value transform"));
  assert.ok(project.files["scripts.js"].includes("list-display"));
});

test("new #136 object-entries produces named entry rows in generated browser and SSR engines", async () => {
  const value = evaluateValueRecipe({ a: 1, b: 2 }, [{
    kind: "object-entries", keyField: "property", valueField: "content",
  }], {});
  assert.equal(value.kind, "value");
  if (value.kind === "value") {
    assert.deepEqual(JSON.parse(JSON.stringify(value.value)), [
      { property: "a", content: 1 }, { property: "b", content: 2 },
    ]);
  }
  const { doc, page } = fixture();
  page.pageScripts = [{ id: "entries-page", trigger: "load", pos: { x: 0, y: 0 },
    steps: [
      { id: "remote", kind: "fetch", as: "record", url: "https://data.example.test/record" },
      { id: "entries", kind: "transform", source: "record", into: "pairs",
        transform: { kind: "object-entries", keyField: "property", valueField: "content" } },
    ],
  }] as unknown as typeof page.pageScripts;
  doc.pages = { [page.id]: page };
  doc.pageOrder = [page.id];
  const exported = generateExportProject(doc, "sveltekit");
  const routesSource = exported.files["src/lib/site-routes.js"];
  const match = /^export const pages = (.*);$/m.exec(routesSource);
  assert.ok(match);
  const plan = JSON.parse(match[1])[0].plan;
  const uri = "data:text/javascript;base64," +
    Buffer.from(exported.files["src/lib/site-data.js"]).toString("base64");
  const { loadPageData } = await import(uri);
  const vars = await loadPageData(plan, "", async () => new Response(
    JSON.stringify({ first: 1, second: 2 }), { status: 200,
      headers: { "Content-Type": "application/json" } },
  ));
  const output = plan.steps.find((step: { kind: string }) => step.kind === "transform");
  assert.ok(output);
  assert.ok(Array.isArray(vars[output.into]));
  assert.deepEqual(JSON.parse(JSON.stringify(vars[output.into])), [
    { property: "first", content: 1 }, { property: "second", content: 2 },
  ]);
});

test("export preserves #136 variable references after obfuscating a transformation chain", async () => {
  const { doc, page } = fixture();
  page.pageScripts = [{ id: "chain", trigger: "load", pos: { x: 0, y: 0 },
    steps: [
      { id: "csv", kind: "set-var", into: "csv", value: "Alpha,Beta" },
      { id: "split", kind: "transform", source: "csv", into: "names",
        transform: { kind: "split", separator: "," } },
      { id: "count", kind: "transform", source: "names", into: "count",
        transform: { kind: "length" } },
    ],
  }] as unknown as typeof page.pageScripts;
  doc.pages = { [page.id]: page };
  doc.pageOrder = [page.id];
  const output = generateExportProject(doc, "sveltekit");
  const routes = output.files["src/lib/site-routes.js"];
  const match = /^export const pages = (.*);$/m.exec(routes);
  assert.ok(match);
  const steps = JSON.parse(match[1])[0].plan.steps;
  assert.equal(steps[1].source, steps[0].into);
  assert.equal(steps[2].source, steps[1].into);
  const { loadPageData } = await import("data:text/javascript;base64," +
    Buffer.from(output.files["src/lib/site-data.js"]).toString("base64"));
  const vars = await loadPageData({ steps, listOps: {} }, "", async () => {
    throw new Error("No network call expected");
  });
  assert.equal(vars[steps[2].into], 2);
});


test("#136 multiple if clauses retain AND-before-OR grouping in browser and SSR", async () => {
  const { doc, page } = fixture();
  page.pageScripts = [{ id: "joined", trigger: "load", pos: { x: 0, y: 0 },
    steps: [{
      id: "joined-if", kind: "if",
      cond: { subject: "var", target: "", left: "{flag}", op: "eq", value: "1" },
      conditions: [
        { subject: "var", target: "", left: "{mode}", op: "eq", value: "enabled", and: false },
        { subject: "var", target: "", left: "{mode}", op: "eq", value: "disabled", and: true },
      ],
      then: [{ id: "true", kind: "set-var", into: "result", value: "yes" }],
      else: [{ id: "false", kind: "set-var", into: "result", value: "no" }],
    }],
  }] as unknown as typeof page.pageScripts;
  const plan = pageDataPlan(doc, page);
  assert.equal(plan.steps.length, 1);
  assert.deepEqual((plan.steps[0] as { conditions?: unknown[] }).conditions?.length, 2);
  const sandbox: Record<string, any> = {
    window: {}, location: { search: "?flag=1&mode=other" }, URLSearchParams,
    document: { querySelector: () => ({ textContent: JSON.stringify(plan) }) }, console,
  };
  runInNewContext(PAGE_DATA_RUNTIME, sandbox, { timeout: 5000 });
  const browser = await sandbox.window.__pageDataReady;
  assert.equal(browser.result, "yes");
  const uri = "data:text/javascript;base64," + Buffer.from(nativeDataModule()).toString("base64");
  const { loadPageData } = await import(uri);
  const server = await loadPageData(plan, "?flag=1&mode=other");
  assert.equal(server.result, "yes");

  // Conditions involving an actual element cannot run during SSR. Preserve them
  // for the generated client script rather than silently skipping the if block.
  const conditional = (page.pageScripts![0].steps[0] as unknown as {
    conditions: Array<{ subject: string; target: string }>;
    id: string;
  });
  conditional.conditions[0].subject = "checked";
  conditional.conditions[0].target = "checkbox";
  const clientPlan = pageDataPlan(doc, page);
  assert.equal(clientPlan.steps.some((st) => st.kind === "if"), false);
  assert.equal(pageDataServerIds(doc, page).has(conditional.id), false);
});

test("#136 if condition arrays are serialized into emitted event scripts", () => {
  const { doc, page } = fixture();
  doc.pages = { [page.id]: page };
  doc.pageOrder = [page.id];
  const node = doc.nodes[page.children[0]];
  node.scripts = [{ id: "click", trigger: "click", pos: { x: 0, y: 0 },
    steps: [{ id: "if", kind: "if",
      cond: { subject: "var", target: "", left: "1", op: "eq", value: "1" },
      conditions: [{ subject: "var", target: "", left: "1", op: "eq", value: "2", and: false }],
      then: [{ id: "then", kind: "set-var", into: "result", value: "yes" }],
      else: [{ id: "else", kind: "set-var", into: "result", value: "no" }],
    }],
  }] as unknown as typeof node.scripts;
  const result = generateExportProject(doc, "html");
  assert.match(result.files["index.html"], /&quot;conditions&quot;/);
  assert.match(result.files["scripts.js"], /testIf/);
});
