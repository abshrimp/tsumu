import { hasValidChildren, MAX_NODE_DEPTH, validAssetEntry, validComponentEntry, validDocNodeShape, validDocPageShape, validSiteDoc } from "./doc-tree";
import type { Db, ResultSet } from "./db";
import { applyDocPatch, docPatchSqlPath, isDocPatch, type DocPatch } from "./doc-patch";
import type { SiteDoc } from "./types";

/**
 * Node.js / Docker用ローカルSQLiteの文書保存。
 * 1サイトを docs テーブルの1行として保存し、保存先の容量制限は実際のSQLiteエラーで判定する。
 */

/** 保存先に入りきらない編集データ（API は 413 で返す） */
export class DocTooLargeError extends Error {
  constructor() {
    super("ドキュメントが大きすぎて、保存先に入りきりません");
  }
}

/** A delta would make the document impossible to reopen. */
export class InvalidDocPatchError extends Error {
  constructor() { super("不正なリクエスト"); }
}

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

/** 本文の形を確かめる（大きさは保存するときに、保存先の上限で確かめる） */
export function validateDocBody(raw: string): string | null {
  try { return validateDocValue(JSON.parse(raw)); }
  catch { return "JSONが壊れています"; }
}

export function validateDocValue(parsed: unknown): string | null {
  return validSiteDoc(parsed) ? null : "不正なリクエスト";
}

/** SQLiteのサイズ制限エラーをAPIに伝えるための保存処理。 */
async function write(db: Db, stmt: Parameters<Db["execute"]>[0]): Promise<ResultSet> {
  try {
    return await db.execute(stmt);
  } catch (e) {
    if (/SQLITE_TOOBIG|too big/i.test(e instanceof Error ? e.message : String(e))) {
      throw new DocTooLargeError();
    }
    throw e;
  }
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

/**
 * 日次バックアップ（曜日で7世代ローテーション）。日付（UTC）が変わってから最初の保存の直前に、
 * それまでの内容（前に編集した日の最後の内容）を、その日の曜日の枠へ残す。
 * 保存した後の内容を残すと、その日最初の保存で壊したときに壊れた内容しか残らないため
 */
async function backupPreviousDay(db: Db, siteId: string, now: number) {
  try {
    const dayStart = Math.floor(now / 86_400_000) * 86_400_000;
    // 本文をWorkerへ取り出さずDB内でコピーする。並行保存でも、より新しい内容でだけ上書きする。
    await db.execute({
      sql: `INSERT INTO site_backups (site_id, day, saved_at, body)
        SELECT id, CAST(strftime('%w', saved_at / 1000, 'unixepoch') AS INTEGER), saved_at, body
        FROM docs WHERE id = ? AND saved_at < ?
        ON CONFLICT(site_id, day) DO UPDATE SET saved_at = excluded.saved_at, body = excluded.body
        WHERE site_backups.saved_at < excluded.saved_at`,
      args: [siteId, dayStart],
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
    await backupPreviousDay(db, siteId, now);
    const rs = await write(db, {
      sql: "UPDATE docs SET body = ?, rev = rev + 1, saved_at = ? WHERE id = ? AND rev = ? RETURNING rev",
      args: [raw, now, siteId, Number(base)],
    });
    if (rs.rows.length) {
      return { kind: "saved", rev: String(rs.rows[0].rev), savedAt: now };
    }
    const current = await readCurrentDoc(db, siteId);
    if (current) return { kind: "conflict", current };
    return { kind: "missing" };
  }

  // サイトの一覧に無い編集データは作らない（消したサイトを開いたままのタブが保存すると、
  // 一覧に出ないデータが残り、そのアセットも「ほかのサイトが使用中」として消せなくなる）
  const rs = await write(db, {
    // base の無い保存は初回作成だけ。読み込み失敗や同時作成でも既存データを上書きしない。
    sql: "INSERT INTO docs (id, rev, saved_at, body) SELECT ?, 1, ?, ? WHERE EXISTS (SELECT 1 FROM sites WHERE id = ?) ON CONFLICT(id) DO NOTHING RETURNING rev",
    args: [siteId, now, raw, siteId],
  });
  if (!rs.rows.length) {
    const current = await readCurrentDoc(db, siteId);
    return current ? { kind: "conflict", current } : { kind: "missing" };
  }
  return { kind: "saved", rev: String(rs.rows[0].rev), savedAt: now };
}

/** 本文を取得せず、版の照合と差分反映を1つのSQLで原子的に行う。 */
export async function saveDocPatch(db: Db, siteId: string, patch: DocPatch, base: string): Promise<SaveDocResult> {
  if (!/^[1-9]\d*$/.test(base) || !Number.isSafeInteger(Number(base)) || !isDocPatch(patch)) {
    throw new Error("不正なリクエスト");
  }
  // Validate changed page definitions without reading the entire stored document.
  // Ordinary element/style patches retain the existing SQL-only fast path.
  for (const op of patch) {
    const collection = op.path[0];
    if (!["pages", "nodes", "assets", "components"].includes(collection) || !("value" in op)) continue;
    const entries = op.path.length === 2 ? [[op.path[1], op.value] as const] :
      Object.entries(op.value as Record<string, unknown>);
    for (const [id, item] of entries) {
      const valid = collection === "assets" ? validAssetEntry(id, item) :
        collection === "components" ? validComponentEntry(id, item) :
        hasValidChildren(item) && "id" in item && item.id === id &&
        (collection === "pages"
          ? "slug" in item && typeof item.slug === "string" && validDocPageShape(item)
          : validDocNodeShape(item));
      if (!valid) throw new InvalidDocPatchError();
    }
  }
  // An ordinary leaf/property edit stays on the SQL-only fast path. Changes
  // to a component definition, instance, or non-empty child list can create a
  // second-order reference cycle even when the ordinary node tree is valid.
  // Validate those against the exact optimistic-lock base revision first.
  // The UPDATE below still has WHERE rev = base: a concurrent write between
  // this read and the UPDATE cannot bypass the check.
  const referenceSensitive = patch.some(op => {
    // SQL-only updates validate page/node/asset shapes and page ordering, but
    // other site-level fields have no SQL type checks. Use the canonical
    // SiteDoc validator for those updates before changing persisted JSON.
    if (op.path.length === 1 &&
        !["siteName", "pageOrder", "pages", "nodes", "assets", "components"].includes(op.path[0])) {
      return true;
    }
    if (op.path[0] === "components" || op.path[0] === "pageFolders" ||
        op.path[0] === "favicon" || op.path[0] === "appleTouchIcon" ||
        op.path[0] === "ogImage" || op.path[0] === "pwa") return true;
    if (op.path[0] === "assets") return op.path.length === 1 || "remove" in op;
    if (op.path[0] === "pages") {
      if (op.path.length === 1) return true;
      return "value" in op && !!op.value && typeof op.value === "object" &&
        !Array.isArray(op.value) &&
        (Object.hasOwn(op.value, "folderId") || Object.hasOwn(op.value, "ogImage"));
    }
    if (op.path[0] !== "nodes") return false;
    if (op.path.length === 1) return true;
    if (!("value" in op) || !op.value || typeof op.value !== "object" || Array.isArray(op.value)) return false;
    const node = op.value as Record<string, unknown>;
    return node.type === "instance" || Object.hasOwn(node, "image") || Object.hasOwn(node, "media") ||
      (Array.isArray(node.children) && node.children.length > 0);
  });
  if (referenceSensitive) {
    const current = await readCurrentDoc(db, siteId);
    if (!current) return { kind: "missing" };
    if (current.rev !== base) return { kind: "conflict", current };
    try {
      const next = applyDocPatch(JSON.parse(current.body) as SiteDoc, patch);
      if (validateDocValue(next)) throw new InvalidDocPatchError();
    } catch {
      throw new InvalidDocPatchError();
    }
  }
  const treeOps = patch.filter(op => op.path[0] === "nodes" || op.path[0] === "pages" || op.path[0] === "components");
  const needsPageGuard = patch.some((op) =>
    op.path[0] === "pages" || op.path[0] === "pageOrder");
  const args: (string | number | null)[] = [];
  let body = "body";
  // SQLのバインド変数数を抑えるため、json_setは最大12組ずつ適用する。
  for (let i = 0; i < patch.length; i += 12) {
    const chunk = patch.slice(i, i + 12);
    const sets: string[] = [];
    const removes: string[] = [];
    for (const op of chunk.filter((op) => !("remove" in op))) {
      sets.push("?, json(?)");
      args.push(docPatchSqlPath(op.path), JSON.stringify("value" in op ? op.value : null));
    }
    if (sets.length) body = `json_set(${body}, ${sets.join(", ")})`;
    for (const op of chunk.filter((op) => "remove" in op)) {
      removes.push("?");
      args.push(docPatchSqlPath(op.path));
    }
    if (removes.length) body = `json_remove(${body}, ${removes.join(", ")})`;
  }
  const pageGuard = needsPageGuard ? `AND EXISTS (
    SELECT 1 FROM patched
    WHERE json_type(body, '$.pages') = 'object'
      AND json_type(body, '$.pageOrder') = 'array'
      AND json_array_length(body, '$.pageOrder') > 0
      AND (SELECT COUNT(*) FROM json_each(body, '$.pageOrder')) =
          (SELECT COUNT(DISTINCT value) FROM json_each(body, '$.pageOrder'))
      AND NOT EXISTS (
        SELECT 1 FROM json_each(body, '$.pageOrder') AS item
        WHERE item.type != 'text' OR NOT EXISTS (
          SELECT 1 FROM json_each(body, '$.pages') AS page
          WHERE page.key = item.value AND page.type = 'object'
        )
      )
  )` : "";
  // Only a changed child list, addition or removal needs the full forest check.
  // Both the fast path and the walk below inspect the same revision as the write.
  const individual = treeOps.length > 0 && treeOps.every(op => op.path[0] !== "components" && op.path.length === 2 && "value" in op);
  const sameChildren = individual ? `NOT EXISTS (
    SELECT 1 FROM json_each(?) AS p, patched
    WHERE json_extract(docs.body, p.value) IS NOT json_extract(patched.body, p.value)
  ) OR` : "";
  const treeGuard = treeOps.length ? `AND (${sameChildren} (
    WITH RECURSIVE
      nodes AS MATERIALIZED (SELECT n.key AS id, n.type, n.value FROM patched, json_each(patched.body, '$.nodes') n),
      pages AS MATERIALIZED (SELECT p.type, p.value FROM patched, json_each(patched.body, '$.pages') p),
      components AS (SELECT c.key AS id, c.type, c.value FROM patched, json_each(patched.body, '$.components') c
        WHERE json_type(patched.body, '$.components') = 'object'),
      edges AS MATERIALIZED (SELECT n.id AS parent, c.value AS child, c.type
        FROM nodes n, json_each(CASE WHEN n.type = 'object' THEN n.value END, '$.children') c),
      ownership AS (
        SELECT child FROM edges
        UNION ALL SELECT c.value FROM pages p, json_each(CASE WHEN p.type = 'object' THEN p.value END, '$.children') c
      ),
      walk(id, depth) AS (
        SELECT id, 1 FROM nodes WHERE id NOT IN (SELECT child FROM edges WHERE type = 'text')
        UNION ALL SELECT e.child, w.depth + 1 FROM walk w JOIN edges e ON e.parent = w.id
        WHERE w.depth < ${MAX_NODE_DEPTH}
      )
    SELECT CASE
      WHEN EXISTS (SELECT 1 FROM nodes WHERE CASE WHEN type != 'object' THEN 1 ELSE
        json_extract(value, '$.id') IS NOT id OR json_type(value, '$.children') IS NOT 'array' END) THEN 0
      WHEN EXISTS (SELECT 1 FROM edges LEFT JOIN nodes ON nodes.id = edges.child
        WHERE edges.type != 'text' OR nodes.id IS NULL) THEN 0
      WHEN EXISTS (SELECT 1 FROM ownership GROUP BY child HAVING COUNT(*) > 1) THEN 0
      WHEN EXISTS (SELECT 1 FROM pages WHERE CASE WHEN type != 'object' THEN 1 ELSE
        json_type(value, '$.children') IS NOT 'array' END) THEN 0
      WHEN EXISTS (SELECT 1 FROM pages p, json_each(p.value, '$.children') c
        LEFT JOIN nodes n ON n.id = c.value WHERE c.type != 'text' OR n.id IS NULL) THEN 0
      WHEN EXISTS (SELECT 1 FROM components c WHERE CASE WHEN c.type != 'object' THEN 1 ELSE
        json_extract(c.value, '$.id') IS NOT c.id OR json_type(c.value, '$.name') IS NOT 'text' OR
        NOT EXISTS (SELECT 1 FROM nodes n WHERE n.id = json_extract(c.value, '$.rootId')) END) THEN 0
      ELSE (SELECT COUNT(*) FROM walk) = (SELECT COUNT(*) FROM nodes)
    END
  ))` : "";
  const now = Date.now();
  await backupPreviousDay(db, siteId, now);
  const rs = await write(db, {
    sql: `WITH patched AS MATERIALIZED (SELECT ${body} AS body FROM docs WHERE id = ? AND rev = ?) UPDATE docs SET body = (SELECT body FROM patched), rev = rev + 1, saved_at = ? WHERE id = ? AND rev = ? ${pageGuard} ${treeGuard} RETURNING rev`,
    args: [...args, siteId, Number(base), now, siteId, Number(base),
      ...(individual ? [JSON.stringify(treeOps.map(op => docPatchSqlPath([...op.path, "children"])))] : [])],
  });
  if (rs.rows.length) {
    return { kind: "saved", rev: String(rs.rows[0].rev), savedAt: now };
  }
  const current = await readCurrentDoc(db, siteId);
  if ((needsPageGuard || treeOps.length) && current?.rev === base) throw new InvalidDocPatchError();
  return current ? { kind: "conflict", current } : { kind: "missing" };
}
