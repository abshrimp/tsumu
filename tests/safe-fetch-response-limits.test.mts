import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { gzipSync, deflateSync, brotliCompressSync } from "node:zlib";
import { transformSync } from "esbuild";
import * as source from "../lib/safe-fetch";
import { SAFE_FETCH_SOURCE } from "../lib/generator/safe-fetch-source";

const generatedModule = { exports: {} };
new Function("module", "exports", transformSync(SAFE_FETCH_SOURCE, {
  loader: "ts", format: "cjs",
}).code)(generatedModule, generatedModule.exports);
const runtimes = { source, generated: generatedModule.exports as typeof source };

const nativeTargets = {
  "Node IPv4": "https://8.8.8.8/data",
  "Node IPv6": "https://[2606:4700::1111]/data",
  Workers: "https://public.example.test/data",
};

function selectNative(t: TestContext, name: string) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", {
    configurable: true, value: { userAgent: name === "Workers" ? "Cloudflare-Workers" : "Node.js" },
  });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "navigator", previous);
    else Reflect.deleteProperty(globalThis, "navigator");
  });
}

for (const [runtimeName, runtime] of Object.entries(runtimes)) {
  for (const [transport, url] of Object.entries(nativeTargets)) {
    test(`${runtimeName}: ${transport} enforces actual body bytes and cancels overflow`, async (t) => {
      selectNative(t, transport);
      const headerCases: HeadersInit[] = [{}, { "content-length": "1" }, { "content-encoding": "gzip", "content-length": "2" }];
      for (const headers of headerCases) {
        let cancelled = false;
        let pulls = 0;
        // Native fetch exposes decoded bytes; the wire length must not set the limit.
        t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({
          pull(controller) { pulls++; controller.enqueue(new Uint8Array(3)); },
          cancel() { cancelled = true; },
        }), { headers }));
        await assert.rejects(runtime.fetchPublic(url, {}, 5, 5), runtime.TooLargeError);
        assert.equal(cancelled, true);
        assert.ok(pulls <= 3, "overflow must stop reading the upstream");
      }
    });

    test(`${runtimeName}: ${transport} permits the exact byte limit and preserves response data`, async (t) => {
      selectNative(t, transport);
      t.mock.method(globalThis, "fetch", async () => new Response("日本", {
        status: 201, statusText: "Created", headers: { "content-type": "text/plain", "x-result": "ok" },
      }));
      const response = await runtime.fetchPublic(url, {}, 5, 6);
      assert.equal(response.status, 201);
      assert.equal(response.statusText, "Created");
      assert.equal(response.headers.get("x-result"), "ok");
      assert.equal(await response.text(), "日本");
      t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 204 }));
      assert.equal((await runtime.fetchPublic(url, {}, 5, 0)).status, 204);
    });

    test(`${runtimeName}: ${transport} cancels a stalled response body on abort`, async (t) => {
      selectNative(t, transport);
      const controller = new AbortController();
      let cancelled = false;
      const reason = new Error("request deadline");
      t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({
        pull() { queueMicrotask(() => controller.abort(reason)); },
        cancel() { cancelled = true; },
      }, { highWaterMark: 0 })));
      await assert.rejects(runtime.fetchPublic(url, { signal: controller.signal }), reason);
      assert.equal(cancelled, true);
    });

    test(`${runtimeName}: ${transport} bounds redirect responses without a location`, async (t) => {
      selectNative(t, transport);
      t.mock.method(globalThis, "fetch", async () => new Response("too large", { status: 302 }));
      await assert.rejects(runtime.fetchPublic(url, {}, 5, 5), runtime.TooLargeError);
    });

    test(`${runtimeName}: ${transport} removes compressed wire metadata from buffered bytes`, async (t) => {
      selectNative(t, transport);
      t.mock.method(globalThis, "fetch", async () => new Response("decoded", {
        headers: { "content-encoding": "gzip", "content-length": "27", "content-type": "text/plain" },
      }));
      const response = await runtime.fetchPublic(url, {}, 5, 7);
      assert.equal(await response.text(), "decoded");
      assert.equal(response.headers.get("content-type"), "text/plain");
      assert.equal(response.headers.has("content-encoding"), false);
      assert.equal(response.headers.has("content-length"), false);
    });

    test(`${runtimeName}: ${transport} does not wait for upstream cancellation on overflow`, { timeout: 1000 }, async (t) => {
      selectNative(t, transport);
      let cancelled = false;
      t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({
        pull(controller) { controller.enqueue(new Uint8Array(6)); },
        cancel() { cancelled = true; return new Promise<void>(() => {}); },
      })));
      await assert.rejects(runtime.fetchPublic(url, {}, 5, 5), runtime.TooLargeError);
      assert.equal(cancelled, true);
    });

    test(`${runtimeName}: ${transport} cancels redirect bodies before validating the next destination`, async (t) => {
      selectNative(t, transport);
      let cancelled = false;
      const fetchMock = t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({
        cancel() { cancelled = true; },
      }), { status: 302, headers: { location: "http://127.0.0.1/private" } }));
      await assert.rejects(runtime.fetchPublic(url, {}, 5, 0), runtime.BlockedUrlError);
      assert.equal(cancelled, true);
      assert.equal(fetchMock.mock.callCount(), 1);
    });
  }

  for (const [encoding, compress] of Object.entries({ identity: (b: Buffer) => b, gzip: gzipSync, deflate: deflateSync, br: brotliCompressSync })) {
    test(`${runtimeName}: Node hostname limits ${encoding} responses after decompression`, async (t) => {
      selectNative(t, "Node");
      const dns = process.getBuiltinModule("node:dns/promises");
      const http = process.getBuiltinModule("node:http");
      t.mock.method(dns, "lookup", async () => [{ address: "8.8.8.8", family: 4 }]);
      t.mock.method(http, "request", (_url: URL, _options: unknown, respond: Function) => {
        const bytes = compress(Buffer.from("x".repeat(1024)));
        const res = Object.assign(new PassThrough(), {
          statusCode: 200, headers: { "content-encoding": encoding, "content-length": String(bytes.length) },
        });
        return Object.assign(new EventEmitter(), {
          end() { queueMicrotask(() => { respond(res); res.end(bytes); }); },
          destroy() { res.destroy(); },
        });
      });
      await assert.rejects(runtime.fetchPublic("http://public.example.test/data", {}, 5, 1023), runtime.TooLargeError);
      const response = await runtime.fetchPublic("http://public.example.test/data", {}, 5, 1024);
      assert.equal(await response.text(), "x".repeat(1024));
      assert.equal(response.headers.has("content-encoding"), false);
      assert.equal(response.headers.has("content-length"), false);
    });
  }
}
