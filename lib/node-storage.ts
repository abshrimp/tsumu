/**
 * Cloudflare の外（Node.js・Docker）で動かすときの保存先。
 * 環境変数 TSUMU_DATA_DIR を指定すると、D1 の代わりに <dir>/tsumu.db（SQLite）を、
 * Workers KV の代わりに <dir>/assets/ を使う。Cloudflare のバインディングがあればそちらを優先する。
 *
 * node:sqlite・node:fs は process.getBuiltinModule で実行時に読み込む。静的に import すると、
 * このファイルを含む middleware（Edge）や Cloudflare Workers のビルドが通らないため。
 * node:sqlite は Node.js 22.16 以上が必要。
 */

import type { D1LikeDatabase } from "./db";
import type { AssetMeta, KVLikeNamespace } from "./kv";

type BuiltinLoader = (id: string) => unknown;

function builtin<T>(id: string): T | null {
  const load = (globalThis.process as { getBuiltinModule?: BuiltinLoader } | undefined)?.getBuiltinModule;
  if (typeof load !== "function") return null;
  try {
    return (load(id) as T | undefined) ?? null;
  } catch {
    return null;
  }
}

/** 保存先のフォルダ（未設定・Node.js 以外なら null） */
export function nodeDataDir(): string | null {
  const dir = globalThis.process?.env?.TSUMU_DATA_DIR;
  return dir ? dir.replace(/\/+$/, "") || "/" : null;
}

// ---------------------------------------------------------------- SQLite（D1 の代わり）

interface SqliteStatement {
  all(...args: unknown[]): Record<string, unknown>[];
  run(...args: unknown[]): { changes: number | bigint };
  columns(): unknown[];
}

interface SqliteDatabase {
  prepare(sql: string): SqliteStatement;
  exec(sql: string): void;
}

interface SqliteModule {
  DatabaseSync: new (path: string) => SqliteDatabase;
}

interface FsSync {
  mkdirSync(path: string, opts: { recursive: true }): void;
}

function runOne(db: SqliteDatabase, sql: string, args: unknown[]) {
  const stmt = db.prepare(sql);
  if (stmt.columns().length) return { results: stmt.all(...args), meta: { changes: 0 } };
  const { changes } = stmt.run(...args);
  return { results: [], meta: { changes: Number(changes) } };
}

/** D1 と同じ形（prepare → bind → all、batch はトランザクション）で SQLite を包む */
function d1Adapter(db: SqliteDatabase): D1LikeDatabase {
  type Bound = { sql: string; args: unknown[] };
  const statement = (sql: string, args: unknown[] = []) => {
    const bound: Bound = { sql, args };
    return Object.assign(bound, {
      bind: (...next: unknown[]) => statement(sql, next),
      all: async () => runOne(db, sql, args),
    });
  };
  return {
    prepare: (sql) => statement(sql),
    batch: async (stmts) => {
      db.exec("BEGIN");
      try {
        const out = (stmts as unknown as Bound[]).map((s) => runOne(db, s.sql, s.args));
        db.exec("COMMIT");
        return out;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
    // SQLite の既定の上限（SQLITE_MAX_LENGTH）。D1 の約2MBより大きい
    maxValueBytes: 1_000_000_000,
  };
}

const cache = globalThis as typeof globalThis & {
  __tsumuSqlite?: { dir: string; db: D1LikeDatabase };
  __tsumuAssets?: { dir: string; store: KVLikeNamespace };
};

/** SQLite のデータベース（TSUMU_DATA_DIR が無い・使えない環境なら null） */
export function nodeDatabase(): D1LikeDatabase | null {
  const dir = nodeDataDir();
  if (!dir) return null;
  if (cache.__tsumuSqlite?.dir === dir) return cache.__tsumuSqlite.db;
  const sqlite = builtin<SqliteModule>("node:sqlite");
  const fs = builtin<FsSync>("node:fs");
  if (!sqlite || !fs) return null;
  fs.mkdirSync(dir, { recursive: true });
  const raw = new sqlite.DatabaseSync(`${dir}/tsumu.db`);
  raw.exec("PRAGMA journal_mode = WAL");
  raw.exec("PRAGMA busy_timeout = 5000");
  const db = d1Adapter(raw);
  cache.__tsumuSqlite = { dir, db };
  return db;
}

// ---------------------------------------------------------------- ファイル（KV の代わり）

interface FsPromises {
  mkdir(path: string, opts: { recursive: true }): Promise<unknown>;
  readFile(path: string): Promise<Uint8Array>;
  readFile(path: string, encoding: "utf8"): Promise<string>;
  writeFile(path: string, data: Uint8Array | string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  rm(path: string, opts: { force: true }): Promise<void>;
}

/** ファイル名の上限（多くのファイルシステムは255バイト。メタデータ用の余裕を残す） */
const MAX_FILE_NAME = 200;

interface NodeCrypto {
  createHash(alg: string): { update(data: string): { digest(enc: "hex"): string } };
}

/**
 * キーを1つのファイル名にする（「/」も符号化するため、フォルダの外を指せない）。
 * 長すぎる名前（日本語は1文字が9バイトになる）はハッシュにする。符号化した名前に
 * 「%h」は現れないので、ハッシュの名前と重ならない
 */
export function assetFileName(key: string): string {
  const name = encodeURIComponent(key);
  if (!name || name === "." || name === "..") throw new Error(`Invalid asset key: ${key}`);
  if (name.length <= MAX_FILE_NAME) return name;
  const crypto = builtin<NodeCrypto>("node:crypto");
  if (!crypto) throw new Error("node:crypto is not available");
  return `%h-${crypto.createHash("sha256").update(key).digest("hex")}`;
}

const isMissing = (e: unknown) => (e as { code?: string })?.code === "ENOENT";

/** アセットの保存先（TSUMU_DATA_DIR が無い・使えない環境なら null） */
export function nodeAssetStore(): KVLikeNamespace | null {
  const dir = nodeDataDir();
  if (!dir) return null;
  if (cache.__tsumuAssets?.dir === dir) return cache.__tsumuAssets.store;
  const fs = builtin<FsPromises>("node:fs/promises");
  if (!fs) return null;
  const store = fileStore(dir, fs);
  cache.__tsumuAssets = { dir, store };
  return store;
}

function fileStore(dir: string, fs: FsPromises): KVLikeNamespace {
  const dataDir = `${dir}/assets/data`;
  const metaDir = `${dir}/assets/meta`;
  const ready = Promise.all([fs.mkdir(dataDir, { recursive: true }), fs.mkdir(metaDir, { recursive: true })]);

  /** 書きかけのファイルを読まれないよう、一時ファイルに書いてから置き換える */
  const writeAtomic = async (path: string, data: Uint8Array | string) => {
    const tmp = `${path}.${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`;
    await fs.writeFile(tmp, data);
    await fs.rename(tmp, path);
  };
  const readData = async (key: string): Promise<Uint8Array | null> => {
    await ready;
    try {
      return await fs.readFile(`${dataDir}/${assetFileName(key)}`);
    } catch (e) {
      if (isMissing(e)) return null;
      throw e;
    }
  };
  const readMeta = async (key: string): Promise<AssetMeta | null> => {
    try {
      return JSON.parse(await fs.readFile(`${metaDir}/${assetFileName(key)}`, "utf8")) as AssetMeta;
    } catch {
      return null;
    }
  };
  const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

  return {
    async put(key, value, options) {
      await ready;
      const name = assetFileName(key);
      await writeAtomic(`${dataDir}/${name}`, typeof value === "string" ? value : new Uint8Array(value));
      await writeAtomic(`${metaDir}/${name}`, JSON.stringify(options?.metadata ?? {}));
    },
    async get(key) {
      const bytes = await readData(key);
      return bytes ? toArrayBuffer(bytes) : null;
    },
    async getWithMetadata(key) {
      const bytes = await readData(key);
      if (!bytes) return { value: null, metadata: null };
      return { value: new Blob([toArrayBuffer(bytes)]).stream(), metadata: await readMeta(key) };
    },
    async delete(key) {
      await ready;
      const name = assetFileName(key);
      await fs.rm(`${dataDir}/${name}`, { force: true });
      await fs.rm(`${metaDir}/${name}`, { force: true });
    },
  };
}
