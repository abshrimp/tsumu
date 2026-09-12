import { hasValidChildren, MAX_NODE_DEPTH, validAssetEntry, validComponentEntry, validDocNodeShape, validDocPageShape, validSiteDoc } from "./doc-tree";
import type { Db, ResultSet } from "./db";
import { applyDocPatch, docPatchSqlPath, isDocPatch, type DocPatch } from "./doc-patch";
import type { SiteDoc } from "./types";

/**
 * Node.js・Docker 用の、ローカルの SQLite への文書の保存。
 * 1つのサイトを docs テーブルの1行として保存し、保存先の容量の上限は、実際の SQLite のエラーで判定する。
 */

/** 保存先に入りきらない編集データ（API は 413 を返す） */
export class DocTooLargeError extends Error {
  constructor() {
    super("ドキュメントが大きすぎて、保存先に入りきりません");
  }
}

/** 差分を適用すると、文書を開き直せなくなる。 */
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
  /** サイトが無い（他のタブや他の人が削除した）。編集データを作り直さない */
  | { kind: "missing" };

/** 本文の形を確かめる（大きさは、保存するときに保存先の上限で確かめる） */
export function validateDocBody(raw: string): string | null {
  try { return validateDocValue(JSON.parse(raw)); }
  catch { return "JSONが壊れています"; }
}

export function validateDocValue(parsed: unknown): string | null {
  return validSiteDoc(parsed) ? null : "不正なリクエスト";
}

/** SQLite の大きさの上限のエラーを API に伝えるための、保存の処理。 */
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
  // Node.js の SQLite でも、Durable Object のスナップショットと同じ読み取り時の条件を守る。
  if (validateDocBody(String(row.body))) {
    throw new Error("保存済み編集データが破損しています");
  }
  return {
    rev: String(row.rev),
    savedAt: Number(row.saved_at),
    body: String(row.body),
  };
}

/**
 * 日次バックアップ（曜日ごとの7世代をローテーションする）。日付（UTC）が変わってから最初の保存の直前に、
 * それまでの内容（前に編集した日の最後の内容）を、その日の曜日の枠へ残す。
 * 保存した後の内容を残すと、その日の最初の保存で壊したときに、壊れた内容しか残らないため
 */
async function backupPreviousDay(db: Db, siteId: string, now: number) {
  try {
    const dayStart = Math.floor(now / 86_400_000) * 86_400_000;
    // 本文を Worker へ取り出さずに、DB の中でコピーする。並行して保存されても、より新しい内容でだけ上書きする。
    await db.execute({
      sql: `INSERT INTO site_backups (site_id, day, saved_at, body)
        SELECT id, CAST(strftime('%w', saved_at / 1000, 'unixepoch') AS INTEGER), saved_at, body
        FROM docs WHERE id = ? AND saved_at < ?
        ON CONFLICT(site_id, day) DO UPDATE SET saved_at = excluded.saved_at, body = excluded.body
        WHERE site_backups.saved_at < excluded.saved_at`,
      args: [siteId, dayStart],
    });
  } catch {
    // バックアップの失敗は、保存そのものには影響させない
  }
}

export async function saveCurrentDoc(
  db: Db,
  siteId: string,
  raw: string,
  base: string | null
): Promise<SaveDocResult> {
  // 保存する文書の検証を、HTTP の呼び出し側に任せない。
  // 保存先を直接使う処理・インポート・複製も、同じ条件を守らなければならない。
  const invalid = validateDocBody(raw);
  if (invalid) throw new Error(invalid);
  if (base !== null && (!/^[1-9]\d*$/.test(base) || !Number.isSafeInteger(Number(base)))) {
    throw new Error("不正なリクエスト");
  }
  const now = Date.now();
  if (base !== null) {
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

  // サイトの一覧に無い編集データは作らない（削除したサイトを開いたままのタブが保存すると、
  // 一覧に表示されないデータが残り、そのアセットも「他のサイトが使用中」として消せなくなる）
  const rs = await write(db, {
    // base の無い保存は、初回の作成だけ。読み込みの失敗や同時の作成でも、既存のデータを上書きしない。
    sql: "INSERT INTO docs (id, rev, saved_at, body) SELECT ?, 1, ?, ? WHERE EXISTS (SELECT 1 FROM sites WHERE id = ?) ON CONFLICT(id) DO NOTHING RETURNING rev",
    args: [siteId, now, raw, siteId],
  });
  if (!rs.rows.length) {
    const current = await readCurrentDoc(db, siteId);
    return current ? { kind: "conflict", current } : { kind: "missing" };
  }
  return { kind: "saved", rev: String(rs.rows[0].rev), savedAt: now };
}

/** 本文を取得せずに、版の照合と差分の反映を1つの SQL で原子的に行う。 */
export async function saveDocPatch(db: Db, siteId: string, patch: DocPatch, base: string): Promise<SaveDocResult> {
  if (!/^[1-9]\d*$/.test(base) || !Number.isSafeInteger(Number(base)) || !isDocPatch(patch)) {
    throw new Error("不正なリクエスト");
  }
  // 変更したページの定義は、保存した文書全体を読まずに検証する。
  // 通常の要素やスタイルの差分は、SQL だけで済む高速な経路のまま扱う。
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
  // 通常の末端や項目の編集は、SQL だけで済む高速な経路のまま扱う。コンポーネントの定義、
  // インスタンス、空でない子の一覧を変更すると、通常のノードのツリーが正しくても、
  // 間接的な参照の循環が生じることがある。それらは先に、楽観ロックの基準の版と照らして検証する。
  // 下の UPDATE にも WHERE rev = base が付いているため、この読み取りと UPDATE の間に
  // 別の書き込みがあっても、検証をすり抜けることはない。
  const referenceSensitive = patch.some(op => {
    // SQL だけの更新でも、ページ・ノード・アセットの形とページの並びは検証するが、
    // サイト全体の他の項目には SQL での型の検査が無い。そうした項目を更新するときは、
    // 保存した JSON を変える前に、正規の SiteDoc の検証を通す。
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
  // SQL のバインド変数の数を抑えるため、json_set は最大12組ずつ適用する。
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
  // ツリー全体の検査が必要なのは、子の一覧の変更・追加・削除だけ。
  // 高速な経路でも下のたどる処理でも、書き込みと同じ版を調べる。
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
