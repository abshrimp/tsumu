import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { PAGE_DATA_RUNTIME } from "../lib/generator/browser-data";
import { nativeDataModule } from "../lib/generator/native-data";
import { fetchRequestOf, type FetchOptions } from "../lib/fetch-request";

async function generated(options: FetchOptions, native: boolean, vars: Record<string, string> = {}) {
  let request: any;
  const step = { id: "fetch", kind: "fetch", as: "data", url: "https://example.test/data", ...options };
  const context: any = {
    window: {}, location: { search: new URLSearchParams(vars).toString() }, URLSearchParams, TextDecoder, TextEncoder,
    document: { querySelector: () => ({ textContent: JSON.stringify({ steps: [step] }) }) },
    console: { warn() {} },
    fetch: async (_url: string, init: unknown) => { request = JSON.parse(JSON.stringify(init)); return { ok: true, headers: { get: () => null }, text: async () => "{}" }; },
  };
  if (native) {
    runInNewContext(nativeDataModule().replace(/\bexport /g, "") + "\nglobalThis.run = loadPageData;", context);
    await context.run({ steps: [step] }, context.location.search, context.fetch);
  } else {
    runInNewContext(PAGE_DATA_RUNTIME, context);
    await context.window.__pageDataReady;
  }
  assert.ok(request, "request must reach fetch");
  return request;
}
const normalized = (value: any) => ({ method: value?.method ?? "GET", headers: value?.headers ?? {}, ...(value?.body !== undefined ? { body: value.body } : {}) });
for (const native of [false, true]) {
  const variant = native ? "native SSR/module" : "browser loader";
  for (const method of ["GET", "DELETE", "POST", "PUT", "PATCH"] as const) test(`${variant}: ${method} payload matches editor request`, async () => {
    const options = { method, body: '{"value":"{name}"}' }, vars = { name: "value" };
    assert.deepEqual(await generated(options, native, vars), normalized(fetchRequestOf(options, vars)));
  });
  for (const name of ["Content-Type", "content-type", " CONTENT-TYPE "]) test(`${variant}: preserves explicit ${name}`, async () => {
    const options: FetchOptions = { method: "POST", body: '{"value":1}', headers: [{ name, value: "application/vnd.example+json" }] };
    assert.deepEqual(await generated(options, native), normalized(fetchRequestOf(options, {})));
  });
  test(`${variant}: escaped literal braces remain valid JSON`, async () => {
    for (let count = 0; count <= 8; count++) {
      const options: FetchOptions = { method: "POST", body: JSON.stringify({ literal: "\\".repeat(count) + "{name}", dynamic: "{name}" }) };
      const actual = await generated(options, native, { name: "a\"b" });
      assert.deepEqual(actual, normalized(fetchRequestOf(options, { name: "a\"b" })));
      assert.doesNotThrow(() => JSON.parse(actual.body));
    }
  });
}
