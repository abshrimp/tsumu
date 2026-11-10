import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { transformSync } from "esbuild";

class NextResponse extends Response {
  static json(body: unknown, init?: ResponseInit) {
    return new NextResponse(JSON.stringify(body), init);
  }
}

function fixture(upstream: Response) {
  const url = new URL("../app/api/fetch-json/route.ts", import.meta.url);
  const require = createRequire(url);
  const { code } = transformSync(readFileSync(url, "utf8"), {
    loader: "ts", format: "cjs", target: "es2022",
  });
  const mocks: Record<string, unknown> = {
    "next/server": { NextResponse },
    "../../../lib/i18n-server": {
      serverTr: async () => (value: string, params: Record<string, unknown> = {}) =>
        value.replace(/\{(\w+)\}/g, (_, key) => String(params[key] ?? key)),
    },
    "../../../lib/server": { requireAuth: async () => null },
    "../../../lib/safe-fetch": {
      BlockedUrlError: class extends Error {}, TooLargeError: class extends Error {},
      fetchPublic: async () => upstream,
      readTextLimited: async () => { throw new Error("an HTTP error body must not be parsed"); },
    },
  };
  const module = { exports: {} as { POST: (req: Request) => Promise<Response> } };
  new Function("require", "module", "exports", code)(
    (name: string) => Object.hasOwn(mocks, name) ? mocks[name] : require(name),
    module, module.exports,
  );
  return () => module.exports.POST(new Request("https://editor.example/api/fetch-json", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: "https://data.example/value.json" }),
  }));
}

async function timely<T>(pending: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([pending, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("HTTP error waited for upstream cancellation")), 500);
    })]);
  } finally { clearTimeout(timer); }
}

test("JSON proxy reports a cloned upstream HTTP error without waiting for its other reader", async () => {
  const original = new Response("upstream failure", { status: 503 });
  const clone = original.clone();
  try {
    const result = await timely(fixture(clone)());
    assert.equal(result.status, 502);
    assert.match((await result.json()).error, /HTTP 503/);
    assert.equal(original.bodyUsed, false);
    assert.equal(await original.text(), "upstream failure");
  } finally { void original.body?.cancel().catch(() => {}); }
});

for (const rejects of [false, true]) {
  test(`JSON proxy preserves HTTP errors when upstream cancellation ${rejects ? "rejects" : "never resolves"}`, async () => {
    let cancelled = false;
    const upstream = new Response(new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
        return rejects ? Promise.reject(new Error("cleanup failed")) : new Promise<void>(() => {});
      },
    }), { status: 429 });
    const result = await timely(fixture(upstream)());
    assert.equal(result.status, 502);
    assert.match((await result.json()).error, /HTTP 429/);
    assert.equal(cancelled, true);
  });
}
