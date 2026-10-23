import type { Db } from "./db";
import { isDocPatch, type DocPatch } from "./doc-patch";

/** 編集データの保存（D1 の docs テーブル。1サイト = 1行で、id はサイトID） */
export const MAX_DOC_BYTES = 10 * 1024 * 1024;

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
async function writeDailyBackup(db: Db, siteId: string, now: number) {
  try {
    const day = new Date(now).getUTCDay();
    const dayStart = Math.floor(now / 86_400_000) * 86_400_000;
    // 本文をWorkerへ取り出さずDB内でコピーする。並行保存でも同日のバックアップは上書きしない。
    await db.execute({
      sql: "INSERT INTO site_backups (site_id, day, saved_at, body) SELECT id, ?, saved_at, body FROM docs WHERE id = ? AND saved_at >= ? AND saved_at < ? AND NOT EXISTS (SELECT 1 FROM site_backups WHERE site_id = ? AND day = ? AND saved_at >= ?) ON CONFLICT(site_id, day) DO UPDATE SET saved_at = excluded.saved_at, body = excluded.body WHERE site_backups.saved_at < ?",
      args: [day, siteId, dayStart, dayStart + 86_400_000, siteId, day, dayStart, dayStart],
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
  const now = Date.now();
  if (base) {
    const rs = await db.execute({
      sql: "UPDATE docs SET body = ?, rev = rev + 1, saved_at = ? WHERE id = ? AND rev = ? RETURNING rev",
      args: [raw, now, siteId, Number(base)],
    });
    if (rs.rows.length) {
      await writeDailyBackup(db, siteId, now);
      return { kind: "saved", rev: String(rs.rows[0].rev), savedAt: now };
    }
    const current = await readCurrentDoc(db, siteId);
    if (current) return { kind: "conflict", current };
    return { kind: "missing" };
  }

  // サイトの一覧に無い編集データは作らない（消したサイトを開いたままのタブが保存すると、
  // 一覧に出ないデータが残り、そのアセットも「ほかのサイトが使用中」として消せなくなる）
  const rs = await db.execute({
    // base の無い保存は初回作成だけ。読み込み失敗や同時作成でも既存データを上書きしない。
    sql: "INSERT INTO docs (id, rev, saved_at, body) SELECT ?, 1, ?, ? WHERE EXISTS (SELECT 1 FROM sites WHERE id = ?) ON CONFLICT(id) DO NOTHING RETURNING rev",
    args: [siteId, now, raw, siteId],
  });
  if (!rs.rows.length) {
    const current = await readCurrentDoc(db, siteId);
    return current ? { kind: "conflict", current } : { kind: "missing" };
  }
  await writeDailyBackup(db, siteId, now);
  return { kind: "saved", rev: String(rs.rows[0].rev), savedAt: now };
}

/** 本文を取得せず、版の照合と差分反映を1つのSQLで原子的に行う。 */
export async function saveDocPatch(db: Db, siteId: string, patch: DocPatch, base: string): Promise<SaveDocResult> {
  if (!/^[1-9]\d*$/.test(base) || !Number.isSafeInteger(Number(base)) || !isDocPatch(patch)) {
    throw new Error("不正なリクエスト");
  }
  if (new TextEncoder().encode(JSON.stringify(patch)).byteLength > MAX_DOC_BYTES) {
    throw new Error("ドキュメントが大きすぎます（10MBまで）");
  }
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
  const rs = await db.execute({
    sql: `WITH patched AS MATERIALIZED (SELECT ${body} AS body FROM docs WHERE id = ? AND rev = ?) UPDATE docs SET body = (SELECT body FROM patched), rev = rev + 1, saved_at = ? WHERE id = ? AND rev = ? AND (SELECT length(CAST(body AS BLOB)) FROM patched) <= ? RETURNING rev`,
    args: [...args, siteId, Number(base), now, siteId, Number(base), MAX_DOC_BYTES],
  });
  if (rs.rows.length) {
    await writeDailyBackup(db, siteId, now);
    return { kind: "saved", rev: String(rs.rows[0].rev), savedAt: now };
  }
  const current = await readCurrentDoc(db, siteId);
  if (current?.rev === base) throw new Error("ドキュメントが大きすぎます（10MBまで）");
  return current ? { kind: "conflict", current } : { kind: "missing" };
}
