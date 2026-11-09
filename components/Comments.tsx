"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { ArrowLeft, Check, ChevronLeft, ChevronRight, ChevronsLeft, CornerDownLeft, Eye, EyeOff, MessageSquare, MoreHorizontal, Pencil, RotateCcw, Trash2, X } from "lucide-react";
import { useEditor } from "../lib/store";
import { commentId, openPostedComment, closeCommentIfOpen, useComments, type CommentDraft } from "../lib/comment-store";
import { isAuthor, MAX_COMMENT_LENGTH, type CommentMessage, type CommentThread } from "../lib/comments";
import { useServerStatus } from "../lib/status";
import { BP_INFO } from "../lib/style";
import { commentTargetResolver, isDeletedCommentTarget, type CommentTarget } from "../lib/comment-targets";
import { getLang, tr } from "../lib/i18n";
import { relativeTime } from "../lib/time";
import { showConfirm } from "../lib/dialog";
import UserAvatar, { userLabel } from "./UserAvatar";
import { ContextMenu } from "./NodeContextMenu";

/** コメントを付けた要素（無ければページ全体）の、キャンバス上の枠 */
function anchorOf(frame: HTMLElement, nodeId: string | null): HTMLElement | null {
  if (!nodeId) return frame.querySelector<HTMLElement>(".cv-root");
  const el = frame.querySelector<HTMLElement>(`[data-node="${CSS.escape(nodeId)}"]`);
  // 非表示の画面幅などで大きさが無ければ、置く場所が無いものとする
  return el && (el.offsetWidth || el.offsetHeight) ? el : null;
}

/** 開いているページの、表示するスレッド（作った順。番号はこの順） */
export function usePageThreads(): CommentThread[] {
  const threads = useComments((s) => s.threads);
  const showResolved = useComments((s) => s.showResolved);
  const pageId = useEditor((s) => s.activePageId);
  const doc = useEditor((s) => s.doc);
  const bp = useEditor((s) => s.breakpoint);
  const targetOf = useMemo(() => commentTargetResolver(doc, bp), [doc, bp]);
  return useMemo(
    () =>
      threads
        .filter((t) => targetOf(t).pageId === pageId && (showResolved || !t.resolvedAt))
        .sort((a, b) => a.createdAt - b.createdAt),
    [threads, showResolved, pageId, targetOf]
  );
}

/* ---------- 書き込み欄 ---------- */

/** 送信していない本文（スレッドごと）。一覧へ戻ったり別のスレッドを開いたりしても失わないようにする */
const unsentBodies = new Map<string, { body: string }>();

function Composer({
  placeholder,
  initial = "",
  submitLabel,
  autoFocus,
  disabled = false,
  draftKey,
  onSubmit,
  onCancel,
}: {
  placeholder: string;
  initial?: string;
  /** 指定すると、送信前の本文をこのキーで保持する */
  draftKey?: string;
  submitLabel: string;
  autoFocus?: boolean;
  disabled?: boolean;
  onSubmit: (body: string) => Promise<boolean> | boolean;
  onCancel?: () => void;
}) {
  const [body, setBodyState] = useState((draftKey && unsentBodies.get(draftKey)?.body) || initial);
  const setBody = (next: string) => {
    setBodyState(next);
    if (!draftKey) return;
    if (next) unsentBodies.set(draftKey, { body: next });
    else unsentBodies.delete(draftKey);
  };
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const tooLong = body.trim().length > MAX_COMMENT_LENGTH;
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);
  const submit = async () => {
    const text = body.trim();
    if (disabled || !text || text.length > MAX_COMMENT_LENGTH || submitting.current) return;
    const draft = draftKey ? unsentBodies.get(draftKey) : undefined;
    submitting.current = true;
    setBusy(true);
    try {
      const ok = await onSubmit(text);
      if (ok) {
        setBodyState("");
        // A remounted composer may already own a newer draft for this thread.
        if (draftKey && unsentBodies.get(draftKey) === draft) unsentBodies.delete(draftKey);
      }
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };
  return (
    <div className="cm-compose">
      <textarea
        ref={ref}
        value={body}
        // 保存中の本文はコピーできるが変更させず、成功時に新しい入力を消さない。
        readOnly={busy}
        rows={Math.min(6, Math.max(2, body.split("\n").length))}
        placeholder={placeholder}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          // 変換の確定・取り消しを、送信や下書きのキャンセルとして扱わない。
          if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void submit();
          } else if (e.key === "Escape") {
            e.stopPropagation();
            onCancel?.();
          }
        }}
      />
      {tooLong && <p className="hint is-error" role="alert">{tr("コメントは{max}文字以内で入力してください", { max: MAX_COMMENT_LENGTH })}</p>}
      <div className="cm-compose-acts">
        {onCancel && (
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => { if (draftKey) unsentBodies.delete(draftKey); onCancel(); }}>
            {tr("キャンセル")}
          </button>
        )}
        <button
          type="button"
          className="btn btn-sm btn-primary"
          disabled={disabled || !body.trim() || busy || tooLong}
          data-tip={tr("送信（⌘Enter）")}
          onClick={() => void submit()}
        >
          <CornerDownLeft size={12} />
          {submitLabel}
        </button>
      </div>
    </div>
  );
}

/* ---------- スレッド ---------- */

/** Confirmation belongs to the mounted discussion, not a later panel or edit. */
function useCommentDeletion(scope: string, disabled: boolean) {
  const pending = useRef<object | null>(null);
  useLayoutEffect(() => {
    pending.current = null;
    return () => { pending.current = null; };
  }, [scope, disabled]);
  return () => {
    if (disabled || pending.current) return null;
    const token = {};
    pending.current = token;
    return {
      current: () => pending.current === token,
      finish: () => { if (pending.current === token) pending.current = null; },
    };
  };
}

function Message({ m, thread, unavailable }: { m: CommentMessage; thread: CommentThread; unavailable?: boolean }) {
  const user = useServerStatus()?.user ?? null;
  const run = useComments((s) => s.run);
  const [editing, setEditing] = useState(false);
  const editSession = useRef(0);
  /** 「…」メニューの位置（スクロールする一覧に隠れないよう、画面に固定して出す） */
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const mine = isAuthor(m.author, user);
  const first = thread.messages[0]?.id === m.id;
  const beginDeletion = useCommentDeletion(`${thread.id}:${m.id}:${editing}`, !!unavailable || !mine);
  return (
    <div className="cm-msg">
      <div className="cm-msg-head">
        <UserAvatar user={m.author} size={22} />
        <strong>{userLabel(m.author, tr("ゲスト"))}</strong>
        <time title={new Date(m.at).toLocaleString(getLang())}>
          {relativeTime(m.at)}
          {m.editedAt ? tr("（編集済み）") : ""}
        </time>
        {mine && !editing && !unavailable && (
          <span className="cm-msg-menu">
            <button
              type="button"
              className="icon-btn sm"
              aria-label={tr("コメントの操作")}
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                setMenu(menu ? null : { x: r.right - 160, y: r.bottom + 4 });
              }}
            >
              <MoreHorizontal size={13} />
            </button>
            {menu && (
              <ContextMenu
                x={menu.x}
                y={menu.y}
                onClose={() => setMenu(null)}
                items={[
                  {
                    key: "edit",
                    label: tr("コメントを編集"),
                    icon: <Pencil size={14} />,
                    onClick: () => {
                      setMenu(null);
                      editSession.current++;
                      setEditing(true);
                    },
                  },
                  {
                    key: "delete",
                    label: tr("削除"),
                    icon: <Trash2 size={14} />,
                    danger: true,
                    onClick: async () => {
                      const operation = beginDeletion();
                      if (!operation) return;
                      setMenu(null);
                      try {
                        const all = first && thread.messages.length === 1;
                        if (
                          await showConfirm(all ? tr("このスレッドを削除します。") : tr("このコメントを削除します。"), {
                            title: tr("コメントを削除しますか？"),
                            okLabel: tr("削除"),
                            danger: true,
                          })
                        ) {
                          if (!operation.current()) return;
                          const ok = await run({ action: "delete-message", messageId: m.id });
                          if (operation.current() && ok && useComments.getState().threadUnavailable) closeCommentIfOpen(thread.id);
                        }
                      } finally { operation.finish(); }
                    },
                  },
                ]}
              />
            )}
          </span>
        )}
      </div>
      {editing ? (
        <Composer
          initial={m.body}
          disabled={unavailable}
          placeholder={tr("コメント")}
          submitLabel={tr("保存")}
          autoFocus
          onCancel={() => { editSession.current++; setEditing(false); }}
          onSubmit={async (body) => {
            const session = editSession.current;
            const ok = await run({ action: "edit", messageId: m.id, body });
            if (ok && editSession.current === session) setEditing(false);
            return ok;
          }}
        />
      ) : (
        <p className="cm-msg-body">{m.body}</p>
      )}
    </div>
  );
}

function ThreadView({ thread, onClose, unavailable, place, notices }: { thread: CommentThread; onClose: () => void; unavailable: boolean; place: string; notices: ReactNode }) {
  const run = useComments((s) => s.run);
  const user = useServerStatus()?.user ?? null;
  const owner = thread.messages[0] ? isAuthor(thread.messages[0].author, user) : true;
  const beginDeletion = useCommentDeletion(thread.id, unavailable || !owner);
  return (
    <>
      <div className="cm-detail-head">
      <div className="cm-pop-head">
        <BackButton onClick={onClose} />
        <span className="cm-pop-title" title={place}>{place}</span>
        {thread.resolvedAt && <span className="cm-badge">{tr("解決済み")}</span>}
        <button
          type="button"
          className={`icon-btn sm${thread.resolvedAt ? " is-on" : ""}`}
          data-tip={thread.resolvedAt ? tr("未解決に戻す") : tr("解決済みにする")}
          aria-label={thread.resolvedAt ? tr("未解決に戻す") : tr("解決済みにする")}
          disabled={unavailable}
          onClick={() => void run({ action: "resolve", threadId: thread.id, resolved: !thread.resolvedAt })}
        >
          {thread.resolvedAt ? <RotateCcw size={13} /> : <Check size={14} />}
        </button>
        {owner && (
          <button
            type="button"
            className="icon-btn sm"
            data-tip={tr("スレッドを削除")}
            aria-label={tr("スレッドを削除")}
            disabled={unavailable}
            onClick={async () => {
              const operation = beginDeletion();
              if (!operation) return;
              try {
                if (
                  await showConfirm(tr("返信も含めて、このスレッドを削除します。"), {
                    title: tr("スレッドを削除しますか？"),
                    okLabel: tr("削除"),
                    danger: true,
                  })
                ) {
                  if (!operation.current()) return;
                  if (await run({ action: "delete-thread", threadId: thread.id }) && operation.current()) onClose();
                }
              } finally { operation.finish(); }
            }}
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>
      {thread.resolvedAt && thread.resolvedBy && (
        <p className="cm-resolved">
          {tr("{name}が解決済みにしました（{time}）", {
            name: userLabel(thread.resolvedBy, tr("ゲスト")),
            time: relativeTime(thread.resolvedAt),
          })}
        </p>
      )}
      </div>
      {notices}
      <div className="cm-msgs">
        {thread.messages.map((m) => (
          <Message key={m.id} m={m} thread={thread} unavailable={unavailable} />
        ))}
      </div>
      <Composer
        placeholder={tr("返信")}
        disabled={unavailable}
        submitLabel={tr("返信")}
        autoFocus
        draftKey={`reply:${thread.id}`}
        onSubmit={(body) => run({ action: "reply", threadId: thread.id, id: commentId(), body })}
      />
    </>
  );
}

/* ---------- キャンバス上のピン ---------- */

interface PinPos {
  id: string;
  left: number;
  top: number;
}

/**
 * コメントモードでキャンバスに重ねる層。クリックした要素にコメントを置き、
 * 付いているコメントをピンで見せる（位置は要素の中の割合なので、幅を変えてもついてくる）
 */
export function CommentLayer({
  frameRef,
  innerRef,
}: {
  frameRef: RefObject<HTMLDivElement | null>;
  innerRef: RefObject<HTMLDivElement | null>;
}) {
  const active = useComments((s) => s.active);
  const mode = useEditor((s) => s.mode);
  const pageId = useEditor((s) => s.activePageId);
  const breakpoint = useEditor((s) => s.breakpoint);
  const openId = useComments((s) => s.openId);
  const draft = useComments((s) => s.draft);
  const pinsHidden = useComments((s) => s.pinsHidden);
  /** ⌥（Alt）を押している間だけピンを隠す */
  const [peeking, setPeeking] = useState(false);
  const threads = usePageThreads();
  const { open, setDraft, load } = useComments.getState();
  const [frameBox, setFrameBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const [pins, setPins] = useState<PinPos[]>([]);
  const [draftPos, setDraftPos] = useState<{ left: number; top: number } | null>(null);
  const [hover, setHover] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const on = active && mode === "design";

  // ほかの人のコメントも見えるよう、開いている間はときどき読み込み直す
  useEffect(() => {
    if (!on) return;
    const id = setInterval(() => {
      if (!document.hidden) void load();
    }, 15000);
    return () => clearInterval(id);
  }, [on, load]);

  // Esc: 書きかけ・開いているスレッドを閉じ、何も無ければコメントモードを終える
  useEffect(() => {
    if (!on) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.isComposing || e.keyCode === 229 || document.querySelector(".modal-backdrop")) return;
      const s = useComments.getState();
      if (s.draft || s.openId) s.open(null);
      else s.setActive(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [on]);

  useEffect(() => {
    if (!on) return;
    const onKey = (e: KeyboardEvent) => {
      // Windows では Alt を単独で離すとブラウザのメニューに移るので止める
      if (e.type === "keyup" && e.key === "Alt") e.preventDefault();
      setPeeking(e.altKey && !e.metaKey && !e.ctrlKey);
    };
    const reset = () => setPeeking(false);
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    window.addEventListener("blur", reset);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
      window.removeEventListener("blur", reset);
      setPeeking(false);
    };
  }, [on]);

  // ピンの位置（スクロール・拡大・幅の変更についていくため、毎フレーム測る）
  useEffect(() => {
    if (!on) return;
    let raf = 0;
    const tick = () => {
      const frame = frameRef.current;
      const inner = innerRef.current;
      if (frame && inner) {
        const ir = inner.getBoundingClientRect();
        const fr = frame.getBoundingClientRect();
        const box = { left: fr.left - ir.left, top: fr.top - ir.top, width: fr.width, height: fr.height };
        setFrameBox((p) =>
          p && Math.abs(p.left - box.left) < 0.5 && Math.abs(p.top - box.top) < 0.5 && Math.abs(p.width - box.width) < 0.5 && Math.abs(p.height - box.height) < 0.5
            ? p
            : box
        );
        const place = (nodeId: string | null, x: number, y: number) => {
          const el = anchorOf(frame, nodeId);
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { left: r.left - ir.left + x * r.width, top: r.top - ir.top + y * r.height };
        };
        const next: PinPos[] = [];
        for (const t of threads) {
          const p = place(t.nodeId, t.x, t.y);
          if (p) next.push({ id: t.id, ...p });
        }
        setPins((prev) =>
          prev.length === next.length &&
          prev.every((p, i) => p.id === next[i].id && Math.abs(p.left - next[i].left) < 0.5 && Math.abs(p.top - next[i].top) < 0.5)
            ? prev
            : next
        );
        const d = useComments.getState().draft;
        const dp = d?.pageId === pageId ? place(d.nodeId, d.x, d.y) : null;
        setDraftPos((prev) =>
          prev && dp && Math.abs(prev.left - dp.left) < 0.5 && Math.abs(prev.top - dp.top) < 0.5 ? prev : dp
        );
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [on, threads, pageId, frameRef, innerRef]);

  if (!on || !frameBox) return null;

  /** クリックした場所の要素と、その中の位置 */
  const hitAt = (cx: number, cy: number): { nodeId: string | null; el: HTMLElement } | null => {
    const frame = frameRef.current;
    if (!frame) return null;
    const under = document.elementsFromPoint(cx, cy).find((el) => frame.contains(el));
    const el = (under?.closest("[data-node]") as HTMLElement | null) ?? frame.querySelector<HTMLElement>(".cv-root");
    if (!el) return null;
    return { nodeId: el.getAttribute("data-node"), el };
  };

  return (
    <>
      <div
        className="cm-catcher"
        style={{ left: frameBox.left, top: frameBox.top, width: frameBox.width, height: frameBox.height }}
        onMouseMove={(e) => {
          const hit = hitAt(e.clientX, e.clientY);
          const inner = innerRef.current;
          if (!hit || !inner || !hit.nodeId) {
            setHover(null);
            return;
          }
          const r = hit.el.getBoundingClientRect();
          const ir = inner.getBoundingClientRect();
          setHover({ left: r.left - ir.left, top: r.top - ir.top, width: r.width, height: r.height });
        }}
        onMouseLeave={() => setHover(null)}
        onClick={(e) => {
          e.stopPropagation();
          // 書きかけ・開いているスレッドがあれば、まず閉じる
          const s = useComments.getState();
          if (s.draft || s.openId) {
            s.open(null);
            return;
          }
          const hit = hitAt(e.clientX, e.clientY);
          if (!hit) return;
          const r = hit.el.getBoundingClientRect();
          const clamp = (v: number) => Math.max(0, Math.min(1, v));
          const next: CommentDraft = {
            pageId,
            nodeId: hit.nodeId,
            x: r.width ? clamp((e.clientX - r.left) / r.width) : 0,
            y: r.height ? clamp((e.clientY - r.top) / r.height) : 0,
            bp: breakpoint,
          };
          setDraft(next);
          window.dispatchEvent(new CustomEvent("tsumu-open-panel", { detail: "r" }));
        }}
      />
      {hover && !draft && !openId && (
        <div className="cm-hover" style={{ left: hover.left, top: hover.top, width: hover.width, height: hover.height }} />
      )}
      {!pinsHidden && !peeking && pins.map((p) => {
        const t = threads.find((x) => x.id === p.id);
        if (!t) return null;
        const n = threads.indexOf(t) + 1;
        const author = t.messages[0]?.author;
        return (
          <button
            key={p.id}
            type="button"
            className={`cm-pin${t.id === openId ? " is-open" : ""}${t.resolvedAt ? " is-resolved" : ""}`}
            style={{ left: p.left, top: p.top }}
            aria-label={tr("コメント {n}", { n })}
            onClick={(e) => {
              e.stopPropagation();
              open(t.id === openId ? null : t.id);
              if (t.id !== openId) window.dispatchEvent(new CustomEvent("tsumu-open-panel", { detail: "r" }));
            }}
          >
            {author?.image ? <UserAvatar user={author} size={20} /> : <span>{n}</span>}
            {t.messages.length > 1 && <small>{t.messages.length}</small>}
          </button>
        );
      })}
      {draft && draftPos && !pinsHidden && !peeking && <span className="cm-pin is-draft" style={{ left: draftPos.left, top: draftPos.top }} />}
    </>
  );
}

/* ---------- 右パネルの一覧 ---------- */

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="icon-btn sm" aria-label={tr("一覧に戻る")} data-tip={tr("一覧に戻る（Esc）")} onClick={onClick}>
      <ArrowLeft size={14} />
    </button>
  );
}

export function CommentsPanel() {
  const threads = useComments((s) => s.threads);
  const focusedThread = useComments((s) => s.focusedThread);
  const threadUnavailable = useComments((s) => s.threadUnavailable);
  const cursor = useComments((s) => s.cursor);
  const previousCursors = useComments((s) => s.previousCursors);
  const nextCursor = useComments((s) => s.nextCursor);
  const total = useComments((s) => s.total);
  const saving = useComments((s) => s.saving);
  const navigate = useComments((s) => s.navigate);
  const showResolved = useComments((s) => s.showResolved);
  const setShowResolved = useComments((s) => s.setShowResolved);
  const openId = useComments((s) => s.openId);
  const store = useComments((s) => s.store);
  const error = useComments((s) => s.error);
  const loading = useComments((s) => s.loading);
  const doc = useEditor((s) => s.doc);
  const activePageId = useEditor((s) => s.activePageId);
  const bp = useEditor((s) => s.breakpoint);
  const draft = useComments((s) => s.draft);
  const pinsHidden = useComments((s) => s.pinsHidden);
  const { open, setDraft, run, setPinsHidden } = useComments.getState();
  const [allPages, setAllPages] = useState(false);
  const targetOf = useMemo(() => commentTargetResolver(doc, bp), [doc, bp]);
  // 閲覧中のスレッドはページ・絞り込み・ピン位置から独立させ、共同編集の削除でも入力を保つ。
  const openThread = openId ? (focusedThread?.id === openId ? focusedThread : threads.find(t => t.id === openId)) : undefined;
  useEffect(() => {
    if (openId && !openThread) open(null);
  }, [openId, openThread, open]);
  const partial = !!cursor || !!nextCursor || total > threads.length;
  const visible = threads.filter((t) => showResolved || !t.resolvedAt);
  const shown = visible
    .filter((t) => allPages || targetOf(t).pageId === activePageId)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  // 削除されたページのコメントは「このページ」には出ないので、あることだけ知らせる
  const onDeletedPages = allPages ? 0 : visible.filter((t) => targetOf(t).kind === "deleted-page").length;
  const pageThreads = visible
    .filter((t) => targetOf(t).pageId === activePageId)
    .sort((a, b) => a.createdAt - b.createdAt);

  /** 対象の場所（ページ名と要素名） */
  const placeOf = (t: CommentThread | CommentDraft, withPage: boolean) => {
    const target = targetOf(t);
    const page = doc.pages[target.pageId];
    const node = t.nodeId ? doc.nodes[t.nodeId] : null;
    const where = target.kind === "deleted-page" ? tr("削除されたページ") : t.nodeId ? (node ? node.name : tr("削除された要素")) : tr("ページ全体");
    return withPage && page && target.kind !== "deleted-page" ? `${page.name} · ${where}` : where;
  };

  const jump = (t: CommentThread) => {
    const s = useEditor.getState();
    const pageId = targetOf(t).pageId;
    if (pageId !== s.activePageId && s.doc.pages[pageId]) s.setActivePage(pageId);
    // 付けたときの画面幅で見せる（その幅で非表示の要素もあるため）
    if (BP_INFO[t.bp] && s.breakpoint !== t.bp) s.setBreakpoint(t.bp);
    useComments.getState().open(t.id);
  };

  const detailOpen = !!(draft || openThread);

  return (
    <div className="cm-panel">
      <div className="cm-panel-head">
        <MessageSquare size={14} />
        <strong>{tr("コメント")}</strong>
        <button
          type="button"
          className={`icon-btn sm${pinsHidden ? " is-on" : ""}`}
          aria-label={pinsHidden ? tr("ピンを表示") : tr("ピンを隠す")}
          aria-pressed={pinsHidden}
          data-tip={pinsHidden ? tr("キャンバスにピンを表示") : tr("キャンバスのピンを隠す（⌥を押している間も隠せます）")}
          onClick={() => setPinsHidden(!pinsHidden)}
        >
          {pinsHidden ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
        <button type="button" className="icon-btn sm" aria-label={tr("コメントモードを終える")} data-tip={tr("コメントモードを終える（Esc）")} onClick={() => useComments.getState().setActive(false)}>
          <X size={14} />
        </button>
      </div>
      {error && <p className="hint is-error cm-panel-hint">{error}</p>}
      {detailOpen ? (
        <section className="cm-detail" aria-label={tr("コメントの詳細")}>
          {draft ? (
            <>
              <div className="cm-detail-head">
                <div className="cm-pop-head">
                  <BackButton onClick={() => setDraft(null)} />
                  <span className="cm-pop-title">{tr("新しいコメント")}</span>
                  <span className="cm-pop-sub">{BP_INFO[draft.bp]?.label}</span>
                </div>
                <p className="cm-detail-context">{placeOf(draft, true)}</p>
              </div>
              <TargetNotice target={targetOf(draft)} draft />
              <Composer
                placeholder={tr("コメントを書く")}
                submitLabel={tr("投稿")}
                autoFocus
                draftKey="new"
                onCancel={() => setDraft(null)}
                onSubmit={async (body) => {
                  const id = commentId();
                  const ok = await run({ action: "create", id, ...draft, body });
                  if (ok) openPostedComment(draft, id);
                  return ok;
                }}
              />
            </>
          ) : (
            openThread && (
              <ThreadView
                key={openThread.id}
                thread={openThread}
                unavailable={threadUnavailable}
                place={placeOf(openThread, true)}
                onClose={() => closeCommentIfOpen(openThread.id)}
                notices={
                  <>
                    {threadUnavailable && <p className="cm-target-notice is-alert" role="alert">{tr("このスレッドは削除されています。入力中の文章は閉じるまで残るので、必要ならコピーしてください。")}</p>}
                    <TargetNotice target={targetOf(openThread)} draft={false} />
                  </>
                }
              />
            )
          )}
        </section>
      ) : (
        <>
          <div className="cm-panel-filters">
            <div className="seg seg-full">
              <button type="button" className={allPages ? "" : "is-on"} onClick={() => setAllPages(false)}>
                {tr("このページ")}
              </button>
              <button type="button" className={allPages ? "is-on" : ""} onClick={() => setAllPages(true)}>
                {tr("すべてのページ")}
              </button>
            </div>
            <label className="lbl cm-panel-check">
              <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} />
              {tr("解決済みも表示")}
            </label>
          </div>
          <div className="cm-list">
            {onDeletedPages > 0 && (
              <button type="button" className="cm-list-notice" onClick={() => setAllPages(true)}>
                {tr("削除されたページのコメントが{n}件あります。「すべてのページ」で表示できます。", { n: onDeletedPages })}
              </button>
            )}
            {shown.length === 0 ? (
              <div className="cm-empty">
                <p>{loading ? tr("読み込み中…") : partial ? tr("この一覧に条件に合うコメントはありません。ほかの一覧も確認できます。") : tr("コメントはありません")}</p>
                {!loading && !partial && <p className="hint">{tr("キャンバスをクリックすると、その場所の要素にコメントを付けられます。")}</p>}
              </div>
            ) : (
              shown.map((t) => {
                const first = t.messages[0];
                const last = t.messages[t.messages.length - 1];
                const n = pageThreads.indexOf(t) + 1;
                const target = targetOf(t);
                const replies = t.messages.length - 1;
                return (
                  <button
                    key={t.id}
                    type="button"
                    className={`cm-item${t.resolvedAt ? " is-resolved" : ""}`}
                    onClick={() => jump(t)}
                  >
                    <span className="cm-item-head">
                      {n > 0 && <span className="cm-item-num">{n}</span>}
                      <UserAvatar user={first.author} size={20} />
                      <strong>{userLabel(first.author, tr("ゲスト"))}</strong>
                      <time>{relativeTime(last.at)}</time>
                    </span>
                    <span className="cm-item-body">{first.body}</span>
                    <span className="cm-item-meta">
                      <span className={isDeletedCommentTarget(target) ? "cm-item-place is-deleted" : "cm-item-place"}>{placeOf(t, allPages)}</span>
                      {target.hidden && <span>{tr("この画面幅では非表示")}</span>}
                      {replies === 1 ? <span>{tr("返信1件")}</span> : replies > 1 ? <span>{tr("返信{n}件", { n: replies })}</span> : null}
                      {t.resolvedAt && <span>{tr("解決済み")}</span>}
                    </span>
                  </button>
                );
              })
            )}
          </div>
          {partial && (
            <div className="cm-pagination" title={tr("絞り込みとピンは、表示中の一覧の範囲に適用されます。")}>
              <span className="hint">{tr("全{total}件中{loaded}件", { total, loaded: threads.length })}</span>
              <span className="cm-pagination-actions">
                {cursor && (
                  <button type="button" className="icon-btn sm" aria-label={tr("最新の一覧")} data-tip={tr("最新の一覧")} disabled={loading || saving} onClick={() => void navigate("newest")}>
                    <ChevronsLeft size={14} />
                  </button>
                )}
                <button type="button" className="icon-btn sm" aria-label={tr("新しい一覧")} data-tip={tr("新しい一覧")} disabled={loading || saving || !previousCursors.length} onClick={() => void navigate("newer")}>
                  <ChevronLeft size={14} />
                </button>
                <button type="button" className="icon-btn sm" aria-label={tr("古い一覧")} data-tip={tr("古い一覧")} disabled={loading || saving || !nextCursor} onClick={() => void navigate("older")}>
                  <ChevronRight size={14} />
                </button>
              </span>
            </div>
          )}
          {store === "local" && (
            <p className="hint cm-panel-foot">{tr("サーバーの保存先が無いため、コメントはこのブラウザにだけ保存されます。")}</p>
          )}
        </>
      )}
    </div>
  );
}

function TargetNotice({ target, draft }: { target: CommentTarget; draft: boolean }) {
  if (draft && isDeletedCommentTarget(target)) return <p className="cm-target-notice" role="status">{target.kind === "deleted-page"
    ? tr("対象のページは削除されています。入力中の内容は保持されています。")
    : tr("対象の要素は削除されています。入力中の内容は保持されています。")}</p>;
  const text = target.kind === "deleted-page" ? tr("対象のページは削除されています。コメントは残っています。")
    : target.kind === "deleted-node" ? tr("対象の要素は削除されています。コメントは残っています。")
    : target.hidden ? tr("対象の要素はこの画面幅では非表示です。") : null;
  return text ? <p className="cm-target-notice" role="status">{text}</p> : null;
}
