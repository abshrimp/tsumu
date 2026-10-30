import type { Db, ResultSet } from "./db";
import { isDocPatch, type DocPatch } from "./doc-patch";

/**
 * 編集データの保存（D1 の docs テーブル。1サイト = 1行で、id はサイトID）。
 * 大きさはアプリとして10MBまで。保存先がそれより小さければ（D1 は約2MB）、そちらに合わせる（docLimit）
 */
export const MAX_DOC_BYTES = 10 * 1024 * 1024;

export const byteLength = (s: string): number => new TextEncoder().encode(s).byteLength;

/** 上限の表示（10MB・2MB など） */
export function formatDocLimit(bytes: number): string {
  return bytes >= 1_000_000 ? `${Math.round(bytes / 1_000_000)}MB` : `${Math.ceil(bytes / 1000)}KB`;
}

/** 保存先に入りきらない編集データ（API は 413 で返す） */
export class DocTooLargeError extends Error {
  constructor(readonly limit: number) {
    super(`ドキュメントが大きすぎます（${formatDocLimit(limit)}まで）`);
  }
}

/** この保存先に置ける編集データの大きさ（バイト） */
export function docLimit(db: Pick<Db, "maxValueBytes">): number {
  return Math.min(MAX_DOC_BYTES, db.maxValueBytes);
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
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return "JSONが壊れています";
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !("pages" in parsed) ||
    !("nodes" in parsed) ||
    !("assets" in parsed) ||
    !("pageOrder" in parsed) ||
    !Array.isArray((parsed as { pageOrder?: unknown }).pageOrder) ||
    // ページが1つも無いデータはエディタが読み込めず、開けなくなる（バックアップからも戻せない）
    !(parsed as { pageOrder: unknown[] }).pageOrder.length
  ) {
    return "不正なリクエスト";
  }
  return null;
}

/** D1 の上限を超えた値は SQLITE_TOOBIG になる。上限の見込みが外れても、大きさのエラーとして返す */
async function write(db: Db, stmt: Parameters<Db["execute"]>[0]): Promise<ResultSet> {
  try {
    return await db.execute(stmt);
  } catch (e) {
    if (/SQLITE_TOOBIG|too big/i.test(e instanceof Error ? e.message : String(e))) {
      throw new DocTooLargeError(docLimit(db));
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
  return {
    rev: String(row.rev),
    savedAt: Number(row.saved_at),
    body: String(row.body),
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
  if (byteLength(raw) > docLimit(db)) throw new DocTooLargeError(docLimit(db));
  const now = Date.now();
  if (base) {
    await backupPreviousDay(db, siteId, now);
    const rs = await write(db, {
      sql: "UPDATE docs SET body = ?, rev = rev + 1, saved_at = ? WHERE id = ? AND rev = ? RETURNING rev",
      args: [raw, now, siteId, Number(base)],
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
    args: [siteId, now, raw, siteId],
  });
  if (!rs.rows.length) {
    const current = await readCurrentDoc(db, siteId);
    return current ? { kind: "conflict", current } : { kind: "missing" };
  }
  return { kind: "saved", rev: String(rs.rows[0].rev), savedAt: now };
}

/** 本文を取得せず、版の照合と差分反映を1つのSQLで原子的に行う。 */
export async function saveDocPatch(db: Db, siteId: string, patch: DocPatch, base: string): Promise<SaveDocResult> {
  if (!/^[1-9]\d*$/.test(base) || !Number.isSafeInteger(Number(base)) || !isDocPatch(patch)) {
    throw new Error("不正なリクエスト");
  }
  const limit = docLimit(db);
  if (byteLength(JSON.stringify(patch)) > limit) throw new DocTooLargeError(limit);
  const args: (string | number | null)[] = [];
  let body = "body";
  // D1の関数引数数上限にも収める（1回のjson_setは本文 + 12組のパス・値）。
  for (let i = 0; i < patch.length; i += 12) {
    const chunk = patch.slice(i, i + 12);
    const sets: string[] = [];
    const removes: string[] = [];
    for (const op of chunk.filter((op) => !("remove" in op))) {
      sets.push("?, json(?)");
      args.push(`$.${op.path.join(".")}`, JSON.stringify("value" in op ? op.value : null));
    }
    if (sets.length) body = `json_set(${body}, ${sets.join(", ")})`;
    for (const op of chunk.filter((op) => "remove" in op)) {
      removes.push("?");
      args.push(`$.${op.path.join(".")}`);
    }
    if (removes.length) body = `json_remove(${body}, ${removes.join(", ")})`;
  }
  const now = Date.now();
  await backupPreviousDay(db, siteId, now);
  const rs = await write(db, {
    sql: `WITH patched AS MATERIALIZED (SELECT ${body} AS body FROM docs WHERE id = ? AND rev = ?) UPDATE docs SET body = (SELECT body FROM patched), rev = rev + 1, saved_at = ? WHERE id = ? AND rev = ? AND (SELECT length(CAST(body AS BLOB)) FROM patched) <= ? RETURNING rev`,
    args: [...args, siteId, Number(base), now, siteId, Number(base), limit],
  });
  if (rs.rows.length) {
    return { kind: "saved", rev: String(rs.rows[0].rev), savedAt: now };
  }
  const current = await readCurrentDoc(db, siteId);
  if (current?.rev === base) throw new DocTooLargeError(limit);
  return current ? { kind: "conflict", current } : { kind: "missing" };
}
