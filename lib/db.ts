import { getCloudflareContext } from "@opennextjs/cloudflare";
import { nodeDatabase } from "./node-storage";

/**
 * Cloudflare D1（SQLite）への接続。サイトの一覧・編集データ・自動バックアップ・許可メールリストの保存先。
 * wrangler.jsonc の DB バインディング経由でアクセスするため、
 * 接続情報の環境変数は不要。next dev 中はローカルのD1シミュレーションが使われる。
 * Cloudflare の外では、TSUMU_DATA_DIR の SQLite を同じ形で使う（lib/node-storage.ts）。
 */

type Value = string | number | null;
type Stmt = string | { sql: string; args: Value[] };

export interface ResultSet {
  rows: Record<string, unknown>[];
  rowsAffected: number;
}

export interface Db {
  execute(stmt: Stmt): Promise<ResultSet>;
  batch(stmts: Stmt[]): Promise<ResultSet[]>;
  /** 1つの値（編集データの本文など）に保存できる大きさ（バイト） */
  maxValueBytes: number;
}

/** D1 の1行（1つの文字列・BLOB）の上限は 2,000,000 バイト。同じ行のほかの列の分を残す */
const D1_MAX_VALUE_BYTES = 2_000_000 - 1_000;

/** 使用するD1 APIの最小型（@cloudflare/workers-types の型衝突を避ける） */
interface D1Result {
  results: Record<string, unknown>[];
  meta: { changes: number };
}

interface D1PreparedStatement {
  bind(...args: unknown[]): D1PreparedStatement;
  all(): Promise<D1Result>;
}

export interface D1LikeDatabase {
  prepare(sql: string): D1PreparedStatement;
  batch(stmts: D1PreparedStatement[]): Promise<D1Result[]>;
  /** D1 より大きな値を置ける保存先（Node.js の SQLite）だけが指定する */
  maxValueBytes?: number;
}

function d1(): D1LikeDatabase | null {
  try {
    const env = getCloudflareContext().env as unknown as Record<
      string,
      unknown
    >;
    const db = env.DB as D1LikeDatabase | undefined;
    if (db) return db;
  } catch {
    // Cloudflare の外（next start・Docker）
  }
  return nodeDatabase();
}

export function dbConfigured(): boolean {
  return d1() !== null;
}

function prepare(db: D1LikeDatabase, stmt: Stmt): D1PreparedStatement {
  return typeof stmt === "string"
    ? db.prepare(stmt)
    : db.prepare(stmt.sql).bind(...stmt.args);
}

function toResultSet(r: D1Result): ResultSet {
  return { rows: r.results ?? [], rowsAffected: r.meta?.changes ?? 0 };
}

const schemaReady = new WeakMap<object, Promise<void>>();

/** Durable Objectなど、Cloudflare bindingを直接持つ処理からDBを取得する。 */
export async function getDbFromBinding(binding: D1LikeDatabase): Promise<Db> {
  let ready = schemaReady.get(binding);
  if (!ready) {
    ready = binding
      .batch(
        [
          `CREATE TABLE IF NOT EXISTS docs (
            id TEXT PRIMARY KEY,
            rev INTEGER NOT NULL,
            saved_at INTEGER NOT NULL,
            body TEXT NOT NULL
          )`,
          `CREATE TABLE IF NOT EXISTS allowed_emails (
            email TEXT PRIMARY KEY,
            added_at INTEGER NOT NULL
          )`,
          // サイトの一覧と公開先。編集データは docs の id = サイトID の行
          `CREATE TABLE IF NOT EXISTS sites (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            repo TEXT,
            branch TEXT NOT NULL,
            preview_branch TEXT NOT NULL,
            site_url TEXT,
            preview_url TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
          )`,
          // サイトの編集・公開の記録（人ごと・種類ごとに最後の時刻。lib/activity.ts）
          `CREATE TABLE IF NOT EXISTS site_activity (
            site_id TEXT NOT NULL,
            kind TEXT NOT NULL,
            email TEXT NOT NULL,
            name TEXT,
            image TEXT,
            at INTEGER NOT NULL,
            PRIMARY KEY (site_id, kind, email)
          )`,
          // エディタのコメント（lib/comments.ts。編集データとは別に持つ）
          `CREATE TABLE IF NOT EXISTS comment_threads (
            id TEXT PRIMARY KEY,
            site_id TEXT NOT NULL,
            page_id TEXT NOT NULL,
            node_id TEXT,
            x REAL NOT NULL,
            y REAL NOT NULL,
            bp TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            resolved_at INTEGER,
            resolved_email TEXT,
            resolved_name TEXT,
            resolved_image TEXT
          )`,
          `CREATE INDEX IF NOT EXISTS comment_threads_site ON comment_threads (site_id)`,
          `CREATE TABLE IF NOT EXISTS comment_messages (
            id TEXT PRIMARY KEY,
            thread_id TEXT NOT NULL,
            site_id TEXT NOT NULL,
            email TEXT NOT NULL,
            name TEXT,
            image TEXT,
            body TEXT NOT NULL,
            at INTEGER NOT NULL,
            edited_at INTEGER
          )`,
          `CREATE INDEX IF NOT EXISTS comment_messages_site ON comment_messages (site_id)`,
          // サイトごとの日次バックアップ（曜日ごとに7世代）
          `CREATE TABLE IF NOT EXISTS site_backups (
            site_id TEXT NOT NULL,
            day INTEGER NOT NULL,
            saved_at INTEGER NOT NULL,
            body TEXT NOT NULL,
            PRIMARY KEY (site_id, day)
          )`,
        ].map((sql) => binding.prepare(sql))
      )
      .then(() => undefined)
      .catch((error) => {
        schemaReady.delete(binding);
        throw error;
      });
    schemaReady.set(binding, ready);
  }
  await ready;
  return {
    execute: async (stmt) => toResultSet(await prepare(binding, stmt).all()),
    batch: async (stmts) =>
      (await binding.batch(stmts.map((s) => prepare(binding, s)))).map(
        toResultSet
      ),
    maxValueBytes: binding.maxValueBytes ?? D1_MAX_VALUE_BYTES,
  };
}

/** スキーマを保証したうえでクライアントを返す */
export async function getDb(): Promise<Db> {
  const db = d1();
  if (!db) throw new Error("D1バインディング（DB）がありません");
  return getDbFromBinding(db);
}
