/**
 * `/api/assets/file` のブラウザのキャッシュ。
 *
 * 保存したアセットのパスは変わらない。アップロードのたびに、時刻と乱数を付けた新しいパスに
 * 保存し、既存のキーを上書きすることはない。そのため、ブラウザは内容をキャッシュして、
 * エディタを読み込むたびの Worker へのリクエストと KV の読み取りを省ける
 * （Workers の無料プラン: 1日あたり 100,000 リクエスト・100,000 回の KV 読み取り）。
 *
 * `private` により、共有のキャッシュには保存させない。その代わりに、アクセスを取り消された人も、
 * すでにブラウザにキャッシュしたファイルは見られる。
 * 署名付きのプレビュー用 URL は、その有効期限までしかキャッシュしないため、
 * 署名で与えたアクセスより長くキャッシュが残ることはない。
 */
export const ASSET_CACHE_MAX_AGE = 365 * 24 * 60 * 60;

export function assetCacheControl(signedExpiry: number | null, now = Date.now()): string {
  if (signedExpiry === null) return `private, max-age=${ASSET_CACHE_MAX_AGE}, immutable`;
  const remaining = Math.floor((signedExpiry - now) / 1000);
  return remaining > 0 ? `private, max-age=${Math.min(remaining, ASSET_CACHE_MAX_AGE)}, immutable` : "private, no-store";
}
