import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * 環境変数とシークレットの取得。
 * Cloudflare Workers では `wrangler secret put` の値は env バインディングに
 * 載るため、process.env（ローカル開発の .env.local や、nodejs_compat による
 * 自動の反映）に無ければ、Cloudflare の env から探す。
 * モジュールの読み込み時ではなく、必ずリクエストの処理中に呼ぶこと。
 */
export function envVar(name: string): string | undefined {
  const v = process.env[name];
  if (v) return v;
  try {
    const env = getCloudflareContext().env as unknown as Record<
      string,
      unknown
    >;
    const cv = env[name];
    return typeof cv === "string" && cv ? cv : undefined;
  } catch {
    return undefined;
  }
}
