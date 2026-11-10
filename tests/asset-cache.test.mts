import assert from "node:assert/strict";
import { test } from "node:test";
import { ASSET_CACHE_MAX_AGE, assetCacheControl } from "../lib/asset-cache";

test("immutable asset paths are cached privately for a year", () => {
  assert.equal(assetCacheControl(null), `private, max-age=${ASSET_CACHE_MAX_AGE}, immutable`);
  assert.equal(ASSET_CACHE_MAX_AGE, 31_536_000);
});

test("signed URLs are cached only until the signature expires", () => {
  const now = 1_000_000;
  assert.equal(assetCacheControl(now + 3_600_000, now), "private, max-age=3600, immutable");
  assert.equal(assetCacheControl(now + 999, now), "private, no-store");
  assert.equal(assetCacheControl(now - 1, now), "private, no-store");
});
