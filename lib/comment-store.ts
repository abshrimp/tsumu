"use client";

/**
 * エディタのコメントモードと、コメントの一覧（サーバー = /api/comments、D1 が無ければこのブラウザ）
 */

import { create } from "zustand";
import { applyCommentAction, hasCommentIdConflict, MAX_COMMENT_LENGTH, type CommentAction, type CommentPage, type CommentThread } from "./comments";
import { currentSiteId, isLocalSiteDeleted, siteApi, siteKey } from "./site";
import { tr } from "./i18n";
import { userMessage } from "./errors";
import { useEditor } from "./store";
import { storageKey } from "./storage-keys";

const LOCAL_KEY = storageKey("comments-v1");

/** 新しく置くコメントの位置（書き終えるまでの下書き） */
export interface CommentDraft {
  pageId: string;
  nodeId: string | null;
  x: number;
  y: number;
  bp: string;
}

interface CommentsState {
  /** コメントモード（キャンバスをクリックするとコメントを置く） */
  active: boolean;
  threads: CommentThread[];
  focusedThread: CommentThread | null;
  threadUnavailable: boolean;
  cursor: string | null;
  previousCursors: (string | null)[];
  nextCursor: string | null;
  total: number;
  unresolvedCount: number;
  saving: boolean;
  /** 保存先（読み込むまで null） */
  store: "server" | "local" | null;
  loading: boolean;
  error: string | null;
  /** 開いているスレッド */
  openId: string | null;
  draft: CommentDraft | null;
  showResolved: boolean;
  /** キャンバスのピンを隠す（下のデザインを確かめるため） */
  pinsHidden: boolean;
  setActive: (v: boolean) => void;
  open: (id: string | null) => void;
  setDraft: (d: CommentDraft | null) => void;
  setShowResolved: (v: boolean) => void;
  setPinsHidden: (v: boolean) => void;
  load: (page?: { cursor: string | null; previousCursors: (string | null)[] }) => Promise<void>;
  navigate: (direction: "older" | "newer" | "newest") => Promise<void>;
  run: (a: CommentAction) => Promise<boolean>;
}

class LocalSiteDeletedError extends Error {
  constructor() { super(tr("Site not found")); }
}
function assertLocalSiteAvailable(id: string) {
  if (isLocalSiteDeleted(id)) throw new LocalSiteDeletedError();
}
function readLocal(id = currentSiteId()): CommentThread[] {
  assertLocalSiteAvailable(id);
  // 読めなかった一覧を空扱いすると、次の投稿で以前のコメントを上書きしてしまう。
  const v = JSON.parse(window.localStorage.getItem(siteKey(LOCAL_KEY, id)) ?? "[]");
  if (!Array.isArray(v)) throw new Error("Invalid local comment list");
  assertLocalSiteAvailable(id);
  return v;
}

function writeLocal(id: string, threads: CommentThread[]) {
  // 待機中や別タブでの削除を、保存の直前・直後にも確認する。
  const raw = JSON.stringify(threads);
  assertLocalSiteAvailable(id);
  window.localStorage.setItem(siteKey(LOCAL_KEY, id), raw);
  try {
    assertLocalSiteAvailable(id);
  } catch (error) {
    if (error instanceof LocalSiteDeletedError) {
      try { window.localStorage.removeItem(siteKey(LOCAL_KEY, id)); } catch { /* 削除記録により表示・再保存は防ぐ。 */ }
    }
    // 保存後でも削除と重なった場合は失敗を返し、投稿・返信・編集の入力を残す。
    throw error;
  }
}

/** スレッド・コメントのID */
export function commentId(): string {
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** Accept only the complete current API response; never infer totals from a partial page. */
function isCommentPage(value: unknown): value is CommentPage {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const data = value as Partial<CommentPage>;
  return Array.isArray(data.threads) &&
    (data.nextCursor === null || typeof data.nextCursor === "string") &&
    Number.isSafeInteger(data.total) && Number(data.total) >= 0 &&
    Number.isSafeInteger(data.unresolvedCount) && Number(data.unresolvedCount) >= 0 &&
    (data.focusedThread === null ||
      (typeof data.focusedThread === "object" &&
       !!data.focusedThread && typeof data.focusedThread.id === "string" &&
       Array.isArray(data.focusedThread.messages)));
}
function serverSnapshot(data: CommentPage) {
  return { store: "server" as const, threads: data.threads, error: null,
    nextCursor: data.nextCursor, total: data.total, unresolvedCount: data.unresolvedCount };
}
function focusOf(state: Pick<CommentsState, "threads" | "focusedThread" | "openId">) {
  return state.focusedThread?.id === state.openId ? state.focusedThread : state.threads.find(t => t.id === state.openId) ?? null;
}
function focusSnapshot(data: Pick<CommentPage, "threads" | "focusedThread">, id: string | null, previous: CommentThread | null) {
  if (!id) return { focusedThread: null, threadUnavailable: false };
  const found = data.focusedThread?.id === id ? data.focusedThread : data.threads.find(t => t.id === id);
  if (found) return { focusedThread: found, threadUnavailable: false };
  // 閲覧中のスレッドが削除されても、入力をコピーできるよう詳細だけを閉じるまで残す。
  const focusedThread = previous?.id === id ? previous : null;
  return { focusedThread, threadUnavailable: !!focusedThread };
}
function localSnapshot(threads: CommentThread[], state: CommentsState) {
  return { store: "local" as const, threads, error: null, cursor: null, previousCursors: [], nextCursor: null,
    total: threads.length, unresolvedCount: threads.filter(t => !t.resolvedAt).length,
    ...focusSnapshot({ threads, focusedThread: threads.find(t => t.id === state.openId) ?? null }, state.openId, focusOf(state)) };
}

// POST は返却された一覧をそのまま反映するため、同じブラウザの操作は順に確定する。
// 読み込みは待たせず、より新しい読み込みや保存が始まったら古い応答を捨てる。
let readRequest = 0;
let pageRequest: number | null = null;
let pendingWrites = 0;
let writeQueue: Promise<void> = Promise.resolve();

export const useComments = create<CommentsState>((set, get) => ({
  active: false,
  threads: [],
  focusedThread: null,
  threadUnavailable: false,
  cursor: null,
  previousCursors: [],
  nextCursor: null,
  total: 0,
  unresolvedCount: 0,
  saving: false,
  store: null,
  loading: false,
  error: null,
  openId: null,
  draft: null,
  showResolved: false,
  pinsHidden: false,
  setActive: (v) => {
    set({ active: v, ...(v ? {} : { openId: null, draft: null, focusedThread: null, threadUnavailable: false }) });
    if (v) void get().load();
  },
  open: (id) => {
    const state = get();
    set({ openId: id, draft: null, threadUnavailable: !!id && state.threadUnavailable && state.focusedThread?.id === id, focusedThread: id ? state.threads.find(t => t.id === id) ?? (state.focusedThread?.id === id ? state.focusedThread : null) : null });
    // 次のポーリングは、この一覧ページから外れた詳細も独立して更新する。
  },
  setDraft: (d) => set({ draft: d, openId: null, focusedThread: null, threadUnavailable: false }),
  setShowResolved: (v) => set({ showResolved: v }),
  setPinsHidden: (v) => set({ pinsHidden: v }),
  navigate: async (direction) => {
    if (pendingWrites) return;
    const state = get();
    if (direction === "older" && state.nextCursor) await state.load({ cursor: state.nextCursor, previousCursors: [...state.previousCursors, state.cursor] });
    else if (direction === "newer" && state.previousCursors.length) await state.load({ cursor: state.previousCursors.at(-1)!, previousCursors: state.previousCursors.slice(0, -1) });
    else if (direction === "newest") await state.load({ cursor: null, previousCursors: [] });
  },
  load: async (page) => {
    // 背景の定期更新で、ユーザーが要求した一覧移動を取り消さない。
    if (pendingWrites || (!page && pageRequest !== null)) return;
    const request = ++readRequest;
    if (page) pageRequest = request;
    const { openId } = get();
    const cursor = page ? page.cursor : get().cursor;
    const previousCursors = page ? page.previousCursors : get().previousCursors;
    set({ loading: true });
    try {
      if (get().store === "local") {
        set(localSnapshot(readLocal(), get()));
        return;
      }
      const res = await fetch(siteApi("/api/comments", { ...(cursor ? { before: cursor } : {}), ...(openId ? { focus: openId } : {}) }));
      if (request !== readRequest) return;
      if (res.status === 503) {
        set(localSnapshot(readLocal(), get()));
        return;
      }
      const data = await res.json().catch(() => null);
      if (request !== readRequest) return;
      if (!res.ok || !isCommentPage(data)) throw new Error(data?.error ?? tr("Couldn't load"));
      const state = get();
      set({ ...serverSnapshot(data), cursor, previousCursors,
        ...(state.openId === openId ? focusSnapshot(data, openId, focusOf(state)) : {}) });
    } catch (e) {
      if (request === readRequest) set({ ...(e instanceof LocalSiteDeletedError ? localSnapshot([], get()) : {}),
        error: userMessage(e, tr("Couldn't load comments")) });
    } finally {
      if (pageRequest === request) pageRequest = null;
      if (request === readRequest) set({ loading: false });
    }
  },
  run: (a) => {
    // ローカル保存でもサーバーと同じ上限を守り、失敗時は入力・保存済み一覧を残す。
    if ("body" in a && a.body.trim().length > MAX_COMMENT_LENGTH) {
      set({ error: tr("Comments must be {max} characters or fewer.", { max: MAX_COMMENT_LENGTH }) });
      return Promise.resolve(false);
    }
    ++readRequest;
    pageRequest = null;
    ++pendingWrites;
    set({ loading: false, saving: true });
    const result = writeQueue.then(async () => {
      const local = () => {
        const id = currentSiteId();
        const existing = readLocal(id);
        if (a.action === "reply" && !existing.some(t => t.id === a.threadId)) {
          set(localSnapshot(existing, get()));
          throw new Error(tr("The discussion you are replying to has been deleted."));
        }
        if (a.action === "edit" && !existing.some(t => t.messages.some(m => m.id === a.messageId))) {
          // 古い表示は入力のコピー用に残し、削除された本文への編集を成功としない。
          throw new Error(tr("The comment you are editing has been deleted."));
        }
        if (hasCommentIdConflict(existing, a, null)) {
          throw new Error(tr("This comment ID is already in use. Please send again."));
        }
        const next = applyCommentAction(existing, a, null);
        writeLocal(id, next);
        set(localSnapshot(next, get()));
        return true;
      };
      try {
        if (get().store === "local") return local();
        const { cursor, openId } = get();
        const res = await fetch(siteApi("/api/comments", { ...(cursor ? { before: cursor } : {}), ...(openId ? { focus: openId } : {}) }), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(a),
        });
        // 初回の一覧より先に投稿した場合も、保存先が無ければ同じブラウザ保存へ切り替える。
        if (res.status === 503) return local();
        const data = await res.json().catch(() => null);
        if (res.status === 404 && data?.code === "comment_thread_missing" && a.action === "reply") {
          const state = get();
          // 詳細キャッシュは件数より古い場合があるため、同じ一覧にある行だけを差し引く。
          const removed = state.threads.find(t => t.id === a.threadId);
          // 削除確定の項目を一覧・ピンからも除き、次の定期更新が失敗しても再操作させない。
          set({ threads: state.threads.filter(t => t.id !== a.threadId),
            total: Math.max(0, state.total - (removed ? 1 : 0)),
            unresolvedCount: Math.max(0, state.unresolvedCount - (removed && !removed.resolvedAt ? 1 : 0)),
            ...(state.openId === a.threadId ? { focusedThread: focusOf(state), threadUnavailable: true } : {}),
          });
        }
        if (!res.ok || !isCommentPage(data)) throw new Error(data?.error ?? tr("Couldn't save"));
        const state = get();
        set({ ...serverSnapshot(data),
          ...(a.action === "create" ? { cursor: null, previousCursors: [] } : {}),
          ...(state.openId === openId ? focusSnapshot(data, a.action === "create" ? a.id : openId, focusOf(state)) : {}),
        });
        return true;
      } catch (e) {
        set({ ...(e instanceof LocalSiteDeletedError ? localSnapshot([], get()) : {}),
          error: userMessage(e, tr("Couldn't save the comment")) });
        return false;
      } finally {
        --pendingWrites;
        set({ saving: pendingWrites > 0 });
      }
    });
    writeQueue = result.then(() => undefined, () => undefined);
    return result;
  },
}));

/** 投稿中に別のスレッド・下書きへ移った場合、その選択を上書きしない。 */
export function openPostedComment(draft: CommentDraft, id: string) {
  const state = useComments.getState();
  if (state.active && state.draft === draft) state.open(id);
}

/** 削除の完了で、その間に選んだ別のスレッドを閉じない。 */
export function closeCommentIfOpen(id: string) {
  const state = useComments.getState();
  if (state.openId === id) state.open(null);
}

/** コメントモードを切り替える（始めるときはデザイン画面にして選択を外し、右パネルに一覧を出す） */
export function toggleCommentMode(on?: boolean) {
  const c = useComments.getState();
  const next = on ?? !c.active;
  if (next) {
    const s = useEditor.getState();
    if (s.mode !== "design") s.setMode("design");
    s.setEditingText(null);
    s.select(null);
    window.dispatchEvent(new CustomEvent("tsumu-open-panel", { detail: "r" }));
  }
  c.setActive(next);
}
