import type { Db } from "./db";
import { SITE_EDIT_METADATA_INTERVAL_MS } from "./sites";

/**
 * サイトの編集・公開の記録（D1 の site_activity テーブル）。
 * 人ごと・種類ごとに最後の時刻だけを持つ（右下の「保存」「公開」にホバーしたときに出す）
 */

export type ActivityKind = "edit" | "publish" | "publish-test";

/** 編集・公開した人（ログインなしで使っているときは email が空） */
export interface ActivityUser {
  email: string;
  name: string | null;
  image: string | null;
}

export interface ActivityEntry extends ActivityUser {
  at: number;
}

export interface SiteActivity {
  /** 直近 RECENT_MS に編集した人（新しい順） */
  recentEditors: ActivityEntry[];
  /** 最後に編集した人 */
  lastEdit: ActivityEntry | null;
  lastPublish: ActivityEntry | null;
  lastTestPublish: ActivityEntry | null;
}

/** 「直近」とする時間（10分） */
export const RECENT_MS = 10 * 60 * 1000;

const clip = (v: unknown, max: number): string | null =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;

/** ヘッダー・メッセージで受け取った値を、記録できる形にそろえる（壊れていれば null） */
export function parseActivityUser(raw: unknown): ActivityUser | null {
  if (!raw || typeof raw !== "object") return null;
  const u = raw as Record<string, unknown>;
  const image = clip(u.image, 500);
  return {
    email: (clip(u.email, 200) ?? "").toLowerCase(),
    name: clip(u.name, 100),
    image: image && /^https:\/\//.test(image) ? image : null,
  };
}

/** 編集・公開したことを記録する（記録に失敗しても保存・公開は成功させる） */
export async function recordActivity(
  db: Db,
  siteId: string,
  kind: ActivityKind,
  user: ActivityUser | null,
  at = Date.now(),
  expectedRoomKey?: string | null
): Promise<void> {
  // 保存した世代と同じ行だけに、存在確認と記録を一つのSQLで行う。
  const fenced = db.backend === "d1" && expectedRoomKey !== undefined;
  // The D1 edit hover history is approximate, not the authoritative savedAt.
  // A conditional upsert throttles writes atomically across Worker instances.
  // Keep publishing activity immediate and Node/Docker history unchanged.
  const minInterval = kind === "edit" && db.backend === "d1"
    ? SITE_EDIT_METADATA_INTERVAL_MS : 0;
  const u = user ?? { email: "", name: null, image: null };
  try {
    await db.execute({
      sql: `INSERT INTO site_activity (site_id, kind, email, name, image, at)
        SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM sites WHERE id = ?)
        ${fenced ? "AND EXISTS (SELECT 1 FROM site_document_rooms WHERE site_id = ? AND room_key = ?)" : ""}
        ON CONFLICT(site_id, kind, email) DO UPDATE SET name = excluded.name, image = excluded.image, at = excluded.at
        WHERE site_activity.at <= excluded.at - ?`,
      args: [siteId, kind, u.email, u.name, u.image, at, siteId, ...(fenced ? [siteId, expectedRoomKey ?? null] : []), minInterval],
    });
  } catch {
    // 記録は表示のためだけなので、失敗しても無視する
  }
}

export async function readActivity(db: Db, siteId: string, now = Date.now()): Promise<SiteActivity> {
  const rs = await db.execute({
    sql: "SELECT kind, email, name, image, at FROM site_activity WHERE site_id = ? ORDER BY at DESC",
    args: [siteId],
  });
  const rows = rs.rows.map((r) => ({
    kind: String(r.kind) as ActivityKind,
    email: String(r.email ?? ""),
    name: r.name == null ? null : String(r.name),
    image: r.image == null ? null : String(r.image),
    at: Number(r.at),
  }));
  const entry = ({ kind: _kind, ...rest }: (typeof rows)[number]): ActivityEntry => rest;
  const edits = rows.filter((r) => r.kind === "edit");
  const first = (kind: ActivityKind) => {
    const r = rows.find((x) => x.kind === kind);
    return r ? entry(r) : null;
  };
  return {
    recentEditors: edits.filter((r) => now - r.at <= RECENT_MS).map(entry),
    lastEdit: edits[0] ? entry(edits[0]) : null,
    lastPublish: first("publish"),
    lastTestPublish: first("publish-test"),
  };
}
