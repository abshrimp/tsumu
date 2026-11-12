import { getCloudflareContext } from "@opennextjs/cloudflare";
import { nodeDatabase } from "./node-storage";

/**
 * Cloudflare D1 への接続。サイトの一覧・文書の Durable Object の世代管理・コメント・許可したメールアドレスの保存先。
 * SiteDoc の本体と日次バックアップは、サイトごとの Durable Object 内の SQLite に保存する。
 * wrangler.jsonc の DB バインディングを経由してアクセスするため、
 * 接続情報の環境変数は不要。next dev の間は、ローカルの D1 の再現が使われる。
 * Cloudflare の外では、TSUMU_DATA_DIR の SQLite を同じ形で使う（lib/node-storage.ts）。
 */

type Value = string | number | null;
type Stmt = string | { sql: string; args: Value[] };

export interface ResultSet {
  rows: Record<string, unknown>[];
  rowsAffected: number;
}

export interface Db {
  /** Node.js・Docker では、文書とバックアップをローカルの SQLite のテーブルに保存する。 */
  readonly backend?: "d1" | "sqlite";
  execute(stmt: Stmt): Promise<ResultSet>;
  batch(stmts: Stmt[]): Promise<ResultSet[]>;
}

/** 使う D1 の API の最小限の型（@cloudflare/workers-types との型の衝突を避けるため） */
interface D1Result {
  results: Record<string, unknown>[];
  meta: { changes: number };
}

interface D1PreparedStatement {
  bind(...args: unknown[]): D1PreparedStatement;
  all(): Promise<D1Result>;
}

export interface D1LikeDatabase {
  /** ローカルの Node.js 用 SQLite アダプターにだけあり、Cloudflare D1 には無い。 */
  readonly __tsumuBackend?: "sqlite";
  prepare(sql: string): D1PreparedStatement;
  batch(stmts: D1PreparedStatement[]): Promise<D1Result[]>;
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

/** Durable Object など、Cloudflare のバインディングを直接持つ処理から DB を取得する。 */
export async function getDbFromBinding(binding: D1LikeDatabase): Promise<Db> {
  let ready = schemaReady.get(binding);
  if (!ready) {
    ready = binding
      .batch(
        [
          ...(binding.__tsumuBackend === "sqlite" ? [`CREATE TABLE IF NOT EXISTS docs (
            id TEXT PRIMARY KEY,
            rev INTEGER NOT NULL,
            saved_at INTEGER NOT NULL,
            body TEXT NOT NULL
          )`] : []),
          `CREATE TABLE IF NOT EXISTS allowed_emails (
            email TEXT PRIMARY KEY,
            added_at INTEGER NOT NULL
          )`,
          // サイトの一覧と公開先。Cloudflare では、文書の本体は DocumentRoom に保存する。
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
          // サイトの作成ごとに作る、予測できない部屋の識別子。同じ ID でインポートし直しても、
          // 古いサイト ID が削除したサイトの Durable Object を使い回すことはない。
          ...(binding.__tsumuBackend === "sqlite" ? [] : [
            `CREATE TABLE IF NOT EXISTS site_document_rooms (
              site_id TEXT PRIMARY KEY,
              room_key TEXT NOT NULL UNIQUE,
              saved_at INTEGER
            )`,
            `CREATE TABLE IF NOT EXISTS document_room_cleanup (
              room_key TEXT PRIMARY KEY,
              queued_at INTEGER NOT NULL
            )`,
            // KV の GC の候補の管理、実行の記録、再開できる棚卸し。
            `CREATE TABLE IF NOT EXISTS asset_gc_candidates (
              path TEXT PRIMARY KEY,
              first_unreferenced_at INTEGER NOT NULL,
              last_seen_at INTEGER NOT NULL,
              bytes INTEGER
            )`,
            `CREATE INDEX IF NOT EXISTS asset_gc_candidates_due
              ON asset_gc_candidates(first_unreferenced_at, path)`,
            `CREATE TABLE IF NOT EXISTS asset_gc_runs (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              started_at INTEGER NOT NULL,
              finished_at INTEGER,
              status TEXT NOT NULL,
              kv_keys INTEGER NOT NULL DEFAULT 0,
              referenced INTEGER NOT NULL DEFAULT 0,
              candidates INTEGER NOT NULL DEFAULT 0,
              deleted INTEGER NOT NULL DEFAULT 0,
              deleted_bytes INTEGER NOT NULL DEFAULT 0,
              dry_run INTEGER NOT NULL DEFAULT 1,
              error TEXT
            )`,
            `CREATE TABLE IF NOT EXISTS asset_gc_state (
              id INTEGER PRIMARY KEY CHECK(id=1),
              scan_cursor TEXT,
              scan_started_at INTEGER,
              lease_until INTEGER NOT NULL DEFAULT 0,
              lease_token TEXT
            )`,
            `INSERT OR IGNORE INTO asset_gc_state(id) VALUES(1)`,
            // ASSETS_KV のすべてのオブジェクトの台帳。使用量を KV の列挙（Workers の無料プランでは
            // 1日1,000回まで）ではなく、D1 への1回の問い合わせで求められるようにする。
            // アップロードで行を追加し、GC の削除で行を消し、週1回の KV の棚卸しで
            // 古いオブジェクトを補い、消えたオブジェクトを取り除く。
            `CREATE TABLE IF NOT EXISTS asset_objects (
              path TEXT PRIMARY KEY,
              bytes INTEGER,
              uploaded_at INTEGER NOT NULL,
              last_seen_at INTEGER NOT NULL
            )`,
            // 台帳ができた後に始めた棚卸しが、すべてのキーを列挙し終えた時点で、台帳は完全になる。
            `CREATE TABLE IF NOT EXISTS asset_ledger_state (
              id INTEGER PRIMARY KEY CHECK(id=1),
              created_at INTEGER NOT NULL,
              complete_at INTEGER
            )`,
            `INSERT OR IGNORE INTO asset_ledger_state(id,created_at)
              VALUES(1, CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER))`,
          ]),
          // サイトごとに、最後に GitHub へ公開した出力形式。D1 と Node.js の SQLite で共通。
          `CREATE TABLE IF NOT EXISTS site_publish_options (
            site_id TEXT PRIMARY KEY,
            framework TEXT NOT NULL,
            language TEXT NOT NULL,
            style TEXT NOT NULL
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
          `CREATE INDEX IF NOT EXISTS comment_threads_page ON comment_threads (site_id, created_at, id)`,
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
          `CREATE INDEX IF NOT EXISTS comment_messages_thread ON comment_messages (site_id, thread_id, at, id)`,
          // 文書の保存先を使う前に、スキーマのバージョンを確かめる。
          `CREATE TABLE IF NOT EXISTS storage_schema (name TEXT PRIMARY KEY, version INTEGER NOT NULL)`,
          `INSERT OR IGNORE INTO storage_schema(name,version) VALUES('main',1)`,
          // ローカルの SQLite では、任意の曜日ごとのバックアップを持つ。
          ...(binding.__tsumuBackend === "sqlite" ? [`CREATE TABLE IF NOT EXISTS site_backups (
            site_id TEXT NOT NULL,
            day INTEGER NOT NULL,
            saved_at INTEGER NOT NULL,
            body TEXT NOT NULL,
            PRIMARY KEY (site_id, day)
          )`] : []),
        ].map((sql) => binding.prepare(sql))
      )
      .then(async () => {
        const rows = await binding.prepare("SELECT version FROM storage_schema WHERE name='main'").all();
        if (Number(rows.results?.[0]?.version) !== 1) throw new Error("Unsupported storage schema");
      })
      .catch((error) => {
        schemaReady.delete(binding);
        throw error;
      });
    schemaReady.set(binding, ready);
  }
  await ready;
  return {
    backend: binding.__tsumuBackend === "sqlite" ? "sqlite" : "d1",
    execute: async (stmt) => toResultSet(await prepare(binding, stmt).all()),
    batch: async (stmts) =>
      (await binding.batch(stmts.map((s) => prepare(binding, s)))).map(
        toResultSet
      ),
  };
}

/** スキーマを用意したうえで、クライアントを返す */
export async function getDb(): Promise<Db> {
  const db = d1();
  if (!db) throw new Error("D1バインディング（DB）がありません");
  return getDbFromBinding(db);
}
