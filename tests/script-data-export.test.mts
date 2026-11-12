import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { createInitialDoc } from "../lib/presets";
import { runPurePageSteps } from "../lib/page-load-steps";
import { lookupVar, interpolate } from "../lib/vars";
import { pageDataPlan, pageDataServerIds, PAGE_DATA_RUNTIME } from "../lib/generator/browser-data";
import { nativeDataModule } from "../lib/generator/native-data";
import { generateExportProject } from "../lib/export-formats";
import { evaluateValueRecipe } from "../lib/script-model/recipe-runtime";

function fixture() {
  const doc = createInitialDoc();
  const page = doc.pages[doc.pageOrder[0]];
  const steps = [
    { id: "fetch", kind: "fetch", as: "data", url: "https://data.example.test/items",
      preview: { sample: { items: [{ id: "editor", price: 99 }] } } },
    { id: "items", kind: "transform", source: "data", into: "items",
      transform: { kind: "field", key: "items" } },
    { id: "size", kind: "transform", source: "items", into: "size",
      transform: { kind: "length" } },
    { id: "math", kind: "transform", source: "size", into: "total",
      transform: { kind: "math", operation: "add", operand: "offset", operandType: "variable" } },
    { id: "empty-selected", kind: "set-var", value: "null", into: "selected" },
    { id: "lookup", kind: "for-each", array: "items", then: [
      { id: "match-id", kind: "if", cond: { subject: "var", target: "",
        left: "{ループ.値.id}", op: "eq", value: "second" }, then: [
        { id: "selected", kind: "set-var", into: "selected", value: "{ループ.値}" },
        { id: "stop", kind: "break-loop" },
      ] },
    ] },
    { id: "each", kind: "for-each", array: "items", then: [
      { id: "per-item", kind: "transform", source: "price", into: "lastPrice",
        transform: { kind: "math", operation: "multiply", operandType: "number", operand: 2 } },
    ] },
    { id: "conditional", kind: "if", cond: { subject: "var", left: "{total}",
      op: "gt", value: "3" }, then: [
      { id: "yes", kind: "set-var", into: "branch", value: "high" },
    ], else: [{ id: "no", kind: "set-var", into: "branch", value: "low" }] },
    { id: "repeat", kind: "repeat", times: 2, then: [
      { id: "inc", kind: "transform", source: "total", into: "total",
        transform: { kind: "math", operation: "add", operandType: "number", operand: 1 } },
    ] },
    { id: "list", kind: "list-display", mode: "filter", array: "items",
      field: "id", op: "eq", value: "first", not: true, dir: "asc" },
  ];
  page.pageScripts = [{ id: "load-new", trigger: "load", pos: { x: 0, y: 0 },
    steps }] as unknown as typeof page.pageScripts;
  return { doc, page };
}

const response = { items: [
  { id: "first", price: 1 },
  { id: "second", price: 3 },
] };

const expected = (result: Record<string, unknown>, shown: unknown) => {
  assert.equal(result.size, 2);
  assert.equal(result.total, 6);
  assert.equal(result.branch, "high");
  assert.equal(result.lastPrice, 6);
  assert.deepEqual(JSON.parse(JSON.stringify(result.selected)), response.items[1]);
  assert.deepEqual(JSON.parse(JSON.stringify(result.items)), response.items);
  assert.deepEqual(JSON.parse(JSON.stringify(shown)), [response.items[1]]);
};

test("the document exports its pure transform, nested loop, conditions and list display", async () => {
  const { doc, page } = fixture();
  const plan = pageDataPlan(doc, page);
  assert.deepEqual(plan.steps.map((step) => step.kind), [
    "fetch", "transform", "transform", "transform", "set-var",
    "for-each", "for-each", "if", "repeat",
  ]);
  assert.ok(!JSON.stringify(plan).includes("editor"));
  const sandbox: Record<string, any> = {
    window: {}, location: { search: "?offset=2" }, URLSearchParams, TextDecoder, TextEncoder,
    document: { querySelector: () => ({ textContent: JSON.stringify(plan) }) },
    fetch: async () => ({
      ok: true, status: 200,
      headers: { get: () => null },
      text: async () => JSON.stringify(response),
    }),
    console,
  };
  runInNewContext(PAGE_DATA_RUNTIME, sandbox, { timeout: 5000 });
  const vars = await sandbox.window.__pageDataReady;
  expected(vars, sandbox.window.__pageListRows(vars.items, "items", vars));
});

test("the same transform semantics run in native SSR without browser globals", async () => {
  const { doc, page } = fixture();
  const plan = pageDataPlan(doc, page);
  const uri = "data:text/javascript;base64," + Buffer.from(nativeDataModule()).toString("base64");
  const { loadPageData, listItemsWithOps } = await import(uri);
  const vars = await loadPageData(plan, "?offset=2", async () => ({
    ok: true, status: 200,
    headers: { get: () => null },
    text: async () => JSON.stringify(response),
  }));
  expected(vars, listItemsWithOps(plan.listOps, vars, "items", 0));
});

test("exported HTML carries the page plan and executable data runtime", () => {
  const { doc, page } = fixture();
  // このテストは、インタープリターだけでなく、実際に書き出したファイルを動かす。
  // 初期の他のページには、HTML が意図的に拒否する動的な [slug] のパスが含まれる。
  doc.pages = { [page.id]: page };
  doc.pageOrder = [page.id];
  const project = generateExportProject(doc, "html");
  const html = project.files["index.html"];
  assert.ok(html, "The HTML export must have a downloadable entry point");
  assert.match(html, /data-page-plan/);
  const planSource = html.split("data-page-plan>")[1]?.split("</script>")[0];
  assert.ok(planSource, "The generated HTML must embed a serializable page plan");
  const exported = JSON.parse(planSource);
  assert.equal(exported.steps.filter((s: { kind: string }) => s.kind === "transform").length, 3);
  assert.ok(project.files["data-loader.js"].includes("runPurePageSteps"));
  assert.ok(project.files["data-loader.js"].includes("evaluateValueRecipe"));
});

test("generated browser event runtime retains transform and list-display actions", () => {
  const { doc, page } = fixture();
  doc.pages = { [page.id]: page };
  doc.pageOrder = [page.id];
  const node = doc.nodes[page.children[0]];
  node.scripts = [{
    id: "click-value", trigger: "click", pos: { x: 0, y: 0 },
    steps: [
      { id: "increment", kind: "transform", source: "total", into: "total",
        transform: { kind: "math", operation: "add", operandType: "number", operand: 1 } },
      { id: "filter", kind: "list-display", mode: "filter", array: "items",
        field: "id", op: "eq", value: "second" },
    ],
  }] as unknown as typeof node.scripts;
  const project = generateExportProject(doc, "html");
  const html = project.files["index.html"];
  assert.match(html, /data-scripts=/);
  assert.ok(html.includes("transform"));
  assert.ok(html.includes("list-display"));
  assert.ok(project.files["scripts.js"].includes("Value transform failed:"));
  assert.ok(project.files["scripts.js"].includes("list-display"));
});


test("dictionary entries are expanded into rows using ordinary loops in generated SSR", async () => {
  const { doc, page } = fixture();
  page.pageScripts = [{ id: "entries-page", trigger: "load", pos: { x: 0, y: 0 },
    steps: [
      { id: "remote", kind: "fetch", as: "record", url: "https://data.example.test/record" },
      { id: "empty", kind: "set-var", into: "pairs", value: "[]" },
      { id: "entries", kind: "for-each", array: "record", then: [
        { id: "init", kind: "set-var", into: "entry", value: "{}" },
        { id: "property", kind: "set-list-item", list: "entry", key: "property", value: "{ループ.キー}" },
        { id: "content", kind: "set-list-item", list: "entry", key: "content", value: "{ループ.値}" },
        { id: "append", kind: "set-list-item", list: "pairs", key: "", value: "{entry}" },
      ] },
    ],
  }] as unknown as typeof page.pageScripts;
  doc.pages = { [page.id]: page };
  doc.pageOrder = [page.id];
  const exported = generateExportProject(doc, "sveltekit");
  const routesSource = exported.files["src/lib/site-routes.js"];
  const routeModule = await import("data:text/javascript;base64," + Buffer.from(routesSource).toString("base64"));
  const plan = routeModule.pages[0].plan;
  const uri = "data:text/javascript;base64," +
    Buffer.from(exported.files["src/lib/site-data.js"]).toString("base64");
  const { loadPageData } = await import(uri);
  const vars = await loadPageData(plan, "", async () => new Response(
    JSON.stringify({ first: 1, second: 2 }), { status: 200,
      headers: { "Content-Type": "application/json" } },
  ));
  const output = plan.steps.find((step: { kind: string; value?: string }) =>
    step.kind === "set-var" && step.value === "[]");
  assert.ok(output && "into" in output, "Generated plan must include the output list");
  assert.deepEqual(JSON.parse(JSON.stringify(vars[output.into])), [
    { property: "first", content: 1 }, { property: "second", content: 2 },
  ]);
});
test("export preserves variable references after obfuscating a transformation chain", async () => {
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
  const routeModule = await import("data:text/javascript;base64," + Buffer.from(routes).toString("base64"));
  const steps = routeModule.pages[0].plan.steps;
  assert.equal(steps[1].source, steps[0].into);
  assert.equal(steps[2].source, steps[1].into);
  const { loadPageData } = await import("data:text/javascript;base64," +
    Buffer.from(output.files["src/lib/site-data.js"]).toString("base64"));
  const vars = await loadPageData({ steps, listOps: {} }, "", async () => {
    throw new Error("No network call expected");
  });
  assert.equal(vars[steps[2].into], 2);
});


test("multiple if clauses retain AND-before-OR grouping in browser and SSR", async () => {
  const { doc, page } = fixture();
  page.pageScripts = [{ id: "joined", trigger: "load", pos: { x: 0, y: 0 },
    steps: [{
      id: "joined-if", kind: "if",
      cond: { subject: "var", target: "", left: "{flag}", op: "eq", value: '\"1\"' },
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
    window: {}, location: { search: "?flag=1&mode=other" }, URLSearchParams, TextDecoder, TextEncoder,
    document: { querySelector: () => ({ textContent: JSON.stringify(plan) }) }, console,
  };
  runInNewContext(PAGE_DATA_RUNTIME, sandbox, { timeout: 5000 });
  const browser = await sandbox.window.__pageDataReady;
  assert.equal(browser.result, "yes");
  const uri = "data:text/javascript;base64," + Buffer.from(nativeDataModule()).toString("base64");
  const { loadPageData } = await import(uri);
  const server = await loadPageData(plan, "?flag=1&mode=other");
  assert.equal(server.result, "yes");

  // 実際の要素が関わる条件は、SSR の間には実行できない。「もし」のブロックを黙って飛ばさず、
  // 生成したクライアントのスクリプトのために残す。
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

test("if condition arrays are serialized into emitted event scripts", () => {
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
  assert.match(result.files["scripts.js"], /testConditions/);
});



test("missing field values clear stale data before a following fallback", () => {
  const vars: Record<string, unknown> = {
    records: [{ name: "first" }], selected: "stale",
  };
  const steps = [
    { kind: "transform", source: "records.0", into: "selected",
      transform: { kind: "field", key: "unknown" } },
    { kind: "transform", source: "selected", into: "selected",
      transform: { kind: "fallback", text: "not found" } },
  ];
  assert.equal(runPurePageSteps(steps as any, vars,
    (scope, name) => lookupVar(scope, name), interpolate, evaluateValueRecipe), true);
  assert.equal(vars.selected, "not found");
});
test("blank additional if clauses are ignored when evaluating exported page data", () => {
  const vars: Record<string, unknown> = { enabled: "yes" };
  const steps = [{
    kind: "if",
    cond: { subject: "var", left: "{enabled}", op: "eq", value: "yes" },
    conditions: [{ subject: "var", left: "", op: "eq", value: "", not: true, and: true }],
    then: [{ kind: "set-var", into: "result", value: "accepted" }],
    else: [{ kind: "set-var", into: "result", value: "rejected" }],
  }];
  assert.equal(runPurePageSteps(steps as any, vars,
    (scope, name) => lookupVar(scope, name), interpolate, evaluateValueRecipe), true);
  assert.equal(vars.result, "accepted");
});


test("value-transform sort uses natural Japanese numeric collation", () => {
  const items = [{ title: "10" }, { title: "2" }, { title: "1" }];
  const result = evaluateValueRecipe(items,
    [{ kind: "sort", field: "title", direction: "asc" }], {});
  assert.equal(result.kind, "value");
  if (result.kind === "value") {
    assert.deepEqual(result.value, [items[2], items[1], items[0]]);
  }
  assert.deepEqual(items.map((i) => i.title), ["10", "2", "1"]);
});


test("incomplete OR clause retains the OR group before a later AND clause", () => {
  for (const input of [
    { a: "no", c: "yes", expected: "accepted" },
    { a: "yes", c: "no", expected: "accepted" },
    { a: "no", c: "no", expected: "rejected" },
  ]) {
    const vars: Record<string, unknown> = { a: input.a, c: input.c };
    const steps = [{
      kind: "if", cond: { subject: "var", left: "{a}", op: "eq", value: "yes" },
      conditions: [
        { subject: "var", left: "", op: "eq", value: "", and: false },
        { subject: "var", left: "{c}", op: "eq", value: "yes", and: true },
      ],
      then: [{ kind: "set-var", into: "result", value: "accepted" }],
      else: [{ kind: "set-var", into: "result", value: "rejected" }],
    }];
    assert.equal(runPurePageSteps(steps as any, vars,
      (scope, name) => lookupVar(scope, name), interpolate, evaluateValueRecipe), true);
    assert.equal(vars.result, input.expected);
  }
});


test("empty OR filtering preserves group boundaries in browser and SSR", async () => {
  const doc = createInitialDoc();
  const page = doc.pages[doc.pageOrder[0]];
  page.pageScripts = [{ id: "load", trigger: "load", pos: { x: 0, y: 0 }, steps: [
    { id: "fetch", kind: "fetch", url: "https://public.example.test/items.json", as: "items" },
    { id: "filter", kind: "list-display", mode: "filter", array: "items",
      field: "status", op: "eq", value: "ready",
      or: [
        { field: "", op: "eq", value: "", and: false },
        { field: "status", op: "eq", value: "pending", and: true },
      ],
    },
  ] }] as unknown as typeof page.pageScripts;
  const plan = pageDataPlan(doc, page);
  const operations = (plan.listOps as Record<string, Array<{
    kind: string; conds?: Array<{ field: string; and?: boolean }>;
  }>>).items;
  assert.equal(operations?.[0]?.conds?.[1]?.and, false);
  const rows = [
    { status: "ready", title: "A" },
    { status: "pending", title: "B" },
    { status: "disabled", title: "C" },
  ];
  const respond = async () => new Response(JSON.stringify(rows),
    { status: 200, headers: { "content-type": "application/json" } });
  const sandbox: Record<string, any> = {
    window: {}, location: { search: "" }, URLSearchParams, TextDecoder, TextEncoder,
    document: { querySelector: () => ({ textContent: JSON.stringify(plan) }) },
    fetch: respond, console,
  };
  runInNewContext(PAGE_DATA_RUNTIME, sandbox, { timeout: 5000 });
  const browser = await sandbox.window.__pageDataReady;
  const uri = "data:text/javascript;base64," + Buffer.from(nativeDataModule()).toString("base64");
  const { loadPageData, listItemsWithOps } = await import(uri);
  const server = await loadPageData(plan, "", respond);
  assert.deepEqual(JSON.parse(JSON.stringify(browser.items)), rows);
  assert.deepEqual(JSON.parse(JSON.stringify(server.items)), rows);
  for (const shown of [sandbox.window.__pageListRows(browser.items, "items", browser),
    listItemsWithOps(plan.listOps, server, "items", 0)]) {
    assert.deepEqual(JSON.parse(JSON.stringify(shown)), rows.slice(0, 2));
  }
});


test("unfinished if conditions remain neutral and preserve OR groups", () => {
  const unfinished = { subject: "var", target: "", left: "", op: "eq", value: "", and: false };
  const yes = { subject: "var", target: "", left: "{status}", op: "eq", value: "yes", and: true };
  for (const [status, accepted] of [["yes", true], ["no", false]] as const) {
    const vars: Record<string, unknown> = { status };
    const steps = [{
      kind: "if",
      cond: { subject: "var", target: "", left: "{status}", op: "eq", value: "no", not: true },
      conditions: [unfinished, yes],
      then: [{ kind: "set-var", into: "accepted", value: "true" }],
      else: [{ kind: "set-var", into: "accepted", value: "false" }],
    }];
    assert.equal(runPurePageSteps(steps as any, vars, lookupVar, interpolate, evaluateValueRecipe), true);
    assert.equal(vars.accepted, accepted);
  }
});
