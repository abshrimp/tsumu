import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { transformSync } from "esbuild";
import * as source from "../lib/safe-fetch";
import { SAFE_FETCH_SOURCE } from "../lib/generator/safe-fetch-source";

const generatedModule = { exports: {} };
new Function("module", "exports", transformSync(SAFE_FETCH_SOURCE, {
  loader: "ts", format: "cjs",
}).code)(generatedModule, generatedModule.exports);
const runtimes = { source, generated: generatedModule.exports as typeof source };

// A cloned Response uses tee: cancelling one branch waits for the unread sibling.
// Keep that sibling alive until the assertion so cleanup cannot mask a deadlock.
function clonedResponse(t: TestContext, init?: ResponseInit, request?: AbortController) {
  const original = new Response("unused body", init);
  t.after(() => {
    // An aborted redirect must not resume after the fetch mock is restored.
    request?.abort();
    void original.body?.cancel().catch(() => {});
  });
  return original.clone();
}

async function withoutCancellationWait<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("operation is waiting for upstream cancellation")), 1_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function selectNative(t: TestContext, worker: boolean) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", {
    configurable: true, value: { userAgent: worker ? "Cloudflare-Workers" : "Node.js" },
  });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "navigator", previous);
    else Reflect.deleteProperty(globalThis, "navigator");
  });
}

for (const [name, runtime] of Object.entries(runtimes)) {
  for (const [transport, url] of Object.entries({
    IPv4: "https://8.8.8.8/start",
    IPv6: "https://[2606:4700::1111]/start",
    Workers: "https://public.example.test/start",
  })) {
    test(`${name}: ${transport} rejects a private redirect without waiting for a cloned body`, async (t) => {
      selectNative(t, transport === "Workers");
      const response = clonedResponse(t, { status: 302, headers: { location: "http://127.0.0.1/private" } });
      const outbound = t.mock.method(globalThis, "fetch", async () => response);
      await assert.rejects(withoutCancellationWait(runtime.fetchPublic(url, {})), runtime.BlockedUrlError);
      assert.equal(outbound.mock.callCount(), 1);
      assert.equal(response.bodyUsed, true, "discard the redirect body even though cancellation is pending");
    });

    test(`${name}: ${transport} follows an allowed redirect without waiting for a cloned body`, async (t) => {
      selectNative(t, transport === "Workers");
      const request = new AbortController();
      const response = clonedResponse(t, { status: 302, headers: { location: "/next" } }, request);
      const sent: string[] = [];
      t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL) => {
        sent.push(String(input));
        return sent.length === 1 ? response : new Response("ok");
      });
      const result = await withoutCancellationWait(runtime.fetchPublic(url, { signal: request.signal }));
      assert.equal(await result.text(), "ok");
      assert.deepEqual(sent, [url, new URL("/next", url).href]);
      assert.equal(response.bodyUsed, true);
    });
  }

  for (const advertised of [false, true]) {
    test(`${name}: text limit rejects a cloned body promptly (${advertised ? "declared" : "streamed"} size)`, async (t) => {
      const response = clonedResponse(t, advertised ? { headers: { "content-length": "11" } } : undefined);
      await assert.rejects(withoutCancellationWait(runtime.readTextLimited(response, 3)), runtime.TooLargeError);
      assert.equal(response.bodyUsed, true);
      assert.equal(response.body!.locked, false);
    });
  }

  test(`${name}: malformed UTF-8 cancels the remainder and releases the reader without awaiting cleanup`, async () => {
    let cancelled = false;
    const response = new Response(new ReadableStream({
      pull(controller) { controller.enqueue(Uint8Array.of(0xff)); },
      cancel() { cancelled = true; return new Promise<void>(() => {}); },
    }));
    await assert.rejects(withoutCancellationWait(runtime.readTextLimited(response, 10)), TypeError);
    assert.equal(cancelled, true, "stop the upstream after decoding fails");
    assert.equal(response.body!.locked, false);
  });

  test(`${name}: text reader releases its lock after success and upstream failure`, async () => {
    const response = new Response(new ReadableStream({
      start(controller) {
        const bytes = new TextEncoder().encode("日本");
        controller.enqueue(bytes.subarray(0, 2));
        controller.enqueue(bytes.subarray(2));
        controller.close();
      },
    }));
    assert.equal(await runtime.readTextLimited(response, 6), "日本");
    assert.equal(response.body!.locked, false);
    const failure = new Error("upstream disconnected");
    const broken = new Response(new ReadableStream({ start(controller) { controller.error(failure); } }));
    await assert.rejects(runtime.readTextLimited(broken, 6), failure);
    assert.equal(broken.body!.locked, false);
  });
}
