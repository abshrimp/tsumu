import { validAssetEntry, validNodeForest } from "./doc-tree";
import type { Db, ResultSet } from "./db";
import { applyDocPatch, isDocPatch, type DocPatch } from "./doc-patch";
import { decodeStoredDoc, encodeStoredDoc, StoredDocTooLargeError } from "./compressed-doc-storage";
import type { SiteDoc } from "./types";

/**
 * 編集データの保存（D1 の docs テーブル。1サイト = 1行で、id はサイトID）。
 * docs.body は常にgzipレベル3のv1エンベロープ。D1への書込み前に1.8MBの上限を検査する。
 */

/** 保存先に入りきらない編集データ（API は 413 で返す） */
export class DocTooLargeError extends Error {
  constructor() {
    super("ドキュメントが大きすぎて、保存先に入りきりません");
  }
}

/** A delta would make the document impossible to reopen. */
export class InvalidDocPatchError extends Error {
  constructor() { super("不正なリクエスト"); }
}

export interface CurrentDoc {
  rev: string;
  savedAt: number;
  body: string;
}

export type SaveDocResult =
  | { kind: "saved"; rev: string; savedAt: number }
  | { kind: "conflict"; current: CurrentDoc }
  /** サイトが無い（ほかのタブ・人が消した）。編集データを作り直さない */
  | { kind: "missing" };

/** 本文の形を確かめる（大きさは保存するときに、保存先の上限で確かめる） */
export function validateDocBody(raw: string): string | null {
  try { return validateDocValue(JSON.parse(raw)); }
  catch { return "JSONが壊れています"; }
}

export function validateDocValue(parsed: unknown): string | null {
  const record = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === "object" && !Array.isArray(value);
  if (!record(parsed) || typeof parsed.siteName !== "string" ||
      !record(parsed.pages) || !record(parsed.nodes) || !record(parsed.assets) ||
      !Array.isArray(parsed.pageOrder) || !parsed.pageOrder.length) {
    return "不正なリクエスト";
  }
  if (!Object.entries(parsed.assets).every(([id, a]) => validAssetEntry(id, a)) ||
      !validNodeForest(parsed.pages, parsed.nodes, parsed.components)) return "不正なリクエスト";
  const order = parsed.pageOrder;
  const pages = parsed.pages as Record<string, unknown>;
  if (new Set(order).size !== order.length ||
      !order.every(id => typeof id === "string" && Object.hasOwn(pages, id))) {
    return "不正なリクエスト";
  }
  return null;
}

/** 保存先の上限を超えた値は SQLITE_TOOBIG になる（D1 では「string or blob too big」）。大きさのエラーとして返す */
async function write(db: Db, stmt: Parameters<Db["execute"]>[0]): Promise<ResultSet> {
  try {
    return await db.execute(stmt);
  } catch (e) {
    if (/SQLITE_TOOBIG|too big/i.test(e instanceof Error ? e.message : String(e))) {
      throw new DocTooLargeError();
    }
    throw e;
  }
}

export async function readCurrentDoc(db: Db, siteId: string): Promise<CurrentDoc | null> {
  const rs = await db.execute({
    sql: "SELECT rev, saved_at, body FROM docs WHERE id = ?",
    args: [siteId],
  });
  const row = rs.rows[0];
  if (!row) return null;
  const body = await decodeStoredDoc(String(row.body));
  if (validateDocBody(body)) throw new Error("保存済みの編集データが不正です");
  return {
    rev: String(row.rev),
    savedAt: Number(row.saved_at),
    body,
  };
}

/**
 * 日次バックアップ（曜日で7世代ローテーション）。日付（UTC）が変わってから最初の保存の直前に、
 * それまでの内容（前に編集した日の最後の内容）を、その日の曜日の枠へ残す。
 * 保存した後の内容を残すと、その日最初の保存で壊したときに壊れた内容しか残らないため
 */
async function backupPreviousDay(db: Db, siteId: string, now: number) {
  try {
    const dayStart = Math.floor(now / 86_400_000) * 86_400_000;
    // 本文をWorkerへ取り出さずDB内でコピーする。並行保存でも、より新しい内容でだけ上書きする。
    await db.execute({
      sql: `INSERT INTO site_backups (site_id, day, saved_at, body)
        SELECT id, CAST(strftime('%w', saved_at / 1000, 'unixepoch') AS INTEGER), saved_at, body
        FROM docs WHERE id = ? AND saved_at < ?
        ON CONFLICT(site_id, day) DO UPDATE SET saved_at = excluded.saved_at, body = excluded.body
        WHERE site_backups.saved_at < excluded.saved_at`,
      args: [siteId, dayStart],
    });
  } catch {
    // バックアップの失敗は保存自体に影響させない
  }
}

export async function saveCurrentDoc(
  db: Db,
  siteId: string,
  raw: string,
  base: string | null
): Promise<SaveDocResult> {
  if (validateDocBody(raw)) throw new InvalidDocPatchError();
  let stored: string;
  try { stored = await encodeStoredDoc(raw); }
  catch (error) {
    if (error instanceof StoredDocTooLargeError) throw new DocTooLargeError();
    throw error;
  }
  const now = Date.now();
  if (base) {
    await backupPreviousDay(db, siteId, now);
    const rs = await write(db, {
      sql: "UPDATE docs SET body = ?, rev = rev + 1, saved_at = ? WHERE id = ? AND rev = ? RETURNING rev",
      args: [stored, now, siteId, Number(base)],
    });
    if (rs.rows.length) {
      return { kind: "saved", rev: String(rs.rows[0].rev), savedAt: now };
    }
    const current = await readCurrentDoc(db, siteId);
    if (current) return { kind: "conflict", current };
    return { kind: "missing" };
  }

  // サイトの一覧に無い編集データは作らない（消したサイトを開いたままのタブが保存すると、
  // 一覧に出ないデータが残り、そのアセットも「ほかのサイトが使用中」として消せなくなる）
  const rs = await write(db, {
    // base の無い保存は初回作成だけ。読み込み失敗や同時作成でも既存データを上書きしない。
    sql: "INSERT INTO docs (id, rev, saved_at, body) SELECT ?, 1, ?, ? WHERE EXISTS (SELECT 1 FROM sites WHERE id = ?) ON CONFLICT(id) DO NOTHING RETURNING rev",
    args: [siteId, now, stored, siteId],
  });
  if (!rs.rows.length) {
    const current = await readCurrentDoc(db, siteId);
    return current ? { kind: "conflict", current } : { kind: "missing" };
  }
  return { kind: "saved", rev: String(rs.rows[0].rev), savedAt: now };
}

/** 本文を取得せず、版の照合と差分反映を1つのSQLで原子的に行う。 */
export async function saveDocPatch(db: Db, siteId: string, patch: DocPatch, base: string): Promise<SaveDocResult> {
  if (!/^[1-9]\d*$/.test(base) || !Number.isSafeInteger(Number(base)) || !isDocPatch(patch))
    throw new InvalidDocPatchError();

  // A compressed payload is not SQLite JSON. There is only one update path:
  // decode -> apply patch -> validate -> encode -> revision-conditional write.
  const current = await readCurrentDoc(db, siteId);
  if (!current) return { kind: "missing" };
  if (current.rev !== base) return { kind: "conflict", current };
  let updated: SiteDoc;
  try {
    updated = applyDocPatch(JSON.parse(current.body) as SiteDoc, patch);
  } catch {
    throw new InvalidDocPatchError();
  }
  if (validateDocValue(updated)) throw new InvalidDocPatchError();
  // saveCurrentDoc performs the same rev-based CAS as PUT. Concurrent changes
  // cannot be overwritten even if they arrive during compression.
  return saveCurrentDoc(db, siteId, JSON.stringify(updated), base);
}
