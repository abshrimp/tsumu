import type { Db } from "./db";

/**
 * Workers KV に保存したファイルの D1 上の台帳（`asset_objects`）。
 *
 * アセットタブの使用量の表示は、サイトの文書が参照するファイルを合計する代わりに、これを読む。
 * KV には、どの文書からも参照されなくなったファイル（GC を待っている削除済みのアセット、
 * アップロードに失敗したファイル、削除したサイトのファイル）も残っているため。
 */

/** 大きさの分からないパスをブラウザに返す上限の数（ブラウザ側で大きさが分かることがある）。 */
const UNKNOWN_PATHS_LIMIT = 1000;

export interface AssetLedgerSummary {
  /** 台帳を作ってから、すべてのキーを少なくとも一度は列挙した。 */
  complete: boolean;
  count: number;
  /** 大きさの分かっているファイルの合計。 */
  bytes: number;
  /** 大きさの分からないファイルの数（大きさを記録するようになる前にアップロードしたもの）。 */
  unknownCount: number;
  unknownPaths: string[];
  /** GC による削除に登録したファイルの数（エディタで削除したもの）。 */
  pendingCount: number;
  pendingBytes: number;
}

/** アップロードを記録する。失敗しても、週1回の KV の棚卸しで補われる。 */
export async function recordUploadedAsset(db: Db, path: string, bytes: number, now = Date.now()): Promise<void> {
  if (db.backend !== "d1") return;
  await db.execute({
    sql: `INSERT INTO asset_objects(path,bytes,uploaded_at,last_seen_at) VALUES(?,?,?,?)
      ON CONFLICT(path) DO UPDATE SET bytes=excluded.bytes`,
    args: [path, bytes, now, now],
  });
}

export async function readAssetLedger(db: Db): Promise<AssetLedgerSummary | null> {
  if (db.backend !== "d1") return null;
  const [totals, state, unknown] = await db.batch([
    `SELECT COUNT(*) AS n, COALESCE(SUM(o.bytes),0) AS bytes,
      COALESCE(SUM(o.bytes IS NULL),0) AS unknown,
      COUNT(c.path) AS pending, COALESCE(SUM(CASE WHEN c.path IS NOT NULL THEN o.bytes END),0) AS pending_bytes
      FROM asset_objects o LEFT JOIN asset_gc_candidates c ON c.path=o.path`,
    "SELECT complete_at FROM asset_ledger_state WHERE id=1",
    { sql: "SELECT path FROM asset_objects WHERE bytes IS NULL ORDER BY path LIMIT ?", args: [UNKNOWN_PATHS_LIMIT] },
  ]);
  const row = totals.rows[0] ?? {};
  return {
    complete: state.rows[0]?.complete_at != null,
    count: Number(row.n ?? 0),
    bytes: Number(row.bytes ?? 0),
    unknownCount: Number(row.unknown ?? 0),
    unknownPaths: unknown.rows.map(r => String(r.path)),
    pendingCount: Number(row.pending ?? 0),
    pendingBytes: Number(row.pending_bytes ?? 0),
  };
}
