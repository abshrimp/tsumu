import assert from "node:assert/strict";
import { test, afterEach, beforeEach, describe } from "node:test";
import { ASSET_TOKEN_TTL, verifyAssetToken, signAssetPaths } from "../lib/asset-token";
import { signAssetPath } from "./helpers/sign-asset-path";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { transformSync } from "esbuild";

describe("asset-token-mutation", () => {
  const SEED = 0x4a202611;
  function seeded(seed: number) {
    let state = seed >>> 0;
    return () => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return state >>> 0;
    };
  }

  /** サンドボックスのプレビューの URL で、他の KV のキーが許可されてはならない。 */
  test("signed asset URLs do not permit mutated paths, signatures or expiry", async () => {
    const previous = process.env.AUTH_SECRET;
    process.env.AUTH_SECRET = "asset-token-test-isolated-secret";
    const next = seeded(SEED ^ 0x1818);
    const now = 1_800_000_000_000;
    const names = [
      "logo.png", "folder/photo.svg", "folder/space name.png",
      "folder/%2E%2E/other.png", "folder//other.png", "font.woff2",
      "日本語.svg", "A.jpg", "a.jpg", "nested/../../other.jpg",
    ];
    try {
      for (let i = 0; i < 120; i++) {
        const name = names[next() % names.length];
        const path = "assets/" + name + "?variant=" + i;
        const token = new URLSearchParams((await signAssetPath(path, now))!);
        const exp = token.get("exp"), sig = token.get("sig");
        assert.ok(exp && sig, "signed fixture must contain expiry and HMAC");
        assert.equal(await verifyAssetToken(path, exp, sig, now), true,
          "signed path rejected, seed=" + SEED + " case=" + i);
        assert.equal(await verifyAssetToken(path, exp, sig, now + ASSET_TOKEN_TTL), true,
          "boundary expiry rejected, case=" + i);
        assert.equal(await verifyAssetToken(path, exp, sig, now + ASSET_TOKEN_TTL + 1), false);
        for (const alternate of [
          path + "/child", path + "%2F", path.replace("assets/", "assets//"),
          path.toUpperCase(), path + "#fragment", path + "&sig=other",
        ]) {
          if (alternate === path) continue;
          assert.equal(await verifyAssetToken(alternate, exp, sig, now), false,
            "cross-key authorization: seed=" + SEED + " case=" + i + " key=" + alternate);
        }
        assert.equal(await verifyAssetToken(path, exp, sig + "x", now), false);
        assert.equal(await verifyAssetToken(path, String(Number(exp) + 1), sig, now), false);
      }
      const sample = "assets/secret.png";
      const token = new URLSearchParams((await signAssetPath(sample, now))!);
      process.env.AUTH_SECRET = "asset-token-other-secret";
      assert.equal(await verifyAssetToken(sample, token.get("exp"), token.get("sig"), now), false,
        "a token must not survive a signing-key change");
    } finally {
      if (previous === undefined) delete process.env.AUTH_SECRET;
      else process.env.AUTH_SECRET = previous;
    }
  });
});

describe("asset-token-batch", () => {
  const secret = process.env.AUTH_SECRET;
  const setSecret = (value: string | undefined) => {
    if (value === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = value;
  };

  test("batched asset tokens are path-bound, expire and share one expiry", async () => {
    setSecret("test-asset-batch-secret");
    try {
      const now = 1_700_000_000_000;
      const paths = ["assets/a.png", "assets/b.svg", "assets/a.png"];
      const tokens = await signAssetPaths(paths, now);
      assert.equal(tokens.size, 2);
      const expiries = new Set<string>();
      for (const [path, token] of tokens) {
        assert.ok(token);
        const query = new URLSearchParams(token);
        expiries.add(query.get("exp")!);
        assert.equal(await verifyAssetToken(path, query.get("exp"), query.get("sig"), now), true);
        assert.equal(await verifyAssetToken("assets/unrelated.png", query.get("exp"), query.get("sig"), now), false);
        assert.equal(await verifyAssetToken(path, query.get("exp"), query.get("sig"), now + ASSET_TOKEN_TTL + 1), false);
        assert.equal(await signAssetPath(path, now), token);
      }
      assert.deepEqual([...expiries], [String(now + ASSET_TOKEN_TTL)]);

      setSecret(undefined);
      const unsigned = await signAssetPaths(paths, now);
      assert.equal(unsigned.size, 2);
      assert.ok([...unsigned.values()].every(value => value === null));
    } finally {
      setSecret(secret);
    }
  });

  test("signing many assets imports the secret key only once per batch", async () => {
    setSecret("test-asset-batch-secret");
    const subtle = crypto.subtle;
    const original = subtle.importKey;
    let imports = 0;
    Object.defineProperty(subtle, "importKey", {
      configurable: true,
      writable: true,
      value: (...args: unknown[]) => {
        imports++;
        return Reflect.apply(original, subtle, args);
      },
    });
    try {
      const tokens = await signAssetPaths(
        Array.from({ length: 500 }, (_, i) => `assets/preview-${i}.png`),
        1_700_000_000_000,
      );
      assert.equal(tokens.size, 500);
      assert.equal(imports, 1, "one HMAC import per request, not per asset");
    } finally {
      delete (subtle as unknown as { importKey?: unknown }).importKey;
      setSecret(secret);
    }
  });


  test("invalid asset signatures are rejected before base64 decoding and key import", async () => {
    setSecret("test-asset-batch-secret");
    const now = 1_700_000_000_000;
    const valid = new URLSearchParams((await signAssetPath("assets/example.png", now))!);
    const subtle = crypto.subtle;
    const original = subtle.importKey;
    let imports = 0;
    Object.defineProperty(subtle, "importKey", {
      configurable: true,
      writable: true,
      value: (...args: unknown[]) => {
        imports++;
        return Reflect.apply(original, subtle, args);
      },
    });
    try {
      const canonical = valid.get("sig")!;
      const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
      const index = alphabet.indexOf(canonical.at(-1)!);
      assert.equal(index % 4, 0);
      const alias = canonical.slice(0, -1) + alphabet[index + 1];
      assert.equal(await verifyAssetToken("assets/example.png", valid.get("exp"), alias, now), false,
        "different final padding bits must not alias the same HMAC bytes");
      for (const signature of [
        "A".repeat(100_000),
        "A".repeat(42),
        "A".repeat(44),
        "A".repeat(42) + "=",
        "x:invalid",
      ]) {
        assert.equal(await verifyAssetToken("assets/example.png", valid.get("exp"), signature, now), false);
      }
      for (const expiry of ["0", "9999999999999999", "invalid"]) {
        assert.equal(await verifyAssetToken("assets/example.png", expiry, valid.get("sig"), now), false);
      }
      assert.equal(imports, 0, "malformed query strings must not invoke the HMAC runtime");
    } finally {
      delete (subtle as unknown as { importKey?: unknown }).importKey;
      setSecret(secret);
    }
  });
});

describe("asset-font-cors", () => {
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
});
