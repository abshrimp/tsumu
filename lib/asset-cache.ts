/**
 * Browser caching for `/api/assets/file`.
 *
 * Stored asset paths are immutable: every upload gets a new path with a
 * timestamp and random suffix, and nothing overwrites an existing key. So a
 * browser may keep the bytes and skip the Worker request and the KV read on
 * every editor load (Workers Free: 100,000 requests and 100,000 KV reads/day).
 *
 * `private` keeps shared caches out. The trade-off is that someone whose
 * access is revoked can still see files already cached in their browser.
 * A signed preview URL is cached only until its own expiry, so the cache
 * never outlives the access the signature granted.
 */
export const ASSET_CACHE_MAX_AGE = 365 * 24 * 60 * 60;

export function assetCacheControl(signedExpiry: number | null, now = Date.now()): string {
  if (signedExpiry === null) return `private, max-age=${ASSET_CACHE_MAX_AGE}, immutable`;
  const remaining = Math.floor((signedExpiry - now) / 1000);
  return remaining > 0 ? `private, max-age=${Math.min(remaining, ASSET_CACHE_MAX_AGE)}, immutable` : "private, no-store";
}
