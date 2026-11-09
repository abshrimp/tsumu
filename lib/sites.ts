import type { Db } from "./db";

/**
 * サイト（1つの編集データと、その公開先）。
 * 一覧と公開先はD1のsitesテーブル、編集データはサイトごとのDocumentRoomに保存する。
 * Node/Dockerでは同じサイト情報にローカルSQLiteを使用する。
 * D1 が無いときは、ブラウザ内（lib/site.ts）に同じ形で保存する
 */

/** サイトIDの形（URL・ブラウザ保存のキーに使うため、英小文字・数字・ハイフンだけ） */
export const SITE_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function isSiteId(v: unknown): v is string {
  return typeof v === "string" && SITE_ID_RE.test(v);
}

/** 公開先の設定（サイトごと） */
export interface SiteDest {
  /** GitHubリポジトリ（owner/name）。未設定なら公開できない */
  repo: string | null;
  /** 本番のブランチ */
  branch: string;
  /** テスト公開のブランチ（空 = テスト公開を使わない） */
  previewBranch: string;
  /** 公開後に開ける本番サイトのURL（任意） */
  siteUrl: string | null;
  /** テストサイトのURL（任意） */
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

/** 新しいサイト・設定の変更で受け取る項目 */
export type SiteInput = Partial<Pick<SiteRecord, "name" | keyof SiteDest>>;

export const DEFAULT_BRANCH = "main";
export const DEFAULT_PREVIEW_BRANCH = "preview";

const REPO_RE = /^[\w.-]+\/[\w.-]+$/;
const BRANCH_RE = /^[\w.][\w./-]*$/;

/**
 * GitHub API のパスに入れても、別のパスへ抜けない名前か（「.」「..」の区切りを含まない）。
 * GitHub のリポジトリ名・git のブランチ名としても、そもそも使えない
 */
export function isSafeRepo(repo: string): boolean {
  return REPO_RE.test(repo) && repo.split("/").every((s) => s !== "." && s !== "..");
}

/** git のブランチ名の決まり（git check-ref-format）のうち、パスの抜け道になるもの・使えないもの */
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
 * 入力を確かめて、保存できる形にする。誤りがあれば日本語のメッセージ（訳す前の文）を返す。
 * base は変更前の値（新規作成では既定値）
 */
export function normalizeSiteInput(
  input: SiteInput,
  base: Pick<SiteRecord, "name" | keyof SiteDest>
): { ok: true; value: Pick<SiteRecord, "name" | keyof SiteDest> } | { ok: false; error: string } {
  const has = (k: keyof SiteInput) => Object.prototype.hasOwnProperty.call(input, k);
  const name = has("name") ? clean(input.name) : base.name;
  if (!name) return { ok: false, error: "サイト名を入力してください" };
  if (name.length > 100) return { ok: false, error: "サイト名は100文字までです" };

  const repo = has("repo") ? clean(input.repo) || null : base.repo;
  if (repo && !isSafeRepo(repo)) {
    return { ok: false, error: "リポジトリは owner/name の形で入力してください" };
  }
  const branch = has("branch") ? clean(input.branch) || DEFAULT_BRANCH : base.branch;
  const previewBranch = has("previewBranch") ? clean(input.previewBranch) : base.previewBranch;
  if (!isSafeBranch(branch) || (previewBranch && !isSafeBranch(previewBranch))) {
    return { ok: false, error: "ブランチ名に使えない文字が含まれています" };
  }
  if (previewBranch && previewBranch === branch) {
    return { ok: false, error: "テスト公開のブランチは、本番と別の名前にしてください" };
  }
  const url = (k: "siteUrl" | "previewUrl") => (has(k) ? clean(input[k]) || null : base[k]);
  const siteUrl = url("siteUrl");
  const previewUrl = url("previewUrl");
  for (const u of [siteUrl, previewUrl]) {
    if (u && !/^https?:\/\/[^\s]+$/.test(u)) {
      return { ok: false, error: "URLは http:// か https:// から入力してください" };
    }
  }
  return { ok: true, value: { name, repo, branch, previewBranch, siteUrl, previewUrl } };
}

/** 新しいサイトのID（推測されにくい英数字10文字） */
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

export async function getSite(db: Db, id: string): Promise<SiteRecord | null> {
  const sql = db.backend === "d1"
    ? "SELECT s.*, r.saved_at FROM sites s LEFT JOIN site_document_rooms r ON r.site_id=s.id WHERE s.id=?"
    : "SELECT s.*, d.saved_at FROM sites s LEFT JOIN docs d ON d.id=s.id WHERE s.id=?";
  const rs = await db.execute({ sql, args: [id] });
  return rs.rows[0] ? toRecord(rs.rows[0]) : null;
}

/** Return the current generation's room key, not the public site ID. */
export async function getSiteRoomKey(db: Db, siteId: string): Promise<string | null> {
  if (db.backend !== "d1") return null;
  const rs = await db.execute({
    sql: "SELECT room_key FROM site_document_rooms WHERE site_id = ?",
    args: [siteId],
  });
  return typeof rs.rows[0]?.room_key === "string" ? String(rs.rows[0].room_key) : null;
}

export async function insertSite(db: Db, id: string, v: Pick<SiteRecord, "name" | keyof SiteDest>, initialBody?: string): Promise<void> {
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
    return;
  }
  if (initialBody === undefined) { await db.execute(site); return; }
  await db.batch([site, {
    sql: "INSERT INTO docs (id, rev, saved_at, body) VALUES (?, 1, ?, ?)",
    args: [id, now, initialBody],
  }]);
}

/** Save only against the settings that were validated; callers retry a competing update. */
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

/** Remove only the generation that the caller observed. Cloudflare cleanup is
 * queued in the same D1 transaction, and retried until its DO is sealed.
 */
export async function deleteSite(db: Db, id: string, expectedRoomKey?: string): Promise<void> {
  if (db.backend === "d1") {
    if (!expectedRoomKey) throw new Error("削除対象の保存先がありません");
    const gate = "EXISTS (SELECT 1 FROM site_document_rooms WHERE site_id = ? AND room_key = ?)";
    const result = await db.batch([
      { sql: `DELETE FROM sites WHERE id = ? AND ${gate}`, args: [id, id, expectedRoomKey] },
      { sql: `DELETE FROM site_activity WHERE site_id = ? AND ${gate}`, args: [id, id, expectedRoomKey] },
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
    { sql: "DELETE FROM comment_messages WHERE site_id = ?", args: [id] },
    { sql: "DELETE FROM comment_threads WHERE site_id = ?", args: [id] },
  ]);
}
