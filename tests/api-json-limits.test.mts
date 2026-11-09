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
const jsonModule = { JsonBodyTooLargeError, JsonContentTypeError, readJsonLimited };

function fetchFixture() {
  const outbound: { url: string; init: RequestInit }[] = [];
  const handler = load("../app/api/fetch-json/route.ts", {
    "next/server": { NextResponse },
    "../../../lib/i18n-server": { serverTr: tr },
    "../../../lib/server": { requireAuth: async () => null },
    "../../../lib/api-json": jsonModule,
    "../../../lib/safe-fetch": {
      BlockedUrlError: class extends Error {},
      TooLargeError: class extends Error {},
      fetchPublic: async (url: string, init: RequestInit) => {
        outbound.push({ url, init });
        return new Response('{"ok":true}', { headers: { "content-type": "application/json" } });
      },
      readTextLimited: async (response: Response) => response.text(),
    },
  });
  const post = (value: unknown, headers: Record<string, string> = {}) => handler.POST(
    jsonRequest(JSON.stringify(value), headers),
  ) as Promise<Response>;
  return { post, outbound };
}

test("fetch proxy rejects multibyte outgoing bodies over one megabyte before networking", async () => {
  const fixture = fetchFixture();
  const response = await fixture.post({
    url: "https://api.example.test/submit", method: "POST",
    body: "あ".repeat(400_000),
  });
  assert.equal(response.status, 400);
  assert.equal(fixture.outbound.length, 0);
});

test("fetch proxy rejects excessive headers and invalid media types without networking", async () => {
  const fixture = fetchFixture();
  const url = "https://api.example.test/submit";
  assert.equal((await fixture.post({ url }, { "content-type": "text/plain" })).status, 415);
  assert.equal((await fixture.post({
    url, headers: Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`X-${i}`, "ok"])),
  })).status, 400);
  assert.equal((await fixture.post({ url, headers: { Authorization: "x".repeat(20_000) } })).status, 400);
  assert.equal((await fixture.post({ url, headers: [ "invalid" ] })).status, 400);
  assert.deepEqual(fixture.outbound, []);
});

test("fetch proxy still sends allowed headers and valid JSON requests", async () => {
  const fixture = fetchFixture();
  const response = await fixture.post({
    url: "https://api.example.test/submit", method: "POST",
    headers: { Authorization: "Bearer example", Host: "overridden.example" },
    body: '{"query":"safe"}',
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, json: { ok: true } });
  assert.equal(fixture.outbound.length, 1);
  assert.equal(fixture.outbound[0].init.headers?.Authorization, "Bearer example");
  assert.equal(fixture.outbound[0].init.headers?.Host, undefined);
  assert.equal(fixture.outbound[0].init.body, '{"query":"safe"}');
});

test("asset signing rejects oversized or wrongly typed request bodies before signing", async () => {
  const signed: string[] = [];
  const handler = load("../app/api/assets/sign/route.ts", {
    "next/server": { NextResponse },
    "../../../../lib/i18n-server": { serverTr: tr },
    "../../../../lib/server": { requireAuth: async () => null },
    "../../../../lib/asset-token": { signAssetPath: async (path: string) => {
      signed.push(path);
      return "exp=123&sig=example";
    } },
    "../../../../lib/api-json": jsonModule,
  });
  const POST = handler.POST as (req: Request) => Promise<Response>;
  const good = await POST(jsonRequest('{"paths":["assets/a.png"]}'));
  assert.equal(good.status, 200);
  assert.deepEqual((await good.json()).urls, {
    "assets/a.png": "/api/assets/file?path=assets%2Fa.png&exp=123&sig=example",
  });
  assert.deepEqual(signed, ["assets/a.png"]);

  const huge = await POST(jsonRequest('{}', { "content-length": "9999999" }));
  assert.equal(huge.status, 413);
  const wrongType = await POST(jsonRequest("{}", { "content-type": "text/plain" }));
  assert.equal(wrongType.status, 415);
  assert.deepEqual(signed, ["assets/a.png"]);
});
