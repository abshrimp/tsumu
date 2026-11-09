import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { transformSync } from "esbuild";
import {
  JsonBodyTooLargeError, JsonContentTypeError, readJsonLimited,
} from "../lib/api-json";

function jsonRequest(body: string, headers: Record<string, string> = {}) {
  return new Request("https://editor.example.test/api/test", {
    method: "POST", body, headers: { "content-type": "application/json", ...headers },
  });
}

test("JSON limits count actual streamed bytes even with no Content-Length", async () => {
  assert.deepEqual(await readJsonLimited(jsonRequest('{"ok":true}'), 64), { ok: true });
  await assert.rejects(
    readJsonLimited(jsonRequest("{}", { "content-length": "9999" }), 64),
    JsonBodyTooLargeError,
  );
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"text":"'));
      controller.enqueue(new TextEncoder().encode("あ".repeat(16)));
      controller.enqueue(new TextEncoder().encode('"}'));
      controller.close();
    },
  });
  const streamed = new Request("https://editor.example.test/api/test", {
    method: "POST", body, headers: { "content-type": "application/json" },
    duplex: "half",
  } as RequestInit);
  await assert.rejects(readJsonLimited(streamed, 32), JsonBodyTooLargeError);
});

test("invalid encodings, malformed JSON, unexpected MIME and missing bodies are rejected", async () => {
  await assert.rejects(readJsonLimited(jsonRequest("{"), 1024), SyntaxError);
  await assert.rejects(readJsonLimited(jsonRequest("{}",
    { "content-type": "text/plain" }), 1024), JsonContentTypeError);
  const invalid = new Request("https://editor.example.test/api/test", {
    method: "POST", body: Uint8Array.of(0xff),
    headers: { "content-type": "application/json" },
  });
  await assert.rejects(readJsonLimited(invalid, 1024), TypeError);
  await assert.rejects(readJsonLimited(new Request("https://editor.example.test/api/test",
    { method: "POST" }), 1024), SyntaxError);
});

function load(path: string, mocks: Record<string, unknown>) {
  const url = new URL(path, import.meta.url);
  const require = createRequire(url);
  const { code } = transformSync(readFileSync(url, "utf8"), {
    loader: "ts", format: "cjs", target: "es2022",
  });
  const module = { exports: {} as Record<string, any> };
  new Function("require", "module", "exports", code)(
    (name: string) => Object.hasOwn(mocks, name) ? mocks[name] : require(name),
    module, module.exports,
  );
  return module.exports;
}

class NextResponse extends Response {
  static json(body: unknown, init?: ResponseInit) {
    return new NextResponse(JSON.stringify(body), init);
  }
}
const tr = async () => (s: string) => s;

function signingFixture(authorized = true) {
  const signed: string[] = [];
  const handler = load("../app/api/assets/sign/route.ts", {
    "next/server": { NextResponse },
    "../../../../lib/i18n-server": { serverTr: tr },
    "../../../../lib/server": { requireAuth: async () => authorized ? null : NextResponse.json({ error: "Unauthorized" }, { status: 401 }) },
    "../../../../lib/asset-token": { signAssetPath: async (path: string) => {
      signed.push(path);
      return "exp=123&sig=example";
    } },
    "../../../../lib/api-json": { JsonBodyTooLargeError, JsonContentTypeError, readJsonLimited },
  });
  return { POST: handler.POST as (req: Request) => Promise<Response>, signed };
}

test("asset signing accepts a valid request and enforces authorization", async () => {
  const { POST, signed } = signingFixture();
  const good = await POST(jsonRequest('{"paths":["assets/a.png"]}'));
  assert.equal(good.status, 200);
  assert.deepEqual((await good.json()).urls, {
    "assets/a.png": "/api/assets/file?path=assets%2Fa.png&exp=123&sig=example",
  });
  assert.deepEqual(signed, ["assets/a.png"]);
  const denied = signingFixture(false);
  assert.equal((await denied.POST(jsonRequest('{"paths":["assets/a.png"]}'))).status, 401);
  assert.deepEqual(denied.signed, []);
});

test("asset signing rejects oversized or wrongly typed request bodies before signing", async () => {
  const { POST, signed } = signingFixture();
  assert.equal((await POST(jsonRequest('{}', { "content-length": "9999999" }))).status, 413);
  assert.equal((await POST(jsonRequest("{}", { "content-type": "text/plain" }))).status, 415);
  assert.equal((await POST(jsonRequest('{"paths":["untrusted/secret"]}'))).status, 400);
  assert.equal((await POST(jsonRequest(JSON.stringify({ paths: Array(501).fill("assets/a.png") })))).status, 400);
  assert.deepEqual(signed, []);
});
