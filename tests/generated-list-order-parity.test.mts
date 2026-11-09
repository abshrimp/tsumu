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
  if (native) {
    runInNewContext(nativeDataModule().replace(/\bexport /g, "") + "\nglobalThis.run = loadPageData;", context);
    return JSON.parse(JSON.stringify((await context.run(plan, "", context.fetch)).rows));
  }
  runInNewContext(PAGE_DATA_RUNTIME, context);
  return JSON.parse(JSON.stringify((await context.window.__pageDataReady).rows));
}
for (const native of [false, true]) {
  for (const data of [[3, 1, 2], ["item10", "item2", "item1"], [[3], [1], [2]], [null, false, true]]) {
    test(`${native ? "native" : "browser"}: sorts raw rows ${JSON.stringify(data)} by their displayed value`, async () => {
      for (const dir of ["asc", "desc"] as const) {
        const ops: ListOp[] = [{ kind: "sort", field: "値", dir }];
        const result = await load(data, ops, native);
        assert.deepEqual(toListItems(result), applyList(toListItems(data), {}, ops));
        assert.deepEqual(toListItems(result).slice(0, 2), applyList(toListItems(data), { limit: 2 }, ops));
        assert.deepEqual([...result].sort(), [...data].sort(), "raw values stay raw, not wrapped objects");
      }
    });
  }
}
