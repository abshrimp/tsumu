import type { Db } from "./db";
import type { ActivityUser } from "./activity";

/**
 * エディタのコメント（ページの要素に付けるメモと、その返信）。
 * 編集データ（公開・元に戻すの対象）とは分けて、D1 の comment_threads / comment_messages に保存する。
 * D1 が無いときは、ブラウザ側（lib/comment-store.ts）が同じ形でこのブラウザに保存する
 */

export interface CommentMessage {
  id: string;
  author: ActivityUser;
  body: string;
  at: number;
  editedAt?: number;
}

export interface CommentThread {
  id: string;
  pageId: string;
  /** 付けた要素（null = ページの何もないところ） */
  nodeId: string | null;
  /** 要素（またはページ）の中での位置（0〜1） */
  x: number;
  y: number;
  /** 付けたときの画面幅（ブレークポイントのID） */
  bp: string;
  createdAt: number;
  updatedAt: number;
  resolvedAt: number | null;
  resolvedBy: ActivityUser | null;
  messages: CommentMessage[];
}

/** コメントの操作（API の POST と、ブラウザ保存で共通） */
export type CommentAction =
  | { action: "create"; id: string; pageId: string; nodeId: string | null; x: number; y: number; bp: string; body: string }
  | { action: "reply"; threadId: string; id: string; body: string }
  | { action: "edit"; messageId: string; body: string }
  | { action: "resolve"; threadId: string; resolved: boolean }
  | { action: "delete-message"; messageId: string }
  | { action: "delete-thread"; threadId: string };

export const MAX_COMMENT_LENGTH = 5000;
const ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

const num01 = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : null);
const text = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, MAX_COMMENT_LENGTH) : "");

/** 受け取った操作を確かめる（壊れていれば null） */
export function parseCommentAction(raw: unknown): CommentAction | null {
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Record<string, unknown>;
  const id = (k: string) => (typeof a[k] === "string" && ID_RE.test(a[k] as string) ? (a[k] as string) : null);
  switch (a.action) {
    case "create": {
      const x = num01(a.x);
      const y = num01(a.y);
      const body = text(a.body);
      const tid = id("id");
      const pageId = id("pageId");
      const nodeId = a.nodeId === null ? null : id("nodeId");
      if (!tid || !pageId || x === null || y === null || !body || (a.nodeId !== null && !nodeId)) return null;
      return { action: "create", id: tid, pageId, nodeId, x, y, bp: typeof a.bp === "string" ? a.bp.slice(0, 40) : "base", body };
    }
    case "reply": {
      const threadId = id("threadId");
      const mid = id("id");
      const body = text(a.body);
      return threadId && mid && body ? { action: "reply", threadId, id: mid, body } : null;
    }
    case "edit": {
      const messageId = id("messageId");
      const body = text(a.body);
      return messageId && body ? { action: "edit", messageId, body } : null;
    }
    case "resolve": {
      const threadId = id("threadId");
      return threadId && typeof a.resolved === "boolean" ? { action: "resolve", threadId, resolved: a.resolved } : null;
    }
    case "delete-message": {
      const messageId = id("messageId");
      return messageId ? { action: "delete-message", messageId } : null;
    }
    case "delete-thread": {
      const threadId = id("threadId");
      return threadId ? { action: "delete-thread", threadId } : null;
    }
    default:
      return null;
  }
}

/** 自分が書いたコメントか（ログインなしで使っているときは、誰でも自分のものとして扱う） */
export const isAuthor = (author: ActivityUser, user: ActivityUser | null) =>
  !user || !author.email || author.email === user.email;

const ANON: ActivityUser = { email: "", name: null, image: null };

/**
 * 操作をコメントの一覧に当てはめる（ブラウザ保存で使う。threads を書き換えずに新しい一覧を返す）。
 * 他人のコメントの編集・削除はしない（スレッドの削除は最初のコメントを書いた人だけ）
 */
export function applyCommentAction(
  threads: CommentThread[],
  a: CommentAction,
  user: ActivityUser | null,
  now = Date.now()
): CommentThread[] {
  const me = user ?? ANON;
  const touch = (t: CommentThread, patch: Partial<CommentThread>): CommentThread => ({ ...t, ...patch, updatedAt: now });
  switch (a.action) {
    case "create":
      if (threads.some((t) => t.id === a.id)) return threads;
      return [
        ...threads,
        {
          id: a.id,
          pageId: a.pageId,
          nodeId: a.nodeId,
          x: a.x,
          y: a.y,
          bp: a.bp,
          createdAt: now,
          updatedAt: now,
          resolvedAt: null,
          resolvedBy: null,
          messages: [{ id: `${a.id}-0`, author: me, body: a.body, at: now }],
        },
      ];
    case "reply":
      return threads.map((t) =>
        t.id === a.threadId && !t.messages.some((m) => m.id === a.id)
          ? touch(t, { messages: [...t.messages, { id: a.id, author: me, body: a.body, at: now }] })
          : t
      );
    case "edit":
      return threads.map((t) =>
        t.messages.some((m) => m.id === a.messageId && isAuthor(m.author, user))
          ? touch(t, {
              messages: t.messages.map((m) => (m.id === a.messageId ? { ...m, body: a.body, editedAt: now } : m)),
            })
          : t
      );
    case "resolve":
      return threads.map((t) =>
        t.id === a.threadId ? touch(t, { resolvedAt: a.resolved ? now : null, resolvedBy: a.resolved ? me : null }) : t
      );
    case "delete-message":
      return threads
        .map((t) => {
          const m = t.messages.find((x) => x.id === a.messageId);
          if (!m || !isAuthor(m.author, user)) return t;
          return touch(t, { messages: t.messages.filter((x) => x.id !== a.messageId) });
        })
        .filter((t) => t.messages.length > 0);
    case "delete-thread":
      return threads.filter((t) => t.id !== a.threadId || !isAuthor(t.messages[0]?.author ?? ANON, user));
  }
}

/* ---------- D1 ---------- */

const userOf = (r: Record<string, unknown>, prefix = ""): ActivityUser => ({
  email: String(r[`${prefix}email`] ?? ""),
  name: r[`${prefix}name`] == null ? null : String(r[`${prefix}name`]),
  image: r[`${prefix}image`] == null ? null : String(r[`${prefix}image`]),
});

export async function listComments(db: Db, siteId: string): Promise<CommentThread[]> {
  const [threads, messages] = await db.batch([
    {
      sql: `SELECT id, page_id, node_id, x, y, bp, created_at, updated_at, resolved_at, resolved_email, resolved_name, resolved_image
        FROM comment_threads WHERE site_id = ? ORDER BY created_at LIMIT 1000`,
      args: [siteId],
    },
    {
      sql: "SELECT id, thread_id, email, name, image, body, at, edited_at FROM comment_messages WHERE site_id = ? ORDER BY at",
      args: [siteId],
    },
  ]);
  const byThread = new Map<string, CommentMessage[]>();
  for (const r of messages.rows) {
    const list = byThread.get(String(r.thread_id)) ?? [];
    list.push({
      id: String(r.id),
      author: userOf(r),
      body: String(r.body),
      at: Number(r.at),
      ...(r.edited_at == null ? {} : { editedAt: Number(r.edited_at) }),
    });
    byThread.set(String(r.thread_id), list);
  }
  return threads.rows
    .map((r) => ({
      id: String(r.id),
      pageId: String(r.page_id),
      nodeId: r.node_id == null ? null : String(r.node_id),
      x: Number(r.x),
      y: Number(r.y),
      bp: String(r.bp ?? "base"),
      createdAt: Number(r.created_at),
      updatedAt: Number(r.updated_at),
      resolvedAt: r.resolved_at == null ? null : Number(r.resolved_at),
      resolvedBy: r.resolved_at == null ? null : userOf(r, "resolved_"),
      messages: byThread.get(String(r.id)) ?? [],
    }))
    .filter((t) => t.messages.length > 0);
}

/** 操作を D1 に当てはめる。他人のコメントを編集・削除しようとしたら false */
export async function runCommentAction(
  db: Db,
  siteId: string,
  a: CommentAction,
  user: ActivityUser | null,
  now = Date.now()
): Promise<boolean> {
  const me = user ?? ANON;
  const authorOf = async (messageId: string): Promise<{ thread: string; author: ActivityUser } | null> => {
    const rs = await db.execute({
      sql: "SELECT thread_id, email, name, image FROM comment_messages WHERE id = ? AND site_id = ?",
      args: [messageId, siteId],
    });
    const r = rs.rows[0];
    return r ? { thread: String(r.thread_id), author: userOf(r) } : null;
  };
  const bump = (threadId: string) => ({
    sql: "UPDATE comment_threads SET updated_at = ? WHERE id = ? AND site_id = ?",
    args: [now, threadId, siteId],
  });
  switch (a.action) {
    case "create":
      await db.batch([
        {
          sql: `INSERT INTO comment_threads (id, site_id, page_id, node_id, x, y, bp, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [a.id, siteId, a.pageId, a.nodeId, a.x, a.y, a.bp, now, now],
        },
        {
          sql: `INSERT INTO comment_messages (id, thread_id, site_id, email, name, image, body, at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [`${a.id}-0`, a.id, siteId, me.email, me.name, me.image, a.body, now],
        },
      ]);
      return true;
    case "reply": {
      const rs = await db.execute({
        sql: "SELECT id FROM comment_threads WHERE id = ? AND site_id = ?",
        args: [a.threadId, siteId],
      });
      // ほかの人が消したスレッドへの返信は、何もしない（返す一覧に出ない）
      if (!rs.rows.length) return true;
      await db.batch([
        {
          sql: `INSERT INTO comment_messages (id, thread_id, site_id, email, name, image, body, at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`,
          args: [a.id, a.threadId, siteId, me.email, me.name, me.image, a.body, now],
        },
        bump(a.threadId),
      ]);
      return true;
    }
    case "edit": {
      const m = await authorOf(a.messageId);
      if (!m || !isAuthor(m.author, user)) return false;
      await db.batch([
        {
          sql: "UPDATE comment_messages SET body = ?, edited_at = ? WHERE id = ? AND site_id = ?",
          args: [a.body, now, a.messageId, siteId],
        },
        bump(m.thread),
      ]);
      return true;
    }
    case "resolve":
      await db.execute({
        sql: `UPDATE comment_threads SET resolved_at = ?, resolved_email = ?, resolved_name = ?, resolved_image = ?, updated_at = ?
          WHERE id = ? AND site_id = ?`,
        args: a.resolved
          ? [now, me.email, me.name, me.image, now, a.threadId, siteId]
          : [null, null, null, null, now, a.threadId, siteId],
      });
      return true;
    case "delete-message": {
      const m = await authorOf(a.messageId);
      if (!m || !isAuthor(m.author, user)) return false;
      await db.batch([
        { sql: "DELETE FROM comment_messages WHERE id = ? AND site_id = ?", args: [a.messageId, siteId] },
        bump(m.thread),
        // 最後のコメントを消したら、スレッドも消す
        {
          sql: `DELETE FROM comment_threads WHERE id = ? AND site_id = ?
            AND NOT EXISTS (SELECT 1 FROM comment_messages WHERE thread_id = ?)`,
          args: [m.thread, siteId, m.thread],
        },
      ]);
      return true;
    }
    case "delete-thread": {
      const rs = await db.execute({
        sql: "SELECT email, name, image FROM comment_messages WHERE thread_id = ? AND site_id = ? ORDER BY at LIMIT 1",
        args: [a.threadId, siteId],
      });
      if (rs.rows[0] && !isAuthor(userOf(rs.rows[0]), user)) return false;
      await db.batch([
        { sql: "DELETE FROM comment_messages WHERE thread_id = ? AND site_id = ?", args: [a.threadId, siteId] },
        { sql: "DELETE FROM comment_threads WHERE id = ? AND site_id = ?", args: [a.threadId, siteId] },
      ]);
      return true;
    }
  }
}
