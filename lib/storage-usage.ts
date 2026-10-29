import type { AssetLedgerSummary } from "./asset-ledger";

/** `GET /api/assets` の応答（使用量の表示に使う部分） */
export interface StorageUsageResponse {
  /** Cloudflare: KV に置いたファイルの台帳（D1） */
  ledger?: AssetLedgerSummary;
  /** 台帳がそろっていないときと Node.js・Docker: 他のサイトが使っているファイル（path → bytes） */
  others?: { path: string; bytes: number | null }[];
  /** 削除待ちのファイル。台帳が未完成の間も使用量に加算する。 */
  pending?: { path: string; bytes: number | null }[];
}

interface StorageUsage {
  /** サーバーに置いたファイルの数 */
  files: number;
  bytes: number;
  /** 大きさが分からないファイルの数 */
  unknown: number;
  /**
   * true: KV の実際の中身（台帳）から数えた。
   * false: サイトが使っているファイルだけから数えた（削除を待っているものなどは入らない）。
   */
  exact: boolean;
  /** 削除する予定（GC を待っている）のファイル。exact のときだけ分かる */
  pendingCount: number;
  pendingBytes: number;
}

type OwnAsset = { path?: string; bytes?: number };

/**
 * すべてのサイトで共通の保存先の使用量。
 * 台帳がそろっていれば台帳の合計を使い、大きさの分からないファイルだけを編集中の内容から補う。
 * そろっていなければ、各サイトが使っているファイルを、重複させずに足す。
 */
export function computeStorageUsage(response: StorageUsageResponse | null, own: readonly OwnAsset[]): StorageUsage {
  const ledger = response?.ledger;
  if (ledger?.complete) {
    const unknownPaths = new Set(ledger.unknownPaths);
    const filled = new Map<string, number>();
    for (const asset of own) {
      if (asset.path && unknownPaths.has(asset.path) && typeof asset.bytes === "number") {
        filled.set(asset.path, asset.bytes);
      }
    }
    let bytes = ledger.bytes;
    for (const b of filled.values()) bytes += b;
    return {
      files: ledger.count, bytes, unknown: Math.max(0, ledger.unknownCount - filled.size), exact: true,
      pendingCount: ledger.pendingCount, pendingBytes: ledger.pendingBytes,
    };
  }
  const files = new Map<string, number | null>();
  for (const o of response?.others ?? []) files.set(o.path, o.bytes);
  for (const a of own) {
    if (a.path) files.set(a.path, a.bytes ?? files.get(a.path) ?? null);
  }
  // An asset can be referenced by another site while also awaiting GC.
  // Merge by path so Trash is counted exactly once, not added as a separate total.
  for (const pending of response?.pending ?? []) {
    files.set(pending.path, files.get(pending.path) ?? pending.bytes);
  }
  let bytes = 0;
  let unknown = 0;
  for (const b of files.values()) {
    if (b === null) unknown++;
    else bytes += b;
  }
  const pendingPaths = new Set((response?.pending ?? []).map((item) => item.path));
  let pendingBytes = 0;
  for (const path of pendingPaths) pendingBytes += files.get(path) ?? 0;
  return { files: files.size, bytes, unknown, exact: false, pendingCount: pendingPaths.size, pendingBytes };
}
