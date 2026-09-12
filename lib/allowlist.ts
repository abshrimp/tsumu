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
    return false;
  }
}

/**
 * ログインを許可するメールアドレスの動的なリスト（D1 に保存）。
 * 環境変数 ALLOWED_EMAILS の固定のリストに加えて適用する。
 * auth.ts を経由して middleware からも読み込まれるため、Node.js 専用の機能は使わない。
 */

/** 追加で許可したメールアドレスの一覧（追加した順） */
export async function listAllowedEmails(): Promise<string[]> {
  const db = await getDb();
  const rs = await db.execute(
    "SELECT email FROM allowed_emails ORDER BY added_at"
  );
  return rs.rows.map((r) => String(r.email));
}

export async function addAllowedEmail(email: string): Promise<void> {
  const db = await getDb();
  await db.execute({
    sql: "INSERT INTO allowed_emails (email, added_at) VALUES (?, ?) ON CONFLICT(email) DO NOTHING",
    args: [email, Date.now()],
  });
}

/** 削除する。存在しなければ false を返す */
export async function removeAllowedEmail(email: string): Promise<boolean> {
  const db = await getDb();
  const rs = await db.execute({
    sql: "DELETE FROM allowed_emails WHERE email = ?",
    args: [email],
  });
  return rs.rowsAffected > 0;
}

/** ログインの判定に使う（未設定や失敗のときは空で、環境変数の固定のリストだけが有効） */
export async function readAllowlist(): Promise<string[]> {
  if (!dbConfigured()) return [];
  try {
    return await listAllowedEmails();
  } catch {
    return [];
  }
}
