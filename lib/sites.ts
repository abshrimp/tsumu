import type { Db } from "./db";
import { allowedEmails } from "./allowlist";
import {
  DEFAULT_BRANCH,
  isSiteRole,
  type SiteDest,
  type SiteRecord,
} from "./site-model";

/**
 * サイト（1つの編集データと、その公開先）のサーバー保存。
 * 一覧と公開先は D1 の sites テーブルに、編集データはサイトごとの DocumentRoom に保存する。
 * Node.js・Docker では、同じサイトの情報をローカルの SQLite に保存する。
 * D1 が無いときは、ブラウザの中（lib/site.ts）に同じ形で保存する
 */

/* ---------- D1 ---------- */

function toRecord(r: Record<string, unknown>): SiteRecord {
  const str = (v: unknown) => (v === null || v === undefined || v === "" ? null : String(v));
  return {
    id: String(r.id),
    name: String(r.name),
    repo: str(r.repo),
    gitProvider: r.git_provider === "gitlab" ? "gitlab" : "github",
    branch: String(r.branch || DEFAULT_BRANCH),
    previewBranch: String(r.preview_branch ?? ""),
    siteUrl: str(r.site_url),
    previewUrl: str(r.preview_url),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
    ...("saved_at" in r ? { savedAt: r.saved_at === null ? null : Number(r.saved_at) } : {}),
    ...("access_role" in r && isSiteRole(r.access_role) ? { accessRole: r.access_role } : {}),
  };
}

export async function listSites(db: Db, email: string | null = null): Promise<SiteRecord[]> {
  const scoped = email !== null && !allowedEmails().includes(email.toLowerCase());
  const membership = scoped ? "JOIN site_members m ON m.site_id=s.id AND m.email=?" : "";
  const access = scoped ? ", m.role AS access_role" : "";
  const sql = db.backend === "d1"
    ? `SELECT s.*, r.saved_at${access} FROM sites s ${membership}
        LEFT JOIN site_document_rooms r ON r.site_id=s.id
        ORDER BY COALESCE(r.saved_at,s.updated_at) DESC`
    : `SELECT s.*, d.saved_at${access} FROM sites s ${membership}
        LEFT JOIN docs d ON d.id=s.id
        ORDER BY COALESCE(d.saved_at,s.updated_at) DESC`;
  const rs = await db.execute(scoped ? { sql, args: [email!.toLowerCase()] } : sql);
  return rs.rows.map(toRecord).map(site => ({ ...site, ...(!scoped && email ? { accessRole: "owner" as const } : {}) }));
}

export async function getSite(db: Db, id: string, expectedRoomKey?: string): Promise<SiteRecord | null> {
  const sql = db.backend === "d1"
    ? "SELECT s.*, r.saved_at FROM sites s LEFT JOIN site_document_rooms r ON r.site_id=s.id WHERE s.id=?"
    : "SELECT s.*, d.saved_at FROM sites s LEFT JOIN docs d ON d.id=s.id WHERE s.id=?";
  // 作成した直後の確認では、同じ ID で作り直された別のサイトを返さない。
  const fenced = expectedRoomKey !== undefined;
  if (fenced && db.backend !== "d1") return null;
  const rs = await db.execute({
    sql: sql + (fenced ? " AND r.room_key=?" : ""),
    args: fenced ? [id, expectedRoomKey] : [id],
  });
  return rs.rows[0] ? toRecord(rs.rows[0]) : null;
}

/** サイトの公開の ID ではなく、現在の世代のルームのキーを返す。 */
export async function getSiteRoomKey(db: Db, siteId: string): Promise<string | null> {
  if (db.backend !== "d1") return null;
  const rs = await db.execute({
    sql: "SELECT room_key FROM site_document_rooms WHERE site_id = ?",
    args: [siteId],
  });
  return typeof rs.rows[0]?.room_key === "string" ? String(rs.rows[0].room_key) : null;
}

const DUPLICATE_REPO_ERROR = "This repository is already used by another site";

/** Keep the public error stable while leaving unrelated database failures intact. */
function rethrowSiteWriteError(error: unknown): never {
  if (error instanceof Error && error.message.includes("UNIQUE constraint failed: sites.git_provider, sites.repo")) {
    throw new Error(DUPLICATE_REPO_ERROR);
  }
  throw error;
}

export async function insertSite(db: Db, id: string, v: Pick<SiteRecord, "name" | keyof SiteDest>, ownerEmail: string | null = null): Promise<string | null> {
  const now = Date.now();
  const roomKey = db.backend === "d1" ? crypto.randomUUID() : null;
  const statements = [{
    sql: `INSERT INTO sites (id, name, repo, git_provider, branch, preview_branch, site_url, preview_url, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [id, v.name, v.repo, v.gitProvider ?? "github", v.branch, v.previewBranch, v.siteUrl, v.previewUrl, now, now],
  }];
  if (roomKey) statements.push({
    sql: "INSERT INTO site_document_rooms(site_id,room_key) VALUES(?,?)", args: [id, roomKey],
  });
  if (ownerEmail) statements.push({
    sql: "INSERT INTO site_members(site_id,email,role) VALUES(?,?,'owner')", args: [id, ownerEmail.toLowerCase()],
  });
  // A conflicting site ID or destination aborts the transaction before any ownership is granted.
  await db.batch(statements).catch(rethrowSiteWriteError);
  return roomKey;
}

/** 検証した設定に対してだけ保存する。競合する更新は、呼び出し元が再試行する。 */
export async function updateSite(
  db: Db, id: string, v: Pick<SiteRecord, "name" | keyof SiteDest>,
  expected: Pick<SiteRecord, "name" | keyof SiteDest>,
): Promise<boolean> {
  const provider = v.gitProvider ?? "github";
  const result = await db.execute({
    sql: `UPDATE sites SET name = ?, repo = ?, git_provider = ?, branch = ?, preview_branch = ?, site_url = ?, preview_url = ?, updated_at = ?
      WHERE id = ? AND name IS ? AND repo IS ? AND git_provider IS ? AND branch IS ? AND preview_branch IS ? AND site_url IS ? AND preview_url IS ?`,
    args: [v.name, v.repo, provider, v.branch, v.previewBranch, v.siteUrl, v.previewUrl, Date.now(), id,
      expected.name, expected.repo, expected.gitProvider ?? "github", expected.branch, expected.previewBranch, expected.siteUrl, expected.previewUrl,
    ],
  }).catch(rethrowSiteWriteError);
  return result.rowsAffected > 0;
}

/** 呼び出し元が見た世代だけを削除する。Cloudflare での後始末は
 * 同じ D1 のトランザクションでキューに入れ、Durable Object を封じるまで再試行する。
 */
export async function deleteSite(db: Db, id: string, expectedRoomKey?: string): Promise<void> {
  if (db.backend === "d1") {
    if (!expectedRoomKey) throw new Error("削除対象の保存先がありません");
    const gate = "EXISTS (SELECT 1 FROM site_document_rooms WHERE site_id = ? AND room_key = ?)";
    const result = await db.batch([
      { sql: `DELETE FROM sites WHERE id = ? AND ${gate}`, args: [id, id, expectedRoomKey] },
      { sql: `DELETE FROM site_members WHERE site_id = ? AND ${gate}`, args: [id, id, expectedRoomKey] },
      { sql: `DELETE FROM site_asset_uploads WHERE site_id = ? AND ${gate}`, args: [id, id, expectedRoomKey] },
      { sql: `DELETE FROM site_activity WHERE site_id = ? AND ${gate}`, args: [id, id, expectedRoomKey] },
      { sql: `DELETE FROM site_publish_options WHERE site_id = ? AND ${gate}`, args: [id, id, expectedRoomKey] },
      { sql: `DELETE FROM comment_messages WHERE site_id = ? AND ${gate}`, args: [id, id, expectedRoomKey] },
      { sql: `DELETE FROM comment_threads WHERE site_id = ? AND ${gate}`, args: [id, id, expectedRoomKey] },
      { sql: `INSERT OR IGNORE INTO document_room_cleanup(room_key,queued_at)
        SELECT room_key, ? FROM site_document_rooms WHERE site_id=? AND room_key=?`,
        args: [Date.now(), id, expectedRoomKey] },
      { sql: "DELETE FROM site_document_rooms WHERE site_id=? AND room_key=?", args: [id, expectedRoomKey] },
    ]);
    if (!result[0]?.rowsAffected) throw new Error("サイトが変更されたため削除しませんでした");
    return;
  }
  await db.batch([
    { sql: "DELETE FROM sites WHERE id = ?", args: [id] },
    { sql: "DELETE FROM docs WHERE id = ?", args: [id] },
    { sql: "DELETE FROM site_backups WHERE site_id = ?", args: [id] },
    { sql: "DELETE FROM site_members WHERE site_id = ?", args: [id] },
    { sql: "DELETE FROM site_asset_uploads WHERE site_id = ?", args: [id] },
    { sql: "DELETE FROM site_activity WHERE site_id = ?", args: [id] },
    { sql: "DELETE FROM site_publish_options WHERE site_id = ?", args: [id] },
    { sql: "DELETE FROM comment_messages WHERE site_id = ?", args: [id] },
    { sql: "DELETE FROM comment_threads WHERE site_id = ?", args: [id] },
  ]);
}

/**
 * D1 のサイトの一覧のメタデータは参考の情報で、正確な版と savedAt は文書のルームにある。
 * キーを押すたびに、D1 の行への書き込みが2回増えるのを避ける。
 */
export const SITE_EDIT_METADATA_INTERVAL_MS = 60_000;

/**
 * 文書の保存を、サイトの一覧に多くても1分に1回だけ反映する。
 * 書き込む時期でなくても、サイトとルームの世代が一致するかは確かめる。
 * 確かめないと、削除して作り直したサイトが、古い保存を受け入れてしまうことがある。
 */
export async function recordSiteSavedAt(db: Db, siteId: string, roomKey: string | null, savedAt: number):
  Promise<boolean> {
  if (roomKey) {
    const state = await db.execute({
      sql: "SELECT r.saved_at, s.updated_at FROM site_document_rooms r JOIN sites s ON s.id=r.site_id WHERE r.site_id=? AND r.room_key=?",
      args: [siteId, roomKey],
    });
    const row = state.rows[0];
    if (!row) return false;
    const cutoff = savedAt - SITE_EDIT_METADATA_INTERVAL_MS;
    const roomDue = row.saved_at == null || Number(row.saved_at) <= cutoff;
    const siteDue = Number(row.updated_at) <= cutoff;
    if (!roomDue && !siteDue) return true;

    // 直前の SELECT だけでなく、UPDATE ごとに SQL の中で条件を確かめる。複数の
    // Worker が同時に保存することがあり、古い世代が途中で消えることもある。
    const statements: Array<{ sql: string; args: (string | number | null)[] }> = [];
    if (roomDue) statements.push({
      sql: "UPDATE site_document_rooms SET saved_at=MAX(COALESCE(saved_at,0),?) WHERE site_id=? AND room_key=? AND (saved_at IS NULL OR saved_at<=?)",
      args: [savedAt, siteId, roomKey, cutoff],
    });
    if (siteDue) statements.push({
      sql: "UPDATE sites SET updated_at=MAX(updated_at,?) WHERE id=? AND updated_at<=? AND EXISTS(SELECT 1 FROM site_document_rooms WHERE site_id=? AND room_key=?)",
      args: [savedAt, siteId, cutoff, siteId, roomKey],
    });
    const results = await db.batch(statements);
    if (results.some(result => result.rowsAffected > 0)) return true;
    // 同時の保存が、時刻の更新の競争に勝った可能性がある。受け入れる前に、その害の無い場合と、
    // 世代が削除されたり作り直されたりした場合を区別する。
    const current = await db.execute({
      sql: "SELECT 1 FROM site_document_rooms r JOIN sites s ON s.id=r.site_id WHERE r.site_id=? AND r.room_key=?",
      args: [siteId, roomKey],
    });
    return current.rows.length > 0;
  }

  // Node.js・Docker には、D1 の書き込みの上限も、ルームの世代のバインディングも無い。
  const rs = await db.execute({
    sql: "UPDATE sites SET updated_at=MAX(updated_at, ?) WHERE id=?",
    args: [savedAt, siteId],
  });
  return Boolean(rs.rowsAffected);
}
