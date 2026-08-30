import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { transformSync } from "esbuild";
import { readJsonLimited } from "../lib/api-json";
import { parseAiRequest, readAiRequest } from "../lib/ai/request";

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

function fixture(route: keyof typeof inputs, authorized = true) {
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
      runAi: async () => { calls++; return "Done"; },
    },
  });
  return { POST, get calls() { return calls; }, maxBytes: (route === "ai" ? 4 : 2) * 1024 * 1024 };
}

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
      assert.deepEqual(await res.json(), route === "ai"
        ? { reply: "Done", operations: [] } : { ok: true, json: { message: "日本語" } });
    }
    assert.equal(f.calls, 3);
  });

  test(`${route} rejects wrong MIME and malformed JSON without downstream requests`, async () => {
    const f = fixture(route);
    // エディタの JSON ヘッダーと異なる MIME は、従来の不正入力応答と同じ 400 にする。
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
