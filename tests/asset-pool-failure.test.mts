import assert from "node:assert/strict";
import { test } from "node:test";
import JSZip from "jszip";
import { mapLimit, ASSET_FETCH_CONCURRENCY } from "../lib/assets";
import { exportProjectZip } from "../lib/exportZip";
import { createInitialDoc } from "../lib/presets";

const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test("a failed pool stays pending until its already running callbacks settle", async () => {
  const first = deferred<void>(), second = deferred<void>();
  const failure = new Error("first asset failed");
  const started: number[] = [];
  let settled = false;
  const result = mapLimit([0, 1, 2, 3], 2, async item => {
    started.push(item);
    await (item === 0 ? first.promise : second.promise);
  }).then(() => { settled = true; return null; }, error => { settled = true; return error; });
  try {
    assert.deepEqual(started, [0, 1]);
    first.reject(failure);
    await tick();
    assert.equal(settled, false, "callers must not retry while the previous batch is still running");
    second.resolve();
    assert.equal(await result, failure);
    assert.deepEqual(started, [0, 1], "queued callbacks must not start after failure");
  } finally {
    second.resolve();
    await result;
    await tick();
  }
});

for (const failure of [new Error("original failure"), undefined, null, 0]) {
  test(`a later worker failure preserves the first rejection (${String(failure)})`, async () => {
    const first = deferred<void>(), second = deferred<void>();
    const started: number[] = [];
    const result = mapLimit([0, 1, 2], 2, async item => {
      started.push(item);
      await (item === 0 ? first.promise : second.promise);
    }).then(() => ({ ok: true, error: null }), error => ({ ok: false, error }));
    first.reject(failure);
    await tick();
    second.reject(new Error("later failure"));
    assert.deepEqual(await result, { ok: false, error: failure });
    assert.deepEqual(started, [0, 1]);
  });
}

test("a synchronous callback failure does not launch more work", async () => {
  const failure = new Error("synchronous failure");
  const started: number[] = [];
  await assert.rejects(mapLimit([0, 1, 2], 2, item => {
    started.push(item);
    throw failure;
  }), error => error === failure);
  assert.deepEqual(started, [0]);
});

test("successful pools process every item once within their concurrency limit", async () => {
  for (const limit of [1, 3, 20]) {
    let active = 0, peak = 0;
    const completed: number[] = [];
    await mapLimit([0, 1, 2, 3, 4, 5, 6], limit, async item => {
      peak = Math.max(peak, ++active);
      await tick();
      completed.push(item);
      active--;
    });
    assert.deepEqual(completed.sort(), [0, 1, 2, 3, 4, 5, 6]);
    assert.equal(active, 0);
    assert.equal(peak, Math.min(limit, 7));
  }
  await mapLimit([], 6, async () => { assert.fail("empty pool called its callback"); });
});

test("ZIP failure stops queued downloads, then a fresh export retains all assets", { timeout: 10000 }, async () => {
  const doc = createInitialDoc();
  doc.siteName = "Pool regression";
  doc.assets = {};
  for (let i = 0; i < ASSET_FETCH_CONCURRENCY * 2; i++) {
    doc.assets[`asset-${i}`] = { id: `asset-${i}`, name: `asset-${i}.png`,
      path: `assets/asset-${i}.png`, mimeType: "image/png", width: 1, height: 1 };
  }
  const before = structuredClone(doc);
  const initialBatch = deferred<void>(), fail = deferred<Response>(), release = deferred<void>();
  const requests: string[] = [];
  const originalFetch = globalThis.fetch;
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL;
  const blobs: Blob[] = [];
  let clicks = 0, retry = false;
  Object.defineProperty(globalThis, "document", { configurable: true, value: {
    createElement() { return { href: "", download: "", click() { clicks++; } }; },
  } });
  URL.createObjectURL = blob => { blobs.push(blob as Blob); return "blob:pool-test"; };
  URL.revokeObjectURL = () => {};
  globalThis.fetch = async input => {
    const url = String(input);
    assert.match(url, /^\/api\/assets\/file\?path=/);
    requests.push(url);
    if (!retry) {
      if (requests.length === ASSET_FETCH_CONCURRENCY) initialBatch.resolve();
      if (requests.length === 1) return fail.promise;
      await release.promise;
    }
    return new Response(new Uint8Array([0, 1, 255]));
  };
  const result = exportProjectZip(doc).then(() => null, error => error);
  try {
    await initialBatch.promise;
    fail.resolve(new Response("unavailable", { status: 403 }));
    await tick();
    release.resolve();
    const error = await result;
    await tick();
    assert.match(error.message, /403/);
    assert.equal(requests.length, ASSET_FETCH_CONCURRENCY,
      "a rejected export must not keep fetching every queued asset");
    assert.equal(clicks, 0);
    assert.equal(blobs.length, 0);

    retry = true;
    requests.length = 0;
    assert.deepEqual(await exportProjectZip(doc), []);
    assert.equal(requests.length, ASSET_FETCH_CONCURRENCY * 2);
    assert.equal(clicks, 1);
    const zip = await JSZip.loadAsync(await blobs[0].arrayBuffer());
    for (let i = 0; i < ASSET_FETCH_CONCURRENCY * 2; i++) {
      assert.deepEqual(await zip.file(`pool-regression/public/assets/asset-${i}.png`)!.async("uint8array"),
        new Uint8Array([0, 1, 255]));
    }
    assert.deepEqual(doc, before);
  } finally {
    fail.resolve(new Response("unavailable", { status: 403 }));
    release.resolve();
    await result;
    await tick();
    globalThis.fetch = originalFetch;
    if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
    else Reflect.deleteProperty(globalThis, "document");
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  }
});
