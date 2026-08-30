import assert from "node:assert/strict";
import { test } from "node:test";
import JSZip from "jszip";
import { mapLimit, ASSET_FETCH_CONCURRENCY, fetchWithRetry } from "../lib/assets";
import { exportProjectZip } from "../lib/exportZip";
import { createInitialDoc } from "../lib/presets";

const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function timely<T>(pending: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([pending, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("failed asset work did not stop promptly")), 500);
    })]);
  } finally { clearTimeout(timer); }
}

test("a failed pool rejects even when a running callback never settles, without starting queued work", async () => {
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
    assert.equal(await timely(result), failure);
    assert.equal(settled, true, "an unresponsive sibling must not suppress a confirmed failure");
    second.resolve();
    await tick();
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

for (const stalled of ["fetch", "body"] as const) test(`ZIP failure aborts a stalled ${stalled} and queued downloads, then a fresh export retains all assets`, { timeout: 10000 }, async () => {
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
  let clicks = 0, retry = false, aborted = 0;
  Object.defineProperty(globalThis, "document", { configurable: true, value: {
    createElement() { return { href: "", download: "", click() { clicks++; } }; },
  } });
  URL.createObjectURL = blob => { blobs.push(blob as Blob); return "blob:pool-test"; };
  URL.revokeObjectURL = () => {};
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    assert.match(url, /^\/api\/assets\/file\?path=/);
    requests.push(url);
    if (!retry) {
      if (requests.length === ASSET_FETCH_CONCURRENCY) initialBatch.resolve();
      if (requests.length === 1) return fail.promise;
      const signal = init?.signal;
      if (stalled === "fetch") {
        await new Promise<void>((resolve, reject) => {
          const onAbort = () => { aborted++; reject(signal!.reason); };
          signal?.addEventListener("abort", onAbort, { once: true });
          if (signal?.aborted) onAbort();
          release.promise.then(() => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
          });
        });
      } else {
        return new Response(new ReadableStream<Uint8Array>({
          start(controller) {
            const onAbort = () => { aborted++; controller.error(signal!.reason); };
            signal?.addEventListener("abort", onAbort, { once: true });
            if (signal?.aborted) onAbort();
            release.promise.then(() => {
              signal?.removeEventListener("abort", onAbort);
              if (signal?.aborted) return;
              controller.enqueue(new Uint8Array([0, 1, 255]));
              controller.close();
            });
          },
        }));
      }
    }
    return new Response(new Uint8Array([0, 1, 255]));
  };
  const result = exportProjectZip(doc).then(() => null, error => error);
  try {
    await initialBatch.promise;
    fail.resolve(new Response("unavailable", { status: 403 }));
    const error = await timely(result);
    await tick();
    assert.match(error.message, /403/);
    assert.equal(aborted, ASSET_FETCH_CONCURRENCY - 1, "active fetches and body reads are cancelled");
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

test("asset retries stop immediately when the caller aborts during backoff", async () => {
  const previousFetch = globalThis.fetch;
  const controller = new AbortController();
  const failure = new Error("export cancelled");
  const fetched = deferred<void>();
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    fetched.resolve();
    return new Response("busy", { status: 503 });
  };
  const result = fetchWithRetry("/asset", 3, { signal: controller.signal });
  try {
    await fetched.promise;
    await tick();
    controller.abort(failure);
    await assert.rejects(timely(result), error => error === failure);
    assert.equal(calls, 1);
    await assert.rejects(fetchWithRetry("/asset", 3, { signal: controller.signal }), error => error === failure);
    assert.equal(calls, 1, "already aborted work must not issue a request");
  } finally {
    await result.catch(() => {});
    globalThis.fetch = previousFetch;
  }
});
