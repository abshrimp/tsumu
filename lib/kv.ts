import { getCloudflareContext } from "@opennextjs/cloudflare";
import { nodeAssetStore } from "./node-storage";

/**
 * 画像・動画・音声アセットの保存先（Cloudflare Workers KV）。
 * R2と違いカード登録なしの無料プランで使える（1GB・1値25MBまで）。
 * wrangler.jsonc の ASSETS_KV バインディング経由でアクセスし、
 * 配信は /api/assets/file プロキシで行う。
 * Cloudflare の外では、TSUMU_DATA_DIR のフォルダを同じ形で使う（lib/node-storage.ts）。
 */

/** アセットのメタデータ（KVのmetadataに保存） */
export interface AssetMeta {
  contentType?: string;
}

/** 使用するKV APIの最小型（@cloudflare/workers-types の型衝突を避ける） */
export interface KVLikeNamespace {
  put(
    key: string,
    value: ArrayBuffer | string,
    options?: { metadata?: AssetMeta }
  ): Promise<void>;
  get(key: string, options: { type: "arrayBuffer" }): Promise<ArrayBuffer | null>;
  getWithMetadata(
    key: string,
    options: { type: "stream" }
  ): Promise<{ value: ReadableStream | null; metadata: AssetMeta | null }>;
  delete(key: string): Promise<void>;
}

/** アセット用KV（バインディングも TSUMU_DATA_DIR も無ければ null） */
export function assetStore(): KVLikeNamespace | null {
  try {
    const env = getCloudflareContext().env as unknown as Record<
      string,
      unknown
    >;
    const kv = env.ASSETS_KV as KVLikeNamespace | undefined;
    if (kv) return kv;
  } catch {
    // Cloudflare の外（next start・Docker）
  }
  return nodeAssetStore();
}

/** KVの1値あたりの上限（25MB） */
export const MAX_ASSET_BYTES = 25 * 1024 * 1024;
