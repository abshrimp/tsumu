import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { transformSync } from "esbuild";
import { readJsonLimited } from "../lib/api-json";
import { parseAiRequest, readAiRequest } from "../lib/ai/request";
import { AI_STREAM_TYPE, readAiResponse, type AiProgress } from "../lib/ai/progress";
import type { runAi } from "../lib/ai/run";

class NextResponse extends Response {
  static json(body: unknown, init?: ResponseInit) {
    return new NextResponse(JSON.stringify(body), init);
  }
}

function load(path: string, mocks: Record<string, unknown>) {
  const url = new URL(path, import.meta.url);
  const require = createRequire(url);
  const { code } = transformSync(readFileSync(url, "utf8"), {
    loader: "ts", format: "cjs", target: "es2022",
  });
  const module = { exports: {} as { POST: (req: Request) => Promise<Response> } };
  new Function("require", "module", "exports", code)(
    (name: string) => Object.hasOwn(mocks, name) ? mocks[name] : require(name),
    module, module.exports,
  );
  return module.exports.POST;
}

const inputs = {
  "fetch-json": { url: "https://remote.example.test/data" },
  ai: {
    messages: [{ role: "user", text: "Change the page" }],
    context: {
      doc: {
        siteName: "Test", pageOrder: ["home"], assets: {}, nodes: {},
        pages: { home: { id: "home", name: "Home", slug: "", title: "Home", description: "", children: [] } },
      },
      target: { pageId: "home" },
    },
  },
} as const;

function fixture(route: keyof typeof inputs, authorized = true, model?: typeof runAi) {
  let calls = 0;
  const common = {
    "next/server": { NextResponse },
    "../../../lib/i18n-server": { serverTr: async () => (value: string) => value },
    "../../../lib/server": { requireAuth: async () => authorized ? null : NextResponse.json({}, { status: 401 }) },
  };
  const POST = route === "fetch-json" ? load("../app/api/fetch-json/route.ts", {
    ...common,
    "../../../lib/api-json": { readJsonLimited },
    "../../../lib/safe-fetch": {
      BlockedUrlError: class extends Error {}, TooLargeError: class extends Error {},
      fetchPublic: async () => { calls++; return Response.json({ message: "日本語" }); },
      readTextLimited: async (res: Response) => res.text(),
    },
  }) : load("../app/api/ai/route.ts", {
    ...common,
    "../../../lib/ai/request": { parseAiRequest, readAiRequest },
    "../../../lib/ai/config": { aiConfig: () => ({ enabled: true }) },
    "../../../lib/ai/run": {
      AiApiError: class extends Error {},
      runAi: async (...args: Parameters<typeof runAi>) => {
        calls++;
        return model ? model(...args) : "Done";
      },
    },
  });
  return { POST, get calls() { return calls; }, maxBytes: (route === "ai" ? 4 : 2) * 1024 * 1024 };
}

for (const accept of [AI_STREAM_TYPE, "application/json", null]) {
  test(`AI returns the same progress stream regardless of Accept: ${accept}`, async () => {
    const events: AiProgress[] = [];
    const f = fixture("ai", true, async (_conf, _turns, _tool, _signal, onProgress) => {
      assert.ok(onProgress, "the current endpoint always enables model progress");
      onProgress({ type: "text", text: "Working", turn: 1 });
      return "Done";
    });
    const req = request("ai");
    if (accept !== null) req.headers.set("accept", accept);
    const res = await f.POST(req);
    assert.ok(res.headers.get("content-type")?.startsWith(AI_STREAM_TYPE));
    assert.deepEqual(await readAiResponse(res, event => events.push(event)), { reply: "Done", operations: [] });
    assert.deepEqual(events.map(event => event.type), ["phase", "text"]);
    assert.equal(f.calls, 1);
  });
}

test("AI stream cancellation aborts the in-flight model without an Accept header", async () => {
  let aborted = false;
  const f = fixture("ai", true, async (_conf, _turns, _tool, signal) => {
    assert.ok(signal);
    return new Promise(resolve => signal.addEventListener("abort", () => {
      aborted = true;
      resolve(null);
    }, { once: true }));
  });
  const res = await f.POST(request("ai"));
  await res.body!.cancel();
  assert.equal(aborted, true);
  assert.equal(f.calls, 1);
});

test("AI provider failures use the current stream error contract", async (t) => {
  t.mock.method(console, "error", () => {});
  const f = fixture("ai", true, async () => { throw new Error("private provider failure details"); });
  const res = await f.POST(request("ai"));
  await assert.rejects(readAiResponse(res, () => {}), /^Error: Couldn't reach AI$/);
  assert.equal(f.calls, 1);
});

function request(route: keyof typeof inputs, body: BodyInit | null = JSON.stringify(inputs[route]), headers: HeadersInit = { "Content-Type": "application/json" }) {
  return new Request("https://editor.example.test/api/" + route, {
    method: "POST", body, headers, duplex: "half",
  } as RequestInit);
}

async function timely(pending: Promise<Response>): Promise<Response> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([pending, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("request waited for body cleanup")), 500);
    })]);
  } finally { clearTimeout(timer); }
}

for (const route of ["fetch-json", "ai"] as const) {
  test(`${route} accepts editor JSON, case-insensitive MIME parameters and absent MIME`, async () => {
    const f = fixture(route);
    for (const mime of ["application/json", "Application/JSON; charset=utf-8", null]) {
      const req = request(route);
      if (mime === null) req.headers.delete("content-type");
      else req.headers.set("content-type", mime);
      const res = await f.POST(req);
      assert.equal(res.status, 200);
      assert.deepEqual(route === "ai" ? await readAiResponse(res, () => {}) : await res.json(), route === "ai"
        ? { reply: "Done", operations: [] } : { ok: true, json: { message: "日本語" } });
    }
    assert.equal(f.calls, 3);
  });

  test(`${route} rejects wrong MIME and malformed JSON without downstream requests`, async () => {
    const f = fixture(route);
    // エディタの JSON のヘッダーと異なる MIME には、他の不正な入力への応答と同じ 400 を返す。
    for (const mime of ["text/plain", "application/x-www-form-urlencoded", "application/problem+json"]) {
      assert.equal((await f.POST(request(route, JSON.stringify(inputs[route]), { "Content-Type": mime }))).status, 400);
    }
    for (const value of ["{broken", "null", "{}", null]) {
      assert.equal((await f.POST(request(route, value))).status, 400);
    }
    const invalidLength = request(route);
    invalidLength.headers.set("Content-Length", "invalid");
    assert.equal((await f.POST(invalidLength)).status, 400);
    assert.equal(f.calls, 0);
  });

  test(`${route} authenticates before reading or contacting downstream`, async () => {
    const f = fixture(route, false);
    const req = request(route);
    assert.equal((await f.POST(req)).status, 401);
    assert.equal(req.bodyUsed, false);
    assert.equal(f.calls, 0);
  });

  for (const declared of [false, true]) test(`${route} returns 413 for a cloned ${declared ? "declared" : "streamed"} oversized body without waiting`, async (t) => {
    const f = fixture(route);
    const original = request(route, " ".repeat(f.maxBytes + 1));
    if (declared) original.headers.set("Content-Length", String(f.maxBytes + 1));
    const clone = original.clone();
    t.after(() => { void original.body?.cancel().catch(() => {}); });
    const res = await timely(f.POST(clone));
    assert.equal(res.status, 413);
    assert.equal(clone.body!.locked, false);
    assert.equal(f.calls, 0);
  });

  test(`${route} rejects invalid UTF-8 without waiting on cancellation`, async () => {
    const f = fixture(route);
    let cancelled = false;
    const req = request(route, new ReadableStream<Uint8Array>({
      pull(controller) { controller.enqueue(Uint8Array.of(0xff)); },
      cancel() { cancelled = true; return new Promise<void>(() => {}); },
    }));
    assert.equal((await timely(f.POST(req))).status, 400);
    assert.equal(cancelled, true);
    assert.equal(req.body!.locked, false);
    assert.equal(f.calls, 0);
  });

  test(`${route} handles interrupted body reads without contacting downstream`, async () => {
    const f = fixture(route);
    const req = request(route, new ReadableStream<Uint8Array>({
      start(controller) { controller.error(new Error("client disconnected")); },
    }));
    assert.equal((await f.POST(req)).status, 400);
    assert.equal(req.body!.locked, false);
    assert.equal(f.calls, 0);
  });
}
