"use client";

/**
 * エディタのコメントモードと、コメントの一覧（サーバー = /api/comments、D1 が無ければこのブラウザ）
 */

import { create } from "zustand";
import { applyCommentAction, type CommentAction, type CommentThread } from "./comments";
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
  load: () => Promise<void>;
  run: (a: CommentAction) => Promise<boolean>;
}

function readLocal(): CommentThread[] {
  try {
    const v = JSON.parse(window.localStorage.getItem(siteKey(LOCAL_KEY)) ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function writeLocal(threads: CommentThread[]) {
  try {
    window.localStorage.setItem(siteKey(LOCAL_KEY), JSON.stringify(threads));
  } catch {
    // 保存できなくても、開いている間は見える
  }
}

/** スレッド・コメントのID */
export function commentId(): string {
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

// POST は返却された一覧をそのまま反映するため、同じブラウザの操作は順に確定する。
// 読み込みは待たせず、より新しい読み込みや保存が始まったら古い応答を捨てる。
let readRequest = 0;
let pendingWrites = 0;
let writeQueue: Promise<void> = Promise.resolve();

export const useComments = create<CommentsState>((set, get) => ({
  active: false,
  threads: [],
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
  open: (id) => set({ openId: id, draft: null }),
  setDraft: (d) => set({ draft: d, openId: null }),
  setShowResolved: (v) => set({ showResolved: v }),
  load: async () => {
    if (pendingWrites) return;
    const request = ++readRequest;
    if (get().store === "local") {
      set({ threads: readLocal(), loading: false });
      return;
    }
    set({ loading: true });
    try {
      const res = await fetch(siteApi("/api/comments"));
      if (request !== readRequest) return;
      if (res.status === 503) {
        set({ store: "local", threads: readLocal(), error: null });
        return;
      }
      const data = await res.json().catch(() => null);
      if (request !== readRequest) return;
      if (!res.ok || !Array.isArray(data?.threads)) throw new Error(data?.error ?? tr("読み込めませんでした"));
      set({ store: "server", threads: data.threads, error: null });
    } catch (e) {
      if (request === readRequest) set({ error: userMessage(e, tr("コメントを読み込めませんでした")) });
    } finally {
      if (request === readRequest) set({ loading: false });
    }
  },
  run: (a) => {
    ++readRequest;
    ++pendingWrites;
    set({ loading: false });
    const result = writeQueue.then(async () => {
      const local = () => {
        const next = applyCommentAction(readLocal(), a, null);
        writeLocal(next);
        set({ store: "local", threads: next, error: null });
        return true;
      };
      try {
        if (get().store === "local") return local();
        const res = await fetch(siteApi("/api/comments"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(a),
        });
        // 初回の一覧より先に投稿した場合も、保存先が無ければ同じブラウザ保存へ切り替える。
        if (res.status === 503) return local();
        const data = await res.json().catch(() => null);
        if (!res.ok || !Array.isArray(data?.threads)) throw new Error(data?.error ?? tr("保存できませんでした"));
        set({ store: "server", threads: data.threads, error: null });
        return true;
      } catch (e) {
        set({ error: userMessage(e, tr("コメントを保存できませんでした")) });
        return false;
      } finally {
        --pendingWrites;
      }
    });
    writeQueue = result.then(() => undefined, () => undefined);
    return result;
  },
}));

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
