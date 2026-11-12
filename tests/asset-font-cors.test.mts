import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { afterEach, beforeEach, test } from "node:test";
import { transformSync } from "esbuild";
import { ASSET_TOKEN_TTL, signAssetPath, verifyAssetToken } from "../lib/asset-token";

// 実際の認証の確認・署名の検証・配信のルートを、合成したフォントに置き換えた保存先で動かす。
function load(path: string, mocks: Record<string, unknown>): any {
  const url = new URL(path, import.meta.url);
  const require = createRequire(url);
  const { code } = transformSync(readFileSync(url, "utf8"), { loader: "ts", format: "cjs", target: "es2022" });
  const module = { exports: {} };
  new Function("require", "module", "exports", code)(
    (name: string) => Object.hasOwn(mocks, name) ? mocks[name] : require(name), module, module.exports,
  );
  return module.exports;
}
const oldSecret = process.env.AUTH_SECRET;
beforeEach(() => { process.env.AUTH_SECRET = "synthetic-asset-test-secret"; });
afterEach(() => {
  if (oldSecret === undefined) delete process.env.AUTH_SECRET;
  else process.env.AUTH_SECRET = oldSecret;
});

function fixture({ configured = true, anonymous = false, session = false } = {}) {
  class NextResponse extends Response {
    static json(value: unknown, init?: ResponseInit) { return new NextResponse(JSON.stringify(value), init); }
  }
  let authCalls = 0;
  const reads: string[] = [];
  const auth = { authConfigured: () => configured, auth: async () => { authCalls++; return session ? { user: { email: "editor@example.test" } } : null; } };
  const serverTr = async () => (text: string) => text;
  const { requireAuth } = load("../lib/server.ts", {
    "next/server": { NextResponse }, "../auth": auth,
    "./i18n-server": { serverTr }, "./anonymous": { anonymousAllowed: () => anonymous },
  });
  const { GET } = load("../app/api/assets/file/route.ts", {
    "next/server": { NextResponse }, "../../../../auth": auth,
    "../../../../lib/server": { requireAuth }, "../../../../lib/i18n-server": { serverTr },
    "../../../../lib/asset-token": { verifyAssetToken },
    "../../../../lib/kv": { assetStore: () => ({
      getWithMetadata: async (path: string) => {
        reads.push(path);
        return { value: new Uint8Array([119, 79, 70, 50]), metadata: { contentType: "font/woff2" } };
      },
    }) },
  });
  return {
    get: (query = "path=assets%2Ffont.woff2") => GET(new Request(`https://editor.example.test/api/assets/file?${query}`, { headers: { Origin: "null" } })) as Promise<Response>,
    reads, authCalls: () => authCalls,
  };
}
function readableFromPreview(response: Response, cacheControl: string | RegExp) {
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "*");
  assert.equal(response.headers.get("Cross-Origin-Resource-Policy"), "cross-origin");
  assert.equal(response.headers.get("Access-Control-Allow-Credentials"), null);
  assert.equal(response.headers.get("Content-Type"), "font/woff2");
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  assert.match(response.headers.get("Content-Security-Policy") ?? "", /default-src 'none';.*sandbox/);
  const header = response.headers.get("Cache-Control") ?? "";
  if (typeof cacheControl === "string") assert.equal(header, cacheControl);
  else assert.match(header, cacheControl);
}
const IMMUTABLE_YEAR = "private, max-age=31536000, immutable";

test("public anonymous assets can supply fonts to the opaque HTML preview", async () => {
  const f = fixture({ configured: false, anonymous: true });
  const response = await f.get();
  readableFromPreview(response, IMMUTABLE_YEAR);
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [119, 79, 70, 50]);
  assert.deepEqual(f.reads, ["assets/font.woff2"]);
});

test("signed preview URLs retain cross-origin access without a login cookie", async () => {
  const f = fixture();
  const query = await signAssetPath("assets/font.woff2");
  // キャッシュの期間は、署名が有効な間（1時間）を超えない。
  const response = await f.get(`path=assets%2Ffont.woff2&${query}`);
  readableFromPreview(response, /^private, max-age=(\d+), immutable$/);
  const maxAge = Number(/max-age=(\d+)/.exec(response.headers.get("Cache-Control")!)![1]);
  assert.ok(maxAge > 3500 && maxAge <= ASSET_TOKEN_TTL / 1000, `max-age ${maxAge}`);
  assert.equal(f.authCalls(), 0);
  assert.deepEqual(f.reads, ["assets/font.woff2"]);
});

test("cookie-authorized private assets do not gain public CORS access", async () => {
  const f = fixture({ session: true });
  const response = await f.get();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
  assert.equal(response.headers.get("Cross-Origin-Resource-Policy"), null);
  assert.equal(response.headers.get("Cache-Control"), IMMUTABLE_YEAR);
  assert.equal(f.authCalls(), 1);
});

test("unsigned, expired and wrong-path URLs still require authentication", async () => {
  const expired = await signAssetPath("assets/font.woff2", Date.now() - ASSET_TOKEN_TTL - 1000);
  const wrongPath = await signAssetPath("assets/another.woff2");
  for (const suffix of ["", `&${expired}`, `&${wrongPath}`, "&exp=9999999999999&sig=invalid"]) {
    const f = fixture();
    const response = await f.get(`path=assets%2Ffont.woff2${suffix}`);
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
    assert.deepEqual(f.reads, []);
    assert.equal(f.authCalls(), 1);
  }
});

test("unconfigured authentication without anonymous permission stays blocked", async () => {
  const f = fixture({ configured: false });
  const response = await f.get();
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
  assert.deepEqual(f.reads, []);
});
