import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { digPath } from "../lib/data";
import { lookupVar } from "../lib/vars";
import { evaluateValueRecipe } from "../lib/script-model/recipe-runtime";
import { PAGE_DATA_RUNTIME } from "../lib/generator/browser-data";
import { nativeDataModule } from "../lib/generator/native-data";

test("#136 JSON lookups ignore inherited properties but keep own special keys", () => {
  const data = JSON.parse('{"__proto__":{"ok":true},"constructor":{"name":"own"},"rows":[11,12]}');
  assert.equal(lookupVar(data, "__proto__.ok"), true);
  assert.equal(digPath(data, "__proto__.ok"), true);
  assert.equal(lookupVar(data, "constructor.name"), "own");
  assert.equal(lookupVar({}, "constructor"), undefined);
  assert.equal(lookupVar({}, "toString"), undefined);
  assert.equal(digPath({}, "__proto__.polluted"), undefined);
  assert.equal(digPath({}, "toString"), undefined);
  assert.equal(lookupVar({ rows: [11, 12] }, "rows.-1"), 12);
  assert.equal(digPath({ rows: [] }, "rows.-1"), undefined);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

test("#136 filter comparisons agree for arrays, missing fields and null", () => {
  const values = [
    { tags: ["x", "y"], name: "A" },
    { tags: ["x", null, "y"], name: null },
    { name: null },
    { tags: [], value: { toString: "not callable" } },
    {},
  ];
  const filter = (field: string, operation: "eq" | "empty", operand: string, not = false) =>
    evaluateValueRecipe(values, [{ kind: "filter", field, operation, operand, not }]);
  const list = (result: ReturnType<typeof filter>) =>
    result.kind === "value" ? result.value : result;
  assert.deepEqual(list(filter("tags", "eq", "x,y")), [values[0]]);
  assert.deepEqual(list(filter("name", "empty", "")), values.slice(1));
  assert.deepEqual(list(filter("name", "empty", "", true)), [values[0]]);
  const object = evaluateValueRecipe(values[3].value, [{
    kind: "compare", operation: "eq", operand: "[object Object]",
  }]);
  assert.deepEqual(object, { kind: "value", value: true });
});

test("generated browser and SSR engines avoid inherited-key reads and nested __proto__ writes", async () => {
  const plan = {
    steps: [
      { kind: "transform", id: "fallback", source: "constructor", into: "safe",
        transform: { kind: "fallback", text: "default" } },
      { kind: "transform", id: "missing", source: "__proto__.polluted", into: "clean",
        transform: { kind: "fallback", text: "not inherited" } },
      { kind: "fetch", id: "api", url: "/api/test.json", as: "nested.__proto__.polluted" },
    ],
    listOps: {},
  };
  const response = async () => new Response("42", {
    headers: { "content-type": "application/json" }, status: 200,
  });
  const sandbox: Record<string, any> = {
    window: {}, location: { search: "" }, URLSearchParams,
    document: { querySelector: () => ({ textContent: JSON.stringify(plan) }) },
    fetch: response, console,
  };
  runInNewContext(PAGE_DATA_RUNTIME, sandbox, { timeout: 5000 });
  const browser = await sandbox.window.__pageDataReady as Record<string, unknown>;
  assert.equal(browser.safe, "default");
  assert.equal(browser.clean, "not inherited");
  assert.equal((browser.nested as Record<string, unknown>).__proto__ &&
    (browser.nested as Record<string, Record<string, unknown>>)["__proto__"].polluted, 42);

  const url = "data:text/javascript;base64," + Buffer.from(nativeDataModule()).toString("base64");
  const { loadPageData } = await import(url);
  const server = await loadPageData(plan, "", response);
  assert.equal(server.safe, browser.safe);
  assert.equal(server.clean, browser.clean);
  assert.equal(server.nested["__proto__"].polluted, 42);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});


test("#136 gte/lte list-display filters yield identical browser and SSR results", async () => {
  const rows = [
    { tag: ["x", "y"], score: 9 },
    { tag: ["x", "y"], score: 10 },
    { tag: ["x", null, "y"], score: 15 },
    { tag: ["x", "y"], score: 20 },
    { tag: null, score: 21 },
  ];
  const plan = {
    steps: [{ id: "fetch", kind: "fetch", as: "items", url: "/api/rows.json" }],
    listOps: { items: [
      { kind: "filter", conds: [{ field: "tag", op: "eq", value: "x,y" }] },
      { kind: "filter", conds: [
        { field: "score", op: "gte", value: "10" },
        { field: "score", op: "lte", value: "20", and: true },
      ] },
    ] },
  };
  const response = async () => new Response(JSON.stringify(rows), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
  const sandbox: Record<string, any> = {
    window: {}, location: { search: "" }, URLSearchParams,
    document: { querySelector: () => ({ textContent: JSON.stringify(plan) }) },
    fetch: response, console,
  };
  runInNewContext(PAGE_DATA_RUNTIME, sandbox, { timeout: 5000 });
  const browser = await sandbox.window.__pageDataReady;
  const uri = "data:text/javascript;base64," + Buffer.from(nativeDataModule()).toString("base64");
  const { loadPageData } = await import(uri);
  const server = await loadPageData(plan, "", response);
  for (const result of [browser, server]) {
    assert.deepEqual(JSON.parse(JSON.stringify(result.items)), [rows[1], rows[3]]);
  }
});
