import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { createInitialDoc } from "../lib/presets";
import { pageDataPlan, PAGE_DATA_RUNTIME } from "../lib/generator/browser-data";
import { nativeDataModule } from "../lib/generator/native-data";
import { generateExportProject } from "../lib/export-formats";

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
