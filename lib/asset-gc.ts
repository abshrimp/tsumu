import type { Db } from "./db";
import type { KVLikeNamespace } from "./kv";
import { assetUploadedAt, planAssetGc, type GcCandidate } from "./asset-gc-plan";

/** GC が行うのは、アセットのキーの列挙と削除だけ。 */
export type AssetGcKv = Pick<KVLikeNamespace, "delete" | "list">;

/**
 * 削除の操作があると、すぐに候補として登録する。毎日の cron は期限切れの候補だけを処理し、
 * 別の週1回の棚卸しで、孤立したアップロードと、削除したサイトのアセットを見つける。
 * 過去のエディタのバックアップ、GitHub の履歴、オフラインの下書きは、意図的に
 * 7日間の保持期間の判定に含めていない。
 */
export interface AssetGcDocumentNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): { gcAssetReferences(): Promise<string[]> };
}

export interface AssetGcDependencies {
  db: Db;
  kv: AssetGcKv;
  rooms: AssetGcDocumentNamespace;
  now?: number;
  graceDays?: number;
  maxDeletes?: number;
  /** 物理的な削除を明示的に許可する指定。既定は削除しない試行（dry-run）。 */
  dryRun?: boolean;
  /** 週1回の照合（毎日の定期処理には含めない）。 */
  discoverUntracked?: boolean;
}

export interface AssetGcReport {
  status: "ok";
  dryRun: boolean;
  sweepSupported: true;
  kvKeysScanned: number;
  referenced: number;
  candidates: number;
  candidateBytesKnown: number;
  scanComplete: boolean;
  deleted: number;
  deletedBytesKnown: number;
  deletedPaths: string[];
  /** 削除できる見込みのあるパス。最後に、現在のサイトの参照をもう一度確かめる。 */
  potentialDeletePaths: string[];
  potentialDeleteBytesKnown: number;
  previewTruncated: boolean;
}

export class AssetGcAbortedError extends Error {
  constructor(message: string) { super(message); this.name = "AssetGcAbortedError"; }
}

function positiveInteger(value: number | undefined, fallback: number, max: number, name: string): number {
  const n = value ?? fallback;
  if (!Number.isSafeInteger(n) || n < 1 || n > max) throw new RangeError("Invalid " + name);
  return n;
}

type SiteRoom = { site: string; key: string };
async function siteRoomMapping(db: Db): Promise<SiteRoom[]> {
  const rs = await db.execute(
    "SELECT s.id AS site, r.room_key AS room_key FROM sites s LEFT JOIN site_document_rooms r ON r.site_id=s.id ORDER BY s.id"
  );
  return rs.rows.map(row => {
    if (typeof row.site !== "string" || typeof row.room_key !== "string" || !row.room_key) {
      throw new AssetGcAbortedError("Site has no readable document room");
    }
    return { site: row.site, key: row.room_key };
  });
}

/** すべてのサイトの、現在保存されている文書を調べる。RPC や世代の確認に1件でも失敗したら中止する。 */
export async function collectAllAssetReferences(
  db: Db, rooms: AssetGcDocumentNamespace,
): Promise<Set<string>> {
  if (db.backend !== "d1") throw new AssetGcAbortedError("Cloudflare D1 required");
  const before = await siteRoomMapping(db);
  const referenced = new Set<string>();
  for (let offset = 0; offset < before.length; offset += 4) {
    const chunk = before.slice(offset, offset + 4);
    const refs = await Promise.all(chunk.map(async ({ key }) =>
      rooms.get(rooms.idFromName(key)).gcAssetReferences()
    ));
    for (const paths of refs) {
      if (!Array.isArray(paths) || paths.some(path =>
        typeof path !== "string" || !path.startsWith("assets/"))) {
        throw new AssetGcAbortedError("Invalid document reference response");
      }
      for (const path of paths) referenced.add(path);
    }
  }
  const after = await siteRoomMapping(db);
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    throw new AssetGcAbortedError("Site list or document generation changed during scan");
  }
  return referenced;
}

/** エディタでアセットを明示的に削除したときに、7日間の計測を始める（やり直す）。
 * 保存に失敗しても害は無い。毎晩の処理で、すべての現在のサイトを確認し直す。
 * 週1回の棚卸しでは、この関数を使ってはいけない（棚卸しは計測の時刻を変えない）。
 */
export async function recordAssetGcCandidates(
  db: Db, paths: readonly string[], now = Date.now(),
): Promise<number> {
  if (db.backend !== "d1") return 0;
  if (!Number.isSafeInteger(now)) throw new RangeError("Invalid observation time");
  const valid = [...new Set(paths.filter(path =>
    typeof path === "string" && assetUploadedAt(path) !== null))];
  if (!valid.length) return 0;
  let registered = 0;
  // 1つの SQL 文で数百のパスを記録し、ファイルごとに D1 の RPC を呼ばない。
  for (let i = 0; i < valid.length; i += 200) {
    const rs = await db.execute({
      sql: `INSERT INTO asset_gc_candidates(path,first_unreferenced_at,last_seen_at,bytes)
        SELECT value, ?, ?, NULL FROM json_each(?) WHERE true
        ON CONFLICT(path) DO UPDATE SET
          first_unreferenced_at=excluded.first_unreferenced_at,
          last_seen_at=excluded.last_seen_at`,
      args: [now, now, JSON.stringify(valid.slice(i, i + 200))],
    });
    registered += rs.rowsAffected;
  }
  return registered;
}

async function finishRun(db: Db, id: number, fields: {
  status: "ok" | "aborted" | "failed";
  now: number; kvKeys: number; referenced: number; candidates: number;
  dryRun: boolean; deleted: number; deletedBytes: number;
  error?: string | null;
}) {
  await db.execute({
    sql: `UPDATE asset_gc_runs SET finished_at=?, status=?, kv_keys=?, referenced=?,
      candidates=?, deleted=?, deleted_bytes=?, dry_run=?, error=? WHERE id=?`,
    args: [fields.now, fields.status, fields.kvKeys, fields.referenced,
      fields.candidates, fields.deleted, fields.deletedBytes, fields.dryRun ? 1 : 0,
      fields.error ?? null, id],
  });
}

// Workers KV の list は1回で最大1,000個のキーを返す。週1回の処理で呼ぶのは1回だけ。
const PAGE_LIMIT = 1000;
const LEASE_MS = 20 * 60 * 1000;
const PREVIEW_LIMIT = 2000;
/**
 * Workers の無料プランでは、1回の呼び出しで Cloudflare のサービス（D1・KV・DO）への
 * サブリクエストを1,000回まで行える。10% は呼び出し側（管理用ルートの認証の確認）のために残す。
 * 物理的な削除1件ごとに、D1 での再確認・KV の削除・D1 の削除がかかり、
 * さらに処理の最後に件数の記録・実行ログ・リースの解放が必ず必要になる。
 */
export const GC_INTERNAL_SUBREQUEST_BUDGET = 900;
const SUBREQUESTS_PER_DELETE = 3;
const SUBREQUESTS_TO_FINISH = 3;

/** Cloudflare のサービスへの呼び出しをすべて数え、予算の範囲内で削除を止める。 */
function countSubrequests(db: Db, kv: AssetGcKv, rooms: AssetGcDocumentNamespace) {
  let used = 0;
  return {
    db: {
      backend: db.backend,
      execute: (stmt) => { used++; return db.execute(stmt); },
      batch: (stmts) => { used++; return db.batch(stmts); },
    } satisfies Db,
    // バインディング自身を通して呼ぶ。プラットフォームのバインディングは、別のレシーバーからの呼び出しを拒否する。
    kv: {
      delete: (key: string) => { used++; return kv.delete(key); },
      ...(kv.list ? { list: (options: Parameters<NonNullable<KVLikeNamespace["list"]>>[0]) => {
        used++; return kv.list!(options);
      } } : {}),
    } satisfies AssetGcKv,
    rooms: {
      idFromName: (name: string) => rooms.idFromName(name),
      get: (id: unknown) => {
        const stub = rooms.get(id);
        return { gcAssetReferences: () => { used++; return stub.gcAssetReferences(); } };
      },
    } satisfies AssetGcDocumentNamespace,
    used: () => used,
  };
}

function candidateFromRow(row: Record<string, unknown>): GcCandidate {
  const path = String(row.path);
  return {
    path,
    firstUnreferencedAt: Number(row.first_unreferenced_at),
    lastSeenAt: Number(row.last_seen_at),
    bytes: typeof row.bytes === "number" && Number.isSafeInteger(row.bytes)
      ? row.bytes : null,
  };
}

/** クライアント側の削除の操作で漏れたパスを、KV の1ページ分から探す。
 * 週1回だけ呼び、毎日の cron では呼ばない。
 */
async function discoverOrphans(
  db: Db, kv: AssetGcKv, refs: ReadonlySet<string>,
  now: number, token: string, state: Record<string, unknown>,
): Promise<{ scanned: number; complete: boolean }> {
  if (!kv.list) throw new AssetGcAbortedError("KV listing is unavailable");
  const previousCursor = typeof state.scan_cursor === "string" ? state.scan_cursor : "";
  const scanStarted = typeof state.scan_started_at === "number" && state.scan_started_at > 0
    ? state.scan_started_at : now;
  const page = await kv.list({ prefix: "assets/", limit: PAGE_LIMIT,
    ...(previousCursor ? { cursor: previousCursor } : {}) });
  if (!page || !Array.isArray(page.keys) || typeof page.list_complete !== "boolean") {
    throw new Error("Invalid KV listing response");
  }
  const seen = new Set<string>();
  const candidates: Array<{ path: string; bytes: number | null }> = [];
  // 列挙したキーは、参照されているかにかかわらず、すべて保存先の台帳に載せる。
  const objects: Array<{ path: string; bytes: number | null; uploadedAt: number }> = [];
  for (const item of page.keys) {
    const path = item?.name;
    if (typeof path !== "string" || !path.startsWith("assets/") || seen.has(path)) {
      throw new Error("Invalid KV key");
    }
    seen.add(path);
    const size = item.metadata?.bytes;
    const bytes = typeof size === "number" && Number.isSafeInteger(size) && size >= 0 ? size : null;
    const uploadedAt = assetUploadedAt(path);
    objects.push({ path, bytes, uploadedAt: uploadedAt ?? now });
    if (refs.has(path) || uploadedAt === null) continue;
    candidates.push({ path, bytes });
  }
  const next = page.list_complete ? null : (page.cursor ?? null);
  if (!page.list_complete && (!next || previousCursor === next)) {
    throw new Error("KV pagination did not advance");
  }
  // 棚卸しでは、削除の操作で記録した最初の観測時刻を決して変えない。
  // 候補の書き込みとカーソルの前進は、原子的に確定する。
  await db.batch([
    { sql: `INSERT INTO asset_gc_candidates(path,first_unreferenced_at,last_seen_at,bytes)
        SELECT json_extract(value,'$.path'), ?, ?, json_extract(value,'$.bytes')
        FROM json_each(?) WHERE true
        ON CONFLICT(path) DO UPDATE SET last_seen_at=excluded.last_seen_at,
          bytes=COALESCE(excluded.bytes,asset_gc_candidates.bytes)`,
      args: [now, now, JSON.stringify(candidates)] },
    { sql: `INSERT INTO asset_objects(path,bytes,uploaded_at,last_seen_at)
        SELECT json_extract(value,'$.path'), json_extract(value,'$.bytes'), json_extract(value,'$.uploadedAt'), ?
        FROM json_each(?) WHERE true
        ON CONFLICT(path) DO UPDATE SET last_seen_at=excluded.last_seen_at,
          bytes=COALESCE(excluded.bytes,asset_objects.bytes)`,
      args: [now, JSON.stringify(objects)] },
    { sql: `UPDATE asset_gc_state SET scan_cursor=?, scan_started_at=?
        WHERE id=1 AND lease_token=?`,
      args: [next, page.list_complete ? null : scanStarted, token] },
  ]);
  if (page.list_complete) {
    // どのオブジェクトが KV から消えたかが分かるのは、完了した棚卸しだけ。
    // 調査を始めた後に行われた削除の操作やアップロードを捨ててはいけない。
    await db.batch([
      { sql: "DELETE FROM asset_gc_candidates WHERE last_seen_at < ? AND first_unreferenced_at < ?",
        args: [scanStarted, scanStarted] },
      { sql: "DELETE FROM asset_objects WHERE last_seen_at < ? AND uploaded_at < ?",
        args: [scanStarted, scanStarted] },
      // 台帳より前からあったキーは、すでに進行中だった調査で見落とされた可能性がある。
      // 完全であることを示せるのは、その後に始めた調査だけ。
      { sql: "UPDATE asset_ledger_state SET complete_at=? WHERE id=1 AND created_at <= ?",
        args: [now, scanStarted] },
    ]);
  }
  return { scanned: page.keys.length, complete: page.list_complete };
}

/** 毎日の期限切れの片付けを行う。週1回は、範囲を限った KV の1ページ分の照合も行う。
 * 現在のすべてのサイトの文書を調べるのは、期限切れの候補があるときだけ。
 * どれか1つのサイトでも読めなければ、物理的な削除は中止する。
 */
export async function runAssetGc({
  db: rawDb, kv: rawKv, rooms: rawRooms, now = Date.now(), graceDays, maxDeletes, dryRun = true,
  discoverUntracked = false,
}: AssetGcDependencies): Promise<AssetGcReport> {
  const { db, kv, rooms, used } = countSubrequests(rawDb, rawKv, rawRooms);
  if (db.backend !== "d1" || discoverUntracked && !kv.list) {
    throw new AssetGcAbortedError("Cloudflare storage is unavailable");
  }
  if (!Number.isSafeInteger(now) || typeof dryRun !== "boolean") {
    throw new RangeError("Invalid GC settings");
  }
  const grace = positiveInteger(graceDays, 7, 3650, "ASSET_GC_GRACE_DAYS") * 86_400_000;
  const max = positiveInteger(maxDeletes, 500, 500, "ASSET_GC_MAX_DELETES");
  const opened = await db.execute({
    sql: "INSERT INTO asset_gc_runs(started_at,status,dry_run) VALUES(?,'aborted',?) RETURNING id",
    args: [now, dryRun ? 1 : 0],
  });
  const id = Number(opened.rows[0]?.id);
  if (!Number.isSafeInteger(id)) throw new Error("Unable to log GC run");
  const token = crypto.randomUUID();
  let locked = false, scanned = 0, referencedCount = 0;
  let candidateCount = 0, deleted = 0, deletedBytesKnown = 0;
  let scanComplete = true;
  const deletedPaths: string[] = [];
  let stage: "start" | "references" | "inventory" | "sweep" | "finish" = "start";
  try {
    const lock = await db.execute({
      sql: `UPDATE asset_gc_state SET lease_until=?, lease_token=?
        WHERE id=1 AND lease_until < ? RETURNING scan_cursor,scan_started_at`,
      args: [now + LEASE_MS, token, now],
    });
    if (!lock.rows.length) throw new AssetGcAbortedError("Another GC run is in progress");
    locked = true;
    let refs: Set<string> | null = null;
    if (discoverUntracked) {
      stage = "references";
      try { refs = await collectAllAssetReferences(db, rooms); }
      catch { throw new AssetGcAbortedError("Unable to read current documents"); }
      referencedCount = refs.size;
      stage = "inventory";
      const inventory = await discoverOrphans(db, kv, refs, now, token, lock.rows[0]);
      scanned = inventory.scanned;
      scanComplete = inventory.complete;
    }
    // 毎日の処理では KV.list を呼ばず、最も古い期限切れの D1 の候補だけを扱う。
    const due = await db.execute({
      sql: `SELECT path,first_unreferenced_at,last_seen_at,bytes FROM asset_gc_candidates
        WHERE first_unreferenced_at <= ?
        ORDER BY first_unreferenced_at,path LIMIT ?`,
      args: [now - grace, PREVIEW_LIMIT + 1],
    });
    const limited = due.rows.slice(0, PREVIEW_LIMIT);
    const candidates = new Map<string, GcCandidate>(
      limited.map(row => [String(row.path), candidateFromRow(row)]));
    const plan = planAssetGc({
      kvKeys: limited.map(row => ({ name: String(row.path) })),
      candidates, referenced: new Set(), now, graceMs: grace, maxDeletes: max,
    });
    let eligible = plan.eligible;
    if (eligible.length) {
      stage = "references";
      // 削除しない試行でも、実行ログに現在使われていないキーだけを数えるため必要。
      // 週1回の棚卸しはこの実行ですべてのサイトを調べたばかりなので、その結果を使い回し、
      // サイトごとの Durable Object の呼び出しを1回省く。削除の前には、下で改めて調べる。
      if (!refs) {
        try { refs = await collectAllAssetReferences(db, rooms); }
        catch { throw new AssetGcAbortedError("Unable to read current documents"); }
      }
      referencedCount = refs.size;
      const protectedNow = eligible.filter(item => refs!.has(item.path));
      if (protectedNow.length) {
        await db.execute({
          sql: "DELETE FROM asset_gc_candidates WHERE path IN (SELECT value FROM json_each(?))",
          args: [JSON.stringify(protectedNow.map(item => item.path))],
        });
      }
      eligible = eligible.filter(item => !refs!.has(item.path));
      if (!dryRun && eligible.length) {
        stage = "sweep";
        // 候補を選んで D1 に書き込んだ後、物理的な削除の直前にもう一度確かめる。
        // サイトを1つでも読めなければ、新しい KV の削除は行わない。
        let lastRefs: Set<string>;
        try { lastRefs = await collectAllAssetReferences(db, rooms); }
        catch { throw new AssetGcAbortedError("Final reference scan failed"); }
        referencedCount = lastRefs.size;
        const recovered = eligible.filter(item => lastRefs.has(item.path));
        if (recovered.length) {
          await db.execute({
            sql: "DELETE FROM asset_gc_candidates WHERE path IN (SELECT value FROM json_each(?))",
            args: [JSON.stringify(recovered.map(item => item.path))],
          });
        }
        eligible = eligible.filter(item => !lastRefs.has(item.path));
        // KV の削除は、D1 への記録より後まで残ることがある。すでに存在しない KV のキーを
        // 削除しても結果は変わらないため、残った候補は安全に再試行できる。
        // 上のサイトの調査ではサイトごとに Durable Object の呼び出しが1回かかるため、
        // 削除できる件数はデプロイの規模によって変わる。上限の前で止める。
        for (const item of eligible) {
          if (used() + SUBREQUESTS_PER_DELETE + SUBREQUESTS_TO_FINISH > GC_INTERNAL_SUBREQUEST_BUDGET) break;
          const check = await db.execute({
            sql: "SELECT first_unreferenced_at FROM asset_gc_candidates WHERE path=?",
            args: [item.path],
          });
          if (Number(check.rows[0]?.first_unreferenced_at) !== item.firstUnreferencedAt) continue;
          await kv.delete(item.path);
          deleted++;
          deletedBytesKnown += item.bytes ?? 0;
          deletedPaths.push(item.path);
          // 1回のバッチにまとめ、削除1件あたりのサブリクエストを3回に抑える。
          await db.batch([
            { sql: "DELETE FROM asset_gc_candidates WHERE path=? AND first_unreferenced_at=?",
              args: [item.path, item.firstUnreferencedAt] },
            { sql: "DELETE FROM asset_objects WHERE path=?", args: [item.path] },
          ]);
        }
      }
    }
    stage = "finish";
    const counts = await db.execute(
      "SELECT COUNT(*) AS total, COALESCE(SUM(bytes),0) AS bytes FROM asset_gc_candidates"
    );
    candidateCount = Number(counts.rows[0]?.total ?? 0);
    await finishRun(db, id, { status: "ok", now: Date.now(), kvKeys: scanned,
      referenced: referencedCount, candidates: candidateCount,
      dryRun, deleted, deletedBytes: deletedBytesKnown });
    return {
      status: "ok", dryRun, sweepSupported: true, kvKeysScanned: scanned,
      referenced: referencedCount, candidates: candidateCount,
      candidateBytesKnown: Number(counts.rows[0]?.bytes ?? 0),
      scanComplete, deleted, deletedBytesKnown, deletedPaths,
      potentialDeletePaths: eligible.map(item => item.path),
      potentialDeleteBytesKnown: eligible.reduce((sum, item) => sum + (item.bytes ?? 0), 0),
      previewTruncated: due.rows.length > PREVIEW_LIMIT || plan.remainingEligible > 0,
    };
  } catch (error) {
    const aborted = stage === "references" || error instanceof AssetGcAbortedError;
    await finishRun(db, id, { status: aborted ? "aborted" : "failed",
      now: Date.now(), kvKeys: scanned, referenced: referencedCount,
      candidates: candidateCount, dryRun, deleted, deletedBytes: deletedBytesKnown,
      error: aborted ? "Current-document scan or lease failed" : "KV inventory or sweep failed",
    }).catch(() => {});
    throw new AssetGcAbortedError(aborted ? "Asset GC safely aborted" : "Asset GC failed");
  } finally {
    if (locked) await db.execute({
      sql: "UPDATE asset_gc_state SET lease_until=0,lease_token=NULL WHERE id=1 AND lease_token=?",
      args: [token],
    }).catch(() => {});
  }
}
