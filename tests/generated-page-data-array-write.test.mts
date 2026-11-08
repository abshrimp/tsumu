import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";
import { nativeDataModule } from "../lib/generator/native-data";
import { PAGE_DATA_RUNTIME } from "../lib/generator/browser-data";
import { setVarPath } from "../lib/data";

type Loader = (plan: unknown, search: string, fetcher: (url: string) => Promise<Response>) => Promise<Record<string, unknown>>;

const moduleUrl = "data:text/javascript;base64," + Buffer.from(nativeDataModule()).toString("base64");
const { loadPageData } = await import(moduleUrl) as { loadPageData: Loader };

async function loadWith(mode: "native" | "browser", path: string, value: unknown): Promise<Record<string, unknown>> {
  const plan = {
    steps: [
      { id: "get-array", kind: "fetch", url: "/api/array", as: "items" },
      { id: "get-result", kind: "fetch", url: "/api/value", as: path },
    ],
    listOps: {},
  };
  const fetcher = async (url: string) =>
    new Response(JSON.stringify(url === "/api/array" ? ["first", "second"] : value), {
      headers: { "content-type": "application/json" },
    });
  if (mode === "native") return loadPageData(plan, "", fetcher);
  const window: { __pageDataReady?: Promise<Record<string, unknown>> } = {};
  vm.runInNewContext(PAGE_DATA_RUNTIME, {
    window, location: { search: "" },
    document: { querySelector: () => ({ textContent: JSON.stringify(plan) }) },
    fetch: fetcher, URLSearchParams, TextDecoder, TextEncoder, console,
  }, { timeout: 1000 });
  assert.ok(window.__pageDataReady);
  return window.__pageDataReady;
}

for (const mode of ["native", "browser"] as const) {
  test(mode + " page-data fetch cannot make an unbounded array using a nested output name", async () => {
    const actual = await loadWith(mode, "items.4294967294", "poison");
    const list = actual.items;
    assert.ok(Array.isArray(list));
    assert.equal(list.length, 2);
    assert.equal(Object.hasOwn(list, "4294967294"), false);
    assert.equal(JSON.stringify(list), '["first","second"]');
    const reference: Record<string, unknown> = { items: ["first", "second"] };
    setVarPath(reference, "items.4294967294", "poison");
    assert.equal(JSON.stringify(actual.items), JSON.stringify(reference.items));
  });

  test(mode + " page-data fetch does not change an array's internal length", async () => {
    const actual = await loadWith(mode, "items.length", 1);
    const reference: Record<string, unknown> = { items: ["first", "second"] };
    setVarPath(reference, "items.length", 1);
    assert.equal(Array.isArray(actual.items), false);
    assert.equal(JSON.stringify(actual.items), JSON.stringify(reference.items));
  });

  test(mode + " page-data fetch preserves safe nested array index updates", async () => {
    const actual = await loadWith(mode, "items.1", "updated");
    assert.equal(JSON.stringify(actual.items), '["first","updated"]');
  });

  test(mode + " page-data fetch stores __proto__ as an own property, not a prototype change", async () => {
    const actual = await loadWith(mode, "items.__proto__", { polluted: "yes" });
    assert.equal(Object.hasOwn(actual.items as object, "__proto__"), true);
    assert.equal(({} as Record<string, unknown>).polluted, undefined);
  });
}
