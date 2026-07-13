"use client";

/**
 * エディタのコメントモードと、コメントの一覧（サーバー = /api/comments、D1 が無ければこのブラウザ）
 */

import { create } from "zustand";
import { applyCommentAction, type CommentAction, type CommentPage, type CommentThread } from "./comments";
import { siteApi, siteKey } from "./site";
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
  setActive: (v: boolean) => void;
  open: (id: string | null) => void;
  setDraft: (d: CommentDraft | null) => void;
  setShowResolved: (v: boolean) => void;
  load: (page?: { cursor: string | null; previousCursors: (string | null)[] }) => Promise<void>;
  navigate: (direction: "older" | "newer" | "newest") => Promise<void>;
  run: (a: CommentAction) => Promise<boolean>;
}

function readLocal(): CommentThread[] {
  // 読めなかった一覧を空扱いすると、次の投稿で以前のコメントを上書きしてしまう。
  const v = JSON.parse(window.localStorage.getItem(siteKey(LOCAL_KEY)) ?? "[]");
  if (!Array.isArray(v)) throw new Error("Invalid local comment list");
  return v;
}

function writeLocal(threads: CommentThread[]) {
  // 保存できたときだけ成功を返し、失敗時は投稿・返信・編集の入力を残す。
  window.localStorage.setItem(siteKey(LOCAL_KEY), JSON.stringify(threads));
}

/** スレッド・コメントのID */
export function commentId(): string {
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

// 古いサーバー応答（threads のみ）も扱い、ローリング更新中に一覧を失わない。
function serverSnapshot(data: Partial<CommentPage> & { threads: CommentThread[] }) {
  return { store: "server" as const, threads: data.threads, error: null,
    nextCursor: data.nextCursor ?? null,
    total: data.total ?? data.threads.length,
    unresolvedCount: data.unresolvedCount ?? data.threads.filter(t => !t.resolvedAt).length };
}
function focusedFrom(data: Partial<CommentPage> & { threads: CommentThread[] }, id: string | null, previous: CommentThread | null) {
  if (!id) return null;
  const found = data.focusedThread?.id === id ? data.focusedThread : data.threads.find(t => t.id === id);
  if (found) return found;
  // focusedThread を返さない旧サーバーでは、一覧に無いことだけで削除済みと判断しない。
  return !("focusedThread" in data) && previous?.id === id ? previous : null;
}
function localSnapshot(threads: CommentThread[], openId: string | null) {
  return { store: "local" as const, threads, error: null, cursor: null, previousCursors: [], nextCursor: null,
    total: threads.length, unresolvedCount: threads.filter(t => !t.resolvedAt).length,
    focusedThread: threads.find(t => t.id === openId) ?? null };
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
  setActive: (v) => {
    set({ active: v, ...(v ? {} : { openId: null, draft: null }) });
    if (v) void get().load();
  },
  open: (id) => {
    const state = get();
    set({ openId: id, draft: null, focusedThread: id ? state.threads.find(t => t.id === id) ?? (state.focusedThread?.id === id ? state.focusedThread : null) : null });
    // 次のポーリングは、この一覧ページから外れた詳細も独立して更新する。
  },
  setDraft: (d) => set({ draft: d, openId: null, focusedThread: null }),
  setShowResolved: (v) => set({ showResolved: v }),
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
        set(localSnapshot(readLocal(), get().openId));
        return;
      }
      const res = await fetch(siteApi("/api/comments", { ...(cursor ? { before: cursor } : {}), ...(openId ? { focus: openId } : {}) }));
      if (request !== readRequest) return;
      if (res.status === 503) {
        set(localSnapshot(readLocal(), get().openId));
        return;
      }
      const data = await res.json().catch(() => null);
      if (request !== readRequest) return;
      if (!res.ok || !Array.isArray(data?.threads)) throw new Error(data?.error ?? tr("読み込めませんでした"));
      const state = get();
      set({ ...serverSnapshot(data), cursor, previousCursors,
        focusedThread: state.openId === openId ? focusedFrom(data, openId, state.focusedThread) : state.focusedThread });
    } catch (e) {
      if (request === readRequest) set({ error: userMessage(e, tr("コメントを読み込めませんでした")) });
    } finally {
      if (pageRequest === request) pageRequest = null;
      if (request === readRequest) set({ loading: false });
    }
  },
  run: (a) => {
    ++readRequest;
    pageRequest = null;
    ++pendingWrites;
    set({ loading: false, saving: true });
    const result = writeQueue.then(async () => {
      const local = () => {
        const next = applyCommentAction(readLocal(), a, null);
        writeLocal(next);
        set(localSnapshot(next, get().openId));
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
        if (!res.ok || !Array.isArray(data?.threads)) throw new Error(data?.error ?? tr("保存できませんでした"));
        const state = get();
        set({ ...serverSnapshot(data),
          ...(a.action === "create" ? { cursor: null, previousCursors: [] } : {}),
          focusedThread: state.openId === openId
            ? focusedFrom(data, a.action === "create" ? a.id : openId, a.action === "delete-thread" && a.threadId === openId ? null : state.focusedThread)
            : state.focusedThread,
        });
        return true;
      } catch (e) {
        set({ error: userMessage(e, tr("コメントを保存できませんでした")) });
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
