import assert from "node:assert/strict";
import { test } from "node:test";
import { ASSET_TOKEN_TTL, signAssetPath, signAssetPaths, verifyAssetToken } from "../lib/asset-token";

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
