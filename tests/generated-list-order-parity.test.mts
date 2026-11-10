import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { PAGE_DATA_RUNTIME } from "../lib/generator/browser-data";
import { nativeDataModule } from "../lib/generator/native-data";
import { applyList, toListItems, type ListOp } from "../lib/data";

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
