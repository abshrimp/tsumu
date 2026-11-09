import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ASSET_TOKEN_TTL, signAssetPath, verifyAssetToken,
} from "../lib/asset-token";

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

/** J-1: A URL granted to a sandbox preview must not authorize any other KV key. */
test("AUD-J-018: signed asset URLs do not permit mutated paths, signatures or expiry", async () => {
  const previous = process.env.AUTH_SECRET;
  process.env.AUTH_SECRET = "audit-j-test-isolated-secret";
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
    process.env.AUTH_SECRET = "audit-j-other-secret";
    assert.equal(await verifyAssetToken(sample, token.get("exp"), token.get("sig"), now), false,
      "a token must not survive a signing-key change");
  } finally {
    if (previous === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = previous;
  }
});
