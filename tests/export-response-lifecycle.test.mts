import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import vm from "node:vm";
import { fetchWithRetry, readAssetBytes } from "../lib/assets";
import { readRestoreJson } from "../lib/publish-security";
import { toSingleHtmlProject } from "../lib/generator/single-html";
import { retainImportedDependencies } from "../lib/generator/imported-dependencies";
import { PAGE_DATA_RUNTIME } from "../lib/generator/browser-data";
import { nativeDataModule } from "../lib/generator/native-data";
import type { Asset, SiteDoc } from "../lib/types";

async function withoutCleanupWait<T>(work: Promise<T>, timeout = 500): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("operation waited for unread response sibling")), timeout);
      }),
    ]);
  } finally { clearTimeout(timer); }
}

function clonedResponse(t: TestContext, init?: ResponseInit, body: BodyInit = '{"value":"too large"}') {
  const original = new Response(body, init);
  const response = original.clone();
  t.after(() => { void original.body?.cancel().catch(() => {}); });
  return response;
}

for (const [name, read, error] of [
  ["history restore", readRestoreJson, /編集データが大きすぎます/],
  ["asset export", readAssetBytes, /Resource exceeds export size limit/],
] as const) {
  for (const declared of [false, true]) {
    test(`${name} rejects ${declared ? "declared" : "streamed"} oversize without waiting for an unread cloned body`, async (t) => {
      const response = clonedResponse(t, { headers: declared ? { "Content-Length": "100" } : {} });
      await assert.rejects(withoutCleanupWait(read(response, 4)), error);
      assert.equal(response.bodyUsed, true, "rejected response starts cleanup");
      assert.equal(response.body!.locked, false);
    });
  }
}

test("single HTML rejects a failed resource without waiting for its cloned body", async (t) => {
  const response = clonedResponse(t, { status: 404 });
  const source = {
    files: { "index.html": '<img src="https://cdn.example.test/missing.png">' },
    binaries: {}, remoteAssets: {},
  };
  await assert.rejects(withoutCleanupWait(toSingleHtmlProject(source, async () => response)), /resource \(404\)/);
  assert.equal(response.bodyUsed, true);
});

test("partial export rejects a failed imported module without waiting for its cloned body", async (t) => {
  const response = clonedResponse(t, { status: 404 });
  t.mock.method(globalThis, "fetch", async () => response);
  const asset: Asset = {
    id: "module", name: "main.js", width: 0, height: 0,
    mimeType: "text/javascript", dataUrl: "data:text/javascript,export{}",
    zip: { version: 1, group: "zip_test", path: "main.js" },
  };
  const scoped: SiteDoc = { siteName: "Test", pages: {}, pageOrder: [], nodes: {}, assets: { module: asset } };
  await assert.rejects(withoutCleanupWait(retainImportedDependencies(scoped, scoped.assets)), /Could not read the imported module/);
  assert.equal(response.bodyUsed, true);
});

test("asset retry proceeds while a failed response's cloned body remains unread", async (t) => {
  const response = clonedResponse(t, { status: 503 });
  const recovered = new Response("asset contents");
  let attempts = 0;
  t.mock.method(globalThis, "fetch", async () => ++attempts === 1 ? response : recovered);
  assert.equal(await withoutCleanupWait(fetchWithRetry("https://cdn.example.test/asset", 2), 1500), recovered);
  assert.equal(attempts, 2);
  assert.equal(response.bodyUsed, true);
});

for (const runtime of ["browser", "native SSR"] as const) {
  for (const failure of ["HTTP error", "declared size", "streamed size"] as const) {
    test(`generated ${runtime} data loading settles after ${failure} with an unread cloned body`, async (t) => {
      const maxBytes = 5 * 1024 * 1024;
      const response = clonedResponse(t, {
        status: failure === "HTTP error" ? 404 : 200,
        headers: failure === "declared size" ? { "Content-Length": String(maxBytes + 1) } : {},
      }, failure === "streamed size" ? new Uint8Array(maxBytes + 1) : "{}");
      const plan = { steps: [{ id: "fetch", kind: "fetch", url: "https://data.example.test/items", as: "rows" }] };
      let result: Promise<Record<string, unknown>>;
      if (runtime === "browser") {
        const window: { __pageDataReady?: Promise<Record<string, unknown>> } = {};
        vm.runInNewContext(PAGE_DATA_RUNTIME, {
          window, location: { search: "" }, URLSearchParams, TextDecoder, TextEncoder,
          document: { querySelector: () => ({ textContent: JSON.stringify(plan) }) },
          fetch: async () => response, console: { warn() {} },
        }, { timeout: 1000 });
        assert.ok(window.__pageDataReady);
        result = window.__pageDataReady;
      } else {
        t.mock.method(console, "warn", () => {});
        const source = "data:text/javascript;base64," + Buffer.from(nativeDataModule()).toString("base64");
        const module = await import(source);
        result = module.loadPageData(plan, "", async () => response);
      }
      const values = await withoutCleanupWait(result);
      assert.equal(values.rows, null);
      assert.equal(response.bodyUsed, true, "failed fetch starts cleanup");
      assert.equal(response.body!.locked, false);
    });
  }
}
