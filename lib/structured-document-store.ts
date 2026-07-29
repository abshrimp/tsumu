/**
 * One site's document stored as independently writable SQLite rows.
 * This is the sole Cloudflare document layout: per-entry JSON and an
 * atomic document revision, with no format-dependent decoding.
 */
import { applyDocPatch, isDocPatch, type DocPatch } from "./doc-patch";
import { hasValidChildren, validDocNodeShape, validSiteDoc } from "./doc-tree";
import type { SiteDoc } from "./types";

type Param = string | number | null;
type Row = Record<string, unknown>;
export interface DocumentSqlStorage {
  sql: { exec(query: string, ...params: Param[]): { toArray(): Row[] } };
  transactionSync<T>(callback: () => T): T;
}
export interface SiteSnapshot { body: string; rev: string; savedAt: number }
export type SiteSaveResult =
  | { kind: "saved"; rev: string; savedAt: number }
  | { kind: "conflict"; current: SiteSnapshot }
  | { kind: "missing" };
type Bucket = "pages" | "nodes" | "assets" | "components";
const buckets: Bucket[] = ["pages", "nodes", "assets", "components"];
const bucketsSet = new Set<string>(buckets);
const MAX_ROW_BYTES = 7_000_000; // DO SQLite limit is 8 MB per row/value.

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

function checkedJson(value: unknown): string {
  const text = JSON.stringify(value);
  if (typeof text !== "string") throw new Error("不正なリクエスト");
  if (new TextEncoder().encode(text).length > MAX_ROW_BYTES) {
    throw new Error("編集データの1項目が大きすぎます");
  }
  return text;
}
function parseDoc(raw: string): SiteDoc {
  let doc: unknown;
  try { doc = JSON.parse(raw); } catch { throw new Error("JSONが壊れています"); }
  if (!validSiteDoc(doc)) throw new Error("不正なリクエスト");
  return doc as SiteDoc;
}
function revision(base: string | null): number | null {
  if (base === null) return null;
  if (!/^[1-9]\d*$/.test(base) || !Number.isSafeInteger(Number(base))) {
    throw new Error("不正なリクエスト");
  }
  return Number(base);
}
function documentProps(doc: SiteDoc): Record<string, unknown> {
  const { pages, nodes, assets, components, ...rest } = doc;
  void pages; void nodes; void assets;
  if (Object.hasOwn(doc, "components")) {
    return { ...rest, components: components === null ? null : {} };
  }
  return rest;
}
function items(doc: SiteDoc, bucket: Bucket): Record<string, unknown> {
  return bucket === "components"
    ? object(doc.components) ? doc.components : {}
    : doc[bucket] as Record<string, unknown>;
}

/**
 * All revision checks and row updates occur within a synchronous SQLite
 * transaction. No await can interleave one editor's changes with another's.
 */
export class StructuredDocumentStore {
  constructor(private readonly storage: DocumentSqlStorage) {
    this.query("CREATE TABLE IF NOT EXISTS document_meta (id INTEGER PRIMARY KEY CHECK(id=1), rev INTEGER NOT NULL, saved_at INTEGER NOT NULL, props TEXT NOT NULL)");
    this.query("CREATE TABLE IF NOT EXISTS document_entries (bucket TEXT NOT NULL, entry_id TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(bucket,entry_id))");
    this.query("CREATE TABLE IF NOT EXISTS document_state (id INTEGER PRIMARY KEY CHECK(id=1), sealed INTEGER NOT NULL CHECK(sealed IN (0,1)))");
    this.query("INSERT OR IGNORE INTO document_state(id,sealed) VALUES(1,0)");
    this.query("CREATE TABLE IF NOT EXISTS document_backup_meta (day INTEGER PRIMARY KEY, saved_at INTEGER NOT NULL, bytes INTEGER NOT NULL)");
    this.query("CREATE TABLE IF NOT EXISTS document_backup_chunks (day INTEGER NOT NULL, part INTEGER NOT NULL, body TEXT NOT NULL, PRIMARY KEY(day,part))");
  }

  private query(sql: string, ...params: Param[]): Row[] {
    return this.storage.sql.exec(sql, ...params).toArray();
  }

  /** Deletion is permanent for this generation; a reused site ID gets a new DO. */
  private sealed(): boolean {
    return Number(this.query("SELECT sealed FROM document_state WHERE id=1")[0]?.sealed) === 1;
  }

  meta(): { rev: string; savedAt: number } | null {
    if (this.sealed()) return null;
    const row = this.query("SELECT rev,saved_at FROM document_meta WHERE id=1")[0];
    return row ? { rev: String(row.rev), savedAt: Number(row.saved_at) } : null;
  }

  snapshot(): SiteSnapshot | null {
    if (this.sealed()) return null;
    const row = this.query("SELECT rev,saved_at,props FROM document_meta WHERE id=1")[0];
    if (!row) return null;
    const props: unknown = JSON.parse(String(row.props));
    if (!object(props)) throw new Error("保存済み編集データが破損しています");
    const doc: Record<string, unknown> = { ...props, pages: {}, nodes: {}, assets: {} };
    if (object(props.components)) doc.components = {};
    for (const entry of this.query("SELECT bucket,entry_id,body FROM document_entries")) {
      const bucket = String(entry.bucket);
      const section = doc[bucket];
      if (!bucketsSet.has(bucket) || !object(section)) {
        throw new Error("保存済み編集データが破損しています");
      }
      Object.defineProperty(section, String(entry.entry_id), {
        value: JSON.parse(String(entry.body)), enumerable: true, configurable: true, writable: true,
      });
    }
    if (!validSiteDoc(doc)) throw new Error("保存済み編集データが破損しています");
    return { body: JSON.stringify(doc), rev: String(row.rev), savedAt: Number(row.saved_at) };
  }

  /**
   * Keep the previous day's final snapshot before the first edit of a new UTC
   * day. Snapshot data is chunked so even a 6MB+ document respects the DO's
   * 8MB row limit. Seven weekday slots are rotated, not stored indefinitely.
   */
  private preservePreviousDay(savedAt: number, now: number): void {
    if (savedAt >= Math.floor(now / 86_400_000) * 86_400_000) return;
    const previous = this.snapshot();
    if (!previous) return;
    const day = new Date(savedAt).getUTCDay();
    const rows = this.query("SELECT saved_at FROM document_backup_meta WHERE day=?", day);
    if (rows.length && Number(rows[0].saved_at) >= savedAt) return;
    const bytes = new TextEncoder().encode(previous.body).length;
    this.query("DELETE FROM document_backup_chunks WHERE day=?", day);
    this.query("INSERT INTO document_backup_meta(day,saved_at,bytes) VALUES(?,?,?) ON CONFLICT(day) DO UPDATE SET saved_at=excluded.saved_at,bytes=excluded.bytes",
      day, savedAt, bytes);
    // Never split a UTF-16 surrogate pair: SQLite text conversion would
    // replace isolated halves and corrupt emoji in the restored JSON.
    for (let i = 0, index = 0; i < previous.body.length; index++) {
      let end = Math.min(i + 250_000, previous.body.length);
      if (end < previous.body.length) {
        const firstHalf = previous.body.charCodeAt(end - 1);
        const secondHalf = previous.body.charCodeAt(end);
        if (firstHalf >= 0xd800 && firstHalf <= 0xdbff &&
            secondHalf >= 0xdc00 && secondHalf <= 0xdfff) end++;
      }
      this.query("INSERT INTO document_backup_chunks(day,part,body) VALUES(?,?,?)",
        day, index, previous.body.slice(i, end));
      i = end;
    }
  }

  listBackups(): Array<{ day: number; savedAt: number; bytes: number }> {
    if (this.sealed()) return [];
    return this.query("SELECT day,saved_at,bytes FROM document_backup_meta ORDER BY saved_at DESC")
      .map(row => ({ day: Number(row.day), savedAt: Number(row.saved_at), bytes: Number(row.bytes) }));
  }

  readBackup(day: number): string | null {
    if (!Number.isInteger(day) || day < 0 || day > 6 || this.sealed()) return null;
    if (!this.query("SELECT 1 FROM document_backup_meta WHERE day=?", day).length) return null;
    const chunks = this.query("SELECT body FROM document_backup_chunks WHERE day=? ORDER BY part", day);
    if (!chunks.length) throw new Error("バックアップが破損しています");
    const body = chunks.map(row => String(row.body)).join("");
    parseDoc(body);
    return body;
  }

  /** Full initialization/import or a fallback snapshot save. */
  replace(raw: string, base: string | null): SiteSaveResult {
    const doc = parseDoc(raw);
    const expected = revision(base);
    const props = checkedJson(documentProps(doc));
    const entries = buckets.flatMap(bucket => Object.entries(items(doc, bucket))
      .map(([id, value]) => [bucket, id, checkedJson(value)] as const));
    const now = Date.now();
    const outcome = this.storage.transactionSync(() => {
      if (this.sealed()) return "missing" as const;
      const current = this.meta();
      if (current && (expected === null || current.rev !== String(expected))) {
        return "conflict" as const;
      }
      if (!current && expected !== null) return "missing" as const;
      if (current) this.preservePreviousDay(current.savedAt, now);
      this.query("DELETE FROM document_entries");
      for (const [bucket, id, body] of entries) {
        this.query("INSERT INTO document_entries(bucket,entry_id,body) VALUES(?,?,?)", bucket, id, body);
      }
      if (!current) {
        this.query("INSERT INTO document_meta(id,rev,saved_at,props) VALUES(1,1,?,?)", now, props);
      } else {
        this.query("UPDATE document_meta SET rev=rev+1,saved_at=?,props=? WHERE id=1", now, props);
      }
      return "saved" as const;
    });
    if (outcome === "conflict") {
      const current = this.snapshot();
      return current ? { kind: "conflict", current } : { kind: "missing" };
    }
    return outcome === "missing" ? { kind: "missing" }
      : { kind: "saved", rev: String(expected === null ? 1 : expected + 1), savedAt: now };
  }

  /**
   * Fast path: changes to already existing nodes that preserve tree ownership.
   * All structural mutations use complete validation, but still update only
   * the changed SQLite rows rather than replacing the entire document.
   */
  patch(patch: DocPatch, base: string): SiteSaveResult {
    if (!isDocPatch(patch)) throw new Error("不正なリクエスト");
    const expected = revision(base);
    if (expected === null) throw new Error("不正なリクエスト");
    const now = Date.now();
    const outcome = this.storage.transactionSync(() => {
      if (this.sealed()) return "missing" as const;
      const current = this.query("SELECT rev,props,saved_at FROM document_meta WHERE id=1")[0];
      if (!current) return "missing" as const;
      if (Number(current.rev) !== expected) return "conflict" as const;
      this.preservePreviousDay(Number(current.saved_at), now);
      const props = JSON.parse(String(current.props)) as Record<string, unknown>;
      if (!object(props)) throw new Error("保存済み編集データが破損しています");
      const prepared: Array<{ id: string; body: string }> = [];
      let fast = patch.every(op =>
        op.path.length === 1 && op.path[0] === "siteName" &&
          "value" in op && typeof op.value === "string" ||
        op.path.length === 2 && op.path[0] === "nodes" && "value" in op);
      if (fast) {
        for (const op of patch) {
          if (op.path[0] === "siteName") continue;
          const id = op.path[1];
          const old = this.query("SELECT body FROM document_entries WHERE bucket='nodes' AND entry_id=?", id)[0];
          const next = "value" in op ? op.value : undefined;
          if (!old || !object(next) || next.id !== id ||
              !hasValidChildren(next) || !validDocNodeShape(next)) { fast = false; break; }
          const node = next as Record<string, unknown>;
          const previous = JSON.parse(String(old.body)) as Record<string, unknown>;
          if (!object(previous) || previous.type !== node.type ||
              previous.componentId !== node.componentId ||
              JSON.stringify(previous.children) !== JSON.stringify(node.children)) {
            fast = false; break;
          }
          for (const ref of [node.image, node.media]) {
            if (!object(ref) || ref.assetId === undefined) continue;
            if (typeof ref.assetId !== "string" ||
                !this.query("SELECT 1 FROM document_entries WHERE bucket='assets' AND entry_id=? LIMIT 1", ref.assetId).length) {
              fast = false; break;
            }
          }
          if (!fast) break;
          prepared.push({ id, body: checkedJson(next) });
        }
      }
      if (fast) {
        const updatedProps = { ...props };
        for (const op of patch) if (op.path[0] === "siteName" && "value" in op) updatedProps.siteName = op.value;
        for (const row of prepared) {
          this.query("UPDATE document_entries SET body=? WHERE bucket='nodes' AND entry_id=?", row.body, row.id);
        }
        this.query("UPDATE document_meta SET rev=rev+1,saved_at=?,props=? WHERE id=1",
          now, checkedJson(updatedProps));
        return "saved" as const;
      }
      const oldSnapshot = this.snapshot();
      if (!oldSnapshot) return "missing" as const;
      const updated = applyDocPatch(JSON.parse(oldSnapshot.body) as SiteDoc, patch);
      if (!validSiteDoc(updated)) throw new Error("不正なリクエスト");
      for (const op of patch) {
        const [name, id] = op.path;
        if (!bucketsSet.has(name)) continue;
        const bucket = name as Bucket;
        if (id === undefined) {
          this.query("DELETE FROM document_entries WHERE bucket=?", bucket);
          for (const [entryId, value] of Object.entries(items(updated, bucket))) {
            this.query("INSERT INTO document_entries(bucket,entry_id,body) VALUES(?,?,?)",
              bucket, entryId, checkedJson(value));
          }
        } else if ("remove" in op) {
          this.query("DELETE FROM document_entries WHERE bucket=? AND entry_id=?", bucket, id);
        } else {
          this.query("INSERT INTO document_entries(bucket,entry_id,body) VALUES(?,?,?) ON CONFLICT(bucket,entry_id) DO UPDATE SET body=excluded.body",
            bucket, id, checkedJson(op.value));
        }
      }
      this.query("UPDATE document_meta SET rev=rev+1,saved_at=?,props=? WHERE id=1",
        now, checkedJson(documentProps(updated)));
      return "saved" as const;
    });
    if (outcome === "conflict") {
      const current = this.snapshot();
      return current ? { kind: "conflict", current } : { kind: "missing" };
    }
    return outcome === "missing" ? { kind: "missing" }
      : { kind: "saved", rev: String(expected + 1), savedAt: now };
  }

  assetReferences(): Array<{ path: string; bytes: number | null }> {
    if (this.sealed()) return [];
    return this.query("SELECT body FROM document_entries WHERE bucket='assets'").flatMap(row => {
      const asset = JSON.parse(String(row.body)) as { path?: unknown; bytes?: unknown };
      return typeof asset.path === "string"
        ? [{ path: asset.path, bytes: typeof asset.bytes === "number" ? asset.bytes : null }]
        : [];
    });
  }

  /** A completed delete cannot be undone by any delayed RPC invocation. */
  erase(): void {
    this.storage.transactionSync(() => {
      this.query("UPDATE document_state SET sealed=1 WHERE id=1");
      this.query("DELETE FROM document_entries");
      this.query("DELETE FROM document_meta");
      this.query("DELETE FROM document_backup_chunks");
      this.query("DELETE FROM document_backup_meta");
    });
  }
}
