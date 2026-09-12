import type { Db } from "./db";

/**
 * サイト（1つの編集データと、その公開先）。
 * 一覧と公開先は D1 の sites テーブルに、編集データはサイトごとの DocumentRoom に保存する。
 * Node.js・Docker では、同じサイトの情報をローカルの SQLite に保存する。
 * D1 が無いときは、ブラウザの中（lib/site.ts）に同じ形で保存する
 */

/** サイトの ID の形（URL やブラウザの保存のキーに使うため、英小文字・数字・ハイフンだけ） */
export const SITE_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function isSiteId(v: unknown): v is string {
  return typeof v === "string" && SITE_ID_RE.test(v);
}

/** 公開先の設定（サイトごと） */
export interface SiteDest {
  /** GitHub のリポジトリ（owner/name）。未設定なら公開できない */
  repo: string | null;
  /** 本番のブランチ */
  branch: string;
  /** テスト公開のブランチ（空 = テスト公開を使わない） */
  previewBranch: string;
  /** 公開した後に開ける本番のサイトの URL（任意） */
  siteUrl: string | null;
  /** テストのサイトの URL（任意） */
  previewUrl: string | null;
}

export interface SiteRecord extends SiteDest {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** 編集データを最後に保存した時刻（まだ無ければ null） */
  savedAt?: number | null;
}

/** 新しいサイトの作成と、設定の変更で受け取る項目 */
export type SiteInput = Partial<Pick<SiteRecord, "name" | keyof SiteDest>>;

export const DEFAULT_BRANCH = "main";
export const DEFAULT_PREVIEW_BRANCH = "preview";

const REPO_RE = /^[\w.-]+\/[\w.-]+$/;
const BRANCH_RE = /^[\w.][\w./-]*$/;

/**
 * GitHub API のパスに入れても、別のパスへ抜けない名前か（「.」「..」の区切りを含まない）。
 * こうした名前は、GitHub のリポジトリ名や git のブランチ名としても、もともと使えない
 */
export function isSafeRepo(repo: string): boolean {
  return REPO_RE.test(repo) && repo.split("/").every((s) => s !== "." && s !== "..");
}

/** git のブランチ名の決まり（git check-ref-format）のうち、パスの抜け道になるものと、使えないもの */
export function isSafeBranch(branch: string): boolean {
  return (
    BRANCH_RE.test(branch) &&
    !branch.includes("..") &&
    !branch.includes("//") &&
    !branch.endsWith("/") &&
    !branch.endsWith(".") &&
    !branch.split("/").some((s) => s.startsWith(".") || s.endsWith(".lock"))
  );
}

const clean = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/**
 * 入力を確かめて、保存できる形にする。検証に失敗したときは、翻訳のための英語の原文を返す。
 * base は変更前の値（新規作成では既定値）
 */
export function normalizeSiteInput(
  input: SiteInput,
  base: Pick<SiteRecord, "name" | keyof SiteDest>
): { ok: true; value: Pick<SiteRecord, "name" | keyof SiteDest> } | { ok: false; error: string } {
  const has = (k: keyof SiteInput) => Object.prototype.hasOwnProperty.call(input, k);
  const name = has("name") ? clean(input.name) : base.name;
  if (!name) return { ok: false, error: "Enter a site name" };
  if (name.length > 100) return { ok: false, error: "Site names can be up to 100 characters" };

  const repo = has("repo") ? clean(input.repo) || null : base.repo;
  if (repo && !isSafeRepo(repo)) {
    return { ok: false, error: "Enter the repository as owner/name" };
  }
  const branch = has("branch") ? clean(input.branch) || DEFAULT_BRANCH : base.branch;
  const previewBranch = has("previewBranch") ? clean(input.previewBranch) : base.previewBranch;
  if (!isSafeBranch(branch) || (previewBranch && !isSafeBranch(previewBranch))) {
    return { ok: false, error: "The branch name contains characters that aren't allowed" };
  }
  if (previewBranch && previewBranch === branch) {
    return { ok: false, error: "Use a different branch for test publishing than for production" };
  }
  const url = (k: "siteUrl" | "previewUrl") => (has(k) ? clean(input[k]) || null : base[k]);
  const siteUrl = url("siteUrl");
  const previewUrl = url("previewUrl");
  for (const u of [siteUrl, previewUrl]) {
    if (u && !/^https?:\/\/[^\s]+$/.test(u)) {
      return { ok: false, error: "URLs must start with http:// or https://" };
    }
  }
  return { ok: true, value: { name, repo, branch, previewBranch, siteUrl, previewUrl } };
}

/** 新しいサイトの ID（推測されにくい英数字10文字） */
export function newSiteId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(bytes, (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
}

/* ---------- D1 ---------- */

function toRecord(r: Record<string, unknown>): SiteRecord {
  const str = (v: unknown) => (v === null || v === undefined || v === "" ? null : String(v));
  return {
    id: String(r.id),
    name: String(r.name),
    repo: str(r.repo),
    branch: String(r.branch || DEFAULT_BRANCH),
    previewBranch: String(r.preview_branch ?? ""),
    siteUrl: str(r.site_url),
    previewUrl: str(r.preview_url),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
    ...("saved_at" in r ? { savedAt: r.saved_at === null ? null : Number(r.saved_at) } : {}),
  };
}

export async function listSites(db: Db): Promise<SiteRecord[]> {
  const sql = db.backend === "d1"
    ? `SELECT s.*, r.saved_at FROM sites s
        LEFT JOIN site_document_rooms r ON r.site_id=s.id
        ORDER BY COALESCE(r.saved_at,s.updated_at) DESC`
    : `SELECT s.*, d.saved_at FROM sites s
        LEFT JOIN docs d ON d.id=s.id
        ORDER BY COALESCE(d.saved_at,s.updated_at) DESC`;
  const rs = await db.execute(sql);
  return rs.rows.map(toRecord);
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

export async function insertSite(db: Db, id: string, v: Pick<SiteRecord, "name" | keyof SiteDest>, initialBody?: string): Promise<string | null> {
  const now = Date.now();
  const site = {
    sql: `INSERT INTO sites (id, name, repo, branch, preview_branch, site_url, preview_url, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [id, v.name, v.repo, v.branch, v.previewBranch, v.siteUrl, v.previewUrl, now, now],
  };
  if (db.backend === "d1") {
    if (initialBody !== undefined) throw new Error("D1の編集データはDocumentRoomに保存してください");
    const roomKey = crypto.randomUUID();
    await db.batch([
      site,
      { sql: "INSERT INTO site_document_rooms(site_id, room_key) VALUES (?, ?)", args: [id, roomKey] },
    ]);
    // 呼び出し元の初期保存と取り消しには、作成した世代のキーだけを使う。
    return roomKey;
  }
  if (initialBody === undefined) { await db.execute(site); return null; }
  await db.batch([site, {
    sql: "INSERT INTO docs (id, rev, saved_at, body) VALUES (?, 1, ?, ?)",
    args: [id, now, initialBody],
  }]);
  return null;
}

/** 検証した設定に対してだけ保存する。競合する更新は、呼び出し元が再試行する。 */
export async function updateSite(
  db: Db, id: string, v: Pick<SiteRecord, "name" | keyof SiteDest>,
  expected: Pick<SiteRecord, "name" | keyof SiteDest>,
): Promise<boolean> {
  const result = await db.execute({
    sql: `UPDATE sites SET name = ?, repo = ?, branch = ?, preview_branch = ?, site_url = ?, preview_url = ?, updated_at = ?
      WHERE id = ? AND name IS ? AND repo IS ? AND branch IS ? AND preview_branch IS ? AND site_url IS ? AND preview_url IS ?`,
    args: [v.name, v.repo, v.branch, v.previewBranch, v.siteUrl, v.previewUrl, Date.now(), id,
      expected.name, expected.repo, expected.branch, expected.previewBranch, expected.siteUrl, expected.previewUrl],
  });
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
