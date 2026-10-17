import type { Db } from "./db";

/** 編集データの保存（D1 の docs テーブル。1サイト = 1行で、id はサイトID） */
export const MAX_DOC_BYTES = 10 * 1024 * 1024;

export interface CurrentDoc {
  rev: string;
  savedAt: number;
  body: string;
}

export type SaveDocResult =
  | { kind: "saved"; rev: string; savedAt: number }
  | { kind: "conflict"; current: CurrentDoc };

export function validateDocBody(raw: string): string | null {
  if (new TextEncoder().encode(raw).byteLength > MAX_DOC_BYTES) {
    return "ドキュメントが大きすぎます（10MBまで）";
  }
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
    !Array.isArray((parsed as { pageOrder?: unknown }).pageOrder)
  ) {
    return "不正なリクエスト";
  }
  return null;
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

/** 日次バックアップ（曜日で7世代ローテーション、1日1回だけ書く） */
async function writeDailyBackup(db: Db, siteId: string, raw: string, now: number) {
  try {
    const day = new Date(now).getUTCDay();
    const today = new Date(now).toISOString().slice(0, 10);
    const rs = await db.execute({
      sql: "SELECT saved_at FROM site_backups WHERE site_id = ? AND day = ?",
      args: [siteId, day],
    });
    const last = rs.rows[0]
      ? new Date(Number(rs.rows[0].saved_at)).toISOString().slice(0, 10)
      : null;
    if (last !== today) {
      await db.execute({
        sql: "INSERT INTO site_backups (site_id, day, saved_at, body) VALUES (?, ?, ?, ?) ON CONFLICT(site_id, day) DO UPDATE SET saved_at = excluded.saved_at, body = excluded.body",
        args: [siteId, day, now, raw],
      });
    }
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
  const now = Date.now();
  if (base) {
    const rs = await db.execute({
      sql: "UPDATE docs SET body = ?, rev = rev + 1, saved_at = ? WHERE id = ? AND rev = ? RETURNING rev",
      args: [raw, now, siteId, Number(base)],
    });
    if (rs.rows.length) {
      await writeDailyBackup(db, siteId, raw, now);
      return { kind: "saved", rev: String(rs.rows[0].rev), savedAt: now };
    }
    const current = await readCurrentDoc(db, siteId);
    if (current) return { kind: "conflict", current };
  }

  const rs = await db.execute({
    sql: "INSERT INTO docs (id, rev, saved_at, body) VALUES (?, 1, ?, ?) ON CONFLICT(id) DO UPDATE SET body = excluded.body, rev = docs.rev + 1, saved_at = excluded.saved_at RETURNING rev",
    args: [siteId, now, raw],
  });
  await writeDailyBackup(db, siteId, raw, now);
  return { kind: "saved", rev: String(rs.rows[0].rev), savedAt: now };
}
