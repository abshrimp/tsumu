import { dbConfigured, getDb } from "./db";
import { envVar } from "./env";
import { isValidEmail } from "./email";

export function parseAllowedEmails(raw: string | undefined): string[] {
  return (raw ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

/** 環境変数で常に許可しているメールアドレス */
export function allowedEmails(): string[] {
  return parseAllowedEmails(envVar("ALLOWED_EMAILS"));
}

/** セッションや接続を作るときだけでなく、使うたびに現在の許可を確かめる。 */
export async function isEmailAllowed(
  email: unknown,
  fixed = allowedEmails(),
  readExtra: () => Promise<string[]> = readAllowlist
): Promise<boolean> {
  if (!isValidEmail(email)) return false;
  const normalized = email.toLowerCase();
  if (fixed.includes(normalized)) return true;
  try {
    return (await readExtra()).some((e) => e.toLowerCase() === normalized);
  } catch {
    // A database outage must never become an open enrollment bypass.
    return false;
  }
}

/**
 * ログインを許可するメールアドレスの動的なリスト（D1 に保存）。
 * 環境変数 ALLOWED_EMAILS の固定のリストに加えて適用する。
 * auth.ts を経由して middleware からも読み込まれるため、Node.js 専用の機能は使わない。
 */

export type AccountRole = "editor" | "viewer";
export type AllowedAccount = { email: string; role: AccountRole };

export function isAccountRole(value: unknown): value is AccountRole {
  return value === "editor" || value === "viewer";
}

/** Dynamic accounts and their current permissions. */
export async function listAllowedAccounts(): Promise<AllowedAccount[]> {
  const rs = await (await getDb()).execute("SELECT email, role FROM allowed_emails ORDER BY added_at");
  return rs.rows.map((row) => ({ email: String(row.email), role: row.role as AccountRole }));
}

/** The login allowlist only needs email addresses. */
async function listAllowedEmails(): Promise<string[]> {
  return (await listAllowedAccounts()).map((account) => account.email);
}

export async function addAllowedEmail(email: string, role: AccountRole): Promise<void> {
  await (await getDb()).execute({
    sql: "INSERT INTO allowed_emails (email, role, added_at) VALUES (?, ?, ?) ON CONFLICT(email) DO NOTHING",
    args: [email, role, Date.now()],
  });
}

export async function updateAllowedAccountRole(email: string, role: AccountRole): Promise<boolean> {
  const db = await getDb();
  const result = await db.execute({
    sql: "UPDATE allowed_emails SET role = ? WHERE email = ?", args: [role, email],
  });
  if (result.rowsAffected > 0) return true;
  const exists = await db.execute({ sql: "SELECT 1 FROM allowed_emails WHERE email = ? LIMIT 1", args: [email] });
  return exists.rows.length > 0;
}

/** Fixed server accounts always have edit access. Unknown accounts have none. */
export async function getAccountRole(
  email: unknown,
  fixed = allowedEmails(),
  lookup: (normalized: string) => Promise<AccountRole | null> = readAccountRole,
): Promise<AccountRole | null> {
  if (!isValidEmail(email)) return null;
  const normalized = email.toLowerCase();
  if (fixed.includes(normalized)) return "editor";
  try {
    const role = await lookup(normalized);
    return isAccountRole(role) ? role : null;
  } catch {
    return null;
  }
}

async function readAccountRole(email: string): Promise<AccountRole | null> {
  if (!dbConfigured()) return null;
  const rows = await (await getDb()).execute({
    sql: "SELECT role FROM allowed_emails WHERE email = ? LIMIT 1", args: [email],
  });
  return rows.rows[0]?.role as AccountRole | null ?? null;
}

/** 削除する。存在しなければ false、単独オーナーのサイトがあれば "sole-owner" を返す */
export async function removeAllowedEmail(email: string): Promise<boolean | "sole-owner"> {
  const db = await getDb();
  const soleOwnerGuard = `NOT EXISTS (
    SELECT 1 FROM site_members m
    JOIN sites s ON s.id = m.site_id
    WHERE m.email = ? AND m.role = 'owner'
      AND (SELECT COUNT(*) FROM site_members o WHERE o.site_id = m.site_id AND o.role = 'owner') <= 1
  )`;
  const results = await db.batch([
    { sql: `DELETE FROM allowed_emails WHERE email = ? AND ${soleOwnerGuard}`, args: [email, email] },
    { sql: `DELETE FROM site_members WHERE email = ? AND ${soleOwnerGuard}`, args: [email, email] },
  ]);
  if (results[0].rowsAffected > 0) return true;
  const exists = await db.execute({ sql: "SELECT 1 FROM allowed_emails WHERE email = ? LIMIT 1", args: [email] });
  return exists.rows.length > 0 ? "sole-owner" : false;
}

/** ログインの判定に使う（未設定や失敗のときは空で、環境変数の固定のリストだけが有効） */
async function readAllowlist(): Promise<string[]> {
  if (!dbConfigured()) return [];
  try {
    return await listAllowedEmails();
  } catch {
    return [];
  }
}
