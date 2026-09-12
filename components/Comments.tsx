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
  // 非表示の画面幅などで大きさが無い場合は、ピンを置く場所が無いものとする
  return el && (el.offsetWidth || el.offsetHeight) ? el : null;
}

/** 開いているページで表示するスレッド（作成した順。番号もこの順に振る） */
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
        // 再マウントした入力欄が、このスレッドのより新しい下書きを持っている場合があるため、同じものだけを消す。
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
        // 保存中の本文はコピーできるが変更はさせない。保存に成功しても、その後の新しい入力は消さない。
        readOnly={busy}
        rows={Math.min(6, Math.max(2, body.split("\n").length))}
        placeholder={placeholder}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          // 変換の確定や取り消しを、送信や下書きのキャンセルとして扱わない。
          if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void submit();
          } else if (e.key === "Escape" && onCancel) {
            e.stopPropagation();
            // 明示的なキャンセルは、ボタンと同じく下書きを破棄する。返信欄は親の Esc で閉じる。
            if (draftKey) unsentBodies.delete(draftKey);
            onCancel();
          }
        }}
      />
      {tooLong && <p className="hint is-error" role="alert">{tr("Comments must be {max} characters or fewer.", { max: MAX_COMMENT_LENGTH })}</p>}
      <div className="cm-compose-acts">
        {onCancel && (
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => { if (draftKey) unsentBodies.delete(draftKey); onCancel(); }}>
            {tr("Cancel")}
          </button>
        )}
        <button
          type="button"
          className="btn btn-sm btn-primary"
          disabled={disabled || !body.trim() || busy || tooLong}
          data-tip={tr("Send (⌘Enter)")}
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

/** 削除の確認は、表示中のスレッドに対して行う（後から開いたパネルや、後の編集には引き継がない）。 */
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
  /** 「…」メニューの位置（スクロールする一覧に隠れないよう、画面に固定して表示する） */
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const mine = isAuthor(m.author, user);
  const first = thread.messages[0]?.id === m.id;
  const beginDeletion = useCommentDeletion(`${thread.id}:${m.id}:${editing}`, !!unavailable || !mine);
  return (
    <div className="cm-msg">
      <div className="cm-msg-head">
        <UserAvatar user={m.author} size={22} />
        <strong>{userLabel(m.author, tr("Guest"))}</strong>
        <time title={new Date(m.at).toLocaleString(getLang())}>
          {relativeTime(m.at)}
          {m.editedAt ? tr(" (edited)") : ""}
        </time>
        {mine && !editing && !unavailable && (
          <span className="cm-msg-menu">
            <button
              type="button"
              className="icon-btn sm"
              aria-label={tr("Comment actions")}
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
                    label: tr("Edit"),
                    icon: <Pencil size={14} />,
                    onClick: () => {
                      setMenu(null);
                      editSession.current++;
                      setEditing(true);
                    },
                  },
                  {
                    key: "delete",
                    label: tr("Delete"),
                    icon: <Trash2 size={14} />,
                    danger: true,
                    onClick: async () => {
                      const operation = beginDeletion();
                      if (!operation) return;
                      setMenu(null);
                      try {
                        const all = first && thread.messages.length === 1;
                        if (
                          await showConfirm(all ? tr("This thread will be deleted.") : tr("This comment will be deleted."), {
                            title: tr("Delete this comment?"),
                            okLabel: tr("Delete"),
                            danger: true,
                          })
                        ) {
                          if (!operation.current()) return;
                          const ok = await run({ action: "delete-message", messageId: m.id });
                          if (ok && useComments.getState().threadUnavailable) closeCommentIfOpen(thread.id);
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
          placeholder={tr("Comments")}
          submitLabel={tr("save")}
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
        {thread.resolvedAt && <span className="cm-badge">{tr("Resolved")}</span>}
        <button
          type="button"
          className={`icon-btn sm${thread.resolvedAt ? " is-on" : ""}`}
          data-tip={thread.resolvedAt ? tr("Reopen") : tr("Resolve")}
          aria-label={thread.resolvedAt ? tr("Reopen") : tr("Resolve")}
          disabled={unavailable}
          onClick={() => void run({ action: "resolve", threadId: thread.id, resolved: !thread.resolvedAt })}
        >
          {thread.resolvedAt ? <RotateCcw size={13} /> : <Check size={14} />}
        </button>
        {owner && (
          <button
            type="button"
            className="icon-btn sm"
            data-tip={tr("Delete thread")}
            aria-label={tr("Delete thread")}
            disabled={unavailable}
            onClick={async () => {
              const operation = beginDeletion();
              if (!operation) return;
              try {
                if (
                  await showConfirm(tr("This thread and all its replies will be deleted."), {
                    title: tr("Delete this thread?"),
                    okLabel: tr("Delete"),
                    danger: true,
                  })
                ) {
                  if (!operation.current()) return;
                  if (await run({ action: "delete-thread", threadId: thread.id })) onClose();
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
          {tr("Resolved by {name} ({time})", {
            name: userLabel(thread.resolvedBy, tr("Guest")),
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
        placeholder={tr("Reply")}
        disabled={unavailable}
        submitLabel={tr("Reply")}
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

interface CommentLayerProps {
  frameRef: RefObject<HTMLDivElement | null>;
  innerRef: RefObject<HTMLDivElement | null>;
}

export function CommentLayer(props: CommentLayerProps) {
  const active = useComments((s) => s.active);
  const mode = useEditor((s) => s.mode);
  return active && mode === "design" ? <ActiveCommentLayer {...props} /> : null;
}

/**
 * コメントモードでキャンバスに重ねる層。クリックした要素にコメントを付け、
 * 付いているコメントをピンで示す（位置は要素の中の割合で持つため、幅を変えても追従する）
 */
function ActiveCommentLayer({ frameRef, innerRef }: CommentLayerProps) {
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

  // 他の人のコメントも見えるよう、開いている間は定期的に読み込み直す
  useEffect(() => {
    const id = setInterval(() => {
      if (!document.hidden) void load();
    }, 15000);
    return () => clearInterval(id);
  }, [load]);

  // Esc: 書きかけのコメントや開いているスレッドを閉じる。何も無ければコメントモードを終える
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.isComposing || e.keyCode === 229 || document.querySelector(".modal-backdrop")) return;
      const s = useComments.getState();
      if (s.draft || s.openId) s.open(null);
      else s.setActive(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Windows では Alt を単独で離すとブラウザのメニューにフォーカスが移るため、それを止める
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
    };
  }, []);

  // ピンの位置（スクロール・拡大・幅の変更に追従するため、毎フレーム測る）
  useEffect(() => {
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
  }, [threads, pageId, frameRef, innerRef]);

  if (!frameBox) return null;

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
          // 書きかけのコメントや開いているスレッドがあれば、まずそれを閉じる
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
            aria-label={tr("Comment {n}", { n })}
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
    <button type="button" className="icon-btn sm" aria-label={tr("Back to list", "back_to_list_variant_1")} data-tip={tr("Back to list (Esc)")} onClick={onClick}>
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
  // 閲覧中のスレッドは、ページ・絞り込み・ピンの位置とは無関係に表示し続け、共同編集による削除でも入力内容を残す。
  const openThread = openId ? (focusedThread?.id === openId ? focusedThread : threads.find(t => t.id === openId)) : undefined;
  useEffect(() => {
    if (openId && !openThread) open(null);
  }, [openId, openThread, open]);
  const partial = !!cursor || !!nextCursor || total > threads.length;
  const visible = threads.filter((t) => showResolved || !t.resolvedAt);
  const shown = visible
    .filter((t) => allPages || targetOf(t).pageId === activePageId)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  // 削除されたページのコメントは「このページ」には表示されないため、あることだけを知らせる
  const onDeletedPages = allPages ? 0 : visible.filter((t) => targetOf(t).kind === "deleted-page").length;
  const pageThreads = visible
    .filter((t) => targetOf(t).pageId === activePageId)
    .sort((a, b) => a.createdAt - b.createdAt);

  /** 対象の場所（ページ名と要素名） */
  const placeOf = (t: CommentThread | CommentDraft, withPage: boolean) => {
    const target = targetOf(t);
    const page = doc.pages[target.pageId];
    const node = t.nodeId ? doc.nodes[t.nodeId] : null;
    const where = target.kind === "deleted-page" ? tr("Deleted page") : t.nodeId ? (node ? node.name : tr("Deleted element")) : tr("The whole page");
    return withPage && page && target.kind !== "deleted-page" ? `${page.name} · ${where}` : where;
  };

  const jump = (t: CommentThread) => {
    const s = useEditor.getState();
    const pageId = targetOf(t).pageId;
    if (pageId !== s.activePageId && s.doc.pages[pageId]) s.setActivePage(pageId);
    // コメントを付けたときの画面幅で表示する（その幅でしか表示されない要素もあるため）
    if (BP_INFO[t.bp] && s.breakpoint !== t.bp) s.setBreakpoint(t.bp);
    useComments.getState().open(t.id);
  };

  const detailOpen = !!(draft || openThread);

  return (
    <div className="cm-panel">
      <div className="cm-panel-head">
        <MessageSquare size={14} />
        <strong>{tr("Comments")}</strong>
        <button
          type="button"
          className={`icon-btn sm${pinsHidden ? " is-on" : ""}`}
          aria-label={pinsHidden ? tr("Show pins") : tr("Hide pins")}
          aria-pressed={pinsHidden}
          data-tip={pinsHidden ? tr("Show pins on the canvas") : tr("Hide pins on the canvas (or hold ⌥ to hide them briefly)")}
          onClick={() => setPinsHidden(!pinsHidden)}
        >
          {pinsHidden ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
        <button type="button" className="icon-btn sm" aria-label={tr("Exit comment mode")} data-tip={tr("Exit comment mode (Esc)")} onClick={() => useComments.getState().setActive(false)}>
          <X size={14} />
        </button>
      </div>
      {error && <p className="hint is-error cm-panel-hint">{error}</p>}
      {detailOpen ? (
        <section className="cm-detail" aria-label={tr("Comment details")}>
          {draft ? (
            <>
              <div className="cm-detail-head">
                <div className="cm-pop-head">
                  <BackButton onClick={() => setDraft(null)} />
                  <span className="cm-pop-title">{tr("New comment")}</span>
                  <span className="cm-pop-sub">{BP_INFO[draft.bp]?.label}</span>
                </div>
                <p className="cm-detail-context">{placeOf(draft, true)}</p>
              </div>
              <TargetNotice target={targetOf(draft)} draft />
              <Composer
                placeholder={tr("Write a comment")}
                submitLabel={tr("Post")}
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
                    {threadUnavailable && <p className="cm-target-notice is-alert" role="alert">{tr("This discussion has been deleted. Your draft remains until you close it, so copy it if you need it.")}</p>}
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
                {tr("This page")}
              </button>
              <button type="button" className={allPages ? "is-on" : ""} onClick={() => setAllPages(true)}>
                {tr("All pages")}
              </button>
            </div>
            <label className="lbl cm-panel-check">
              <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} />
              {tr("Show resolved")}
            </label>
          </div>
          <div className="cm-list">
            {onDeletedPages > 0 && (
              <button type="button" className="cm-list-notice" onClick={() => setAllPages(true)}>
                {tr("Comments on deleted pages: {n}. Switch to All pages to see them.", { n: onDeletedPages })}
              </button>
            )}
            {shown.length === 0 ? (
              <div className="cm-empty">
                <p>{loading ? tr("Loading…") : partial ? tr("No matching comments in this batch. You can check other batches.") : tr("No comments")}</p>
                {!loading && !partial && <p className="hint">{tr("Click the canvas to attach a comment to the element there.")}</p>}
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
                      <strong>{userLabel(first.author, tr("Guest"))}</strong>
                      <time>{relativeTime(last.at)}</time>
                    </span>
                    <span className="cm-item-body">{first.body}</span>
                    <span className="cm-item-meta">
                      <span className={isDeletedCommentTarget(target) ? "cm-item-place is-deleted" : "cm-item-place"}>{placeOf(t, allPages)}</span>
                      {target.hidden && <span>{tr("Hidden at this screen width")}</span>}
                      {replies === 1 ? <span>{tr("1 reply")}</span> : replies > 1 ? <span>{tr("{n} replies", { n: replies })}</span> : null}
                      {t.resolvedAt && <span>{tr("Resolved")}</span>}
                    </span>
                  </button>
                );
              })
            )}
          </div>
          {partial && (
            <div className="cm-pagination" title={tr("Filters and pins apply to the batch shown.")}>
              <span className="hint">{tr("{loaded} of {total}", { total, loaded: threads.length })}</span>
              <span className="cm-pagination-actions">
                {cursor && (
                  <button type="button" className="icon-btn sm" aria-label={tr("Latest comments")} data-tip={tr("Latest comments")} disabled={loading || saving} onClick={() => void navigate("newest")}>
                    <ChevronsLeft size={14} />
                  </button>
                )}
                <button type="button" className="icon-btn sm" aria-label={tr("Newer comments")} data-tip={tr("Newer comments")} disabled={loading || saving || !previousCursors.length} onClick={() => void navigate("newer")}>
                  <ChevronLeft size={14} />
                </button>
                <button type="button" className="icon-btn sm" aria-label={tr("Older comments")} data-tip={tr("Older comments")} disabled={loading || saving || !nextCursor} onClick={() => void navigate("older")}>
                  <ChevronRight size={14} />
                </button>
              </span>
            </div>
          )}
          {store === "local" && (
            <p className="hint cm-panel-foot">{tr("There is no server storage, so comments are saved only in this browser.")}</p>
          )}
        </>
      )}
    </div>
  );
}

function TargetNotice({ target, draft }: { target: CommentTarget; draft: boolean }) {
  if (draft && isDeletedCommentTarget(target)) return <p className="cm-target-notice" role="status">{target.kind === "deleted-page"
    ? tr("The page has been deleted. Your unfinished comment is retained.")
    : tr("The element has been deleted. Your unfinished comment is retained.")}</p>;
  const text = target.kind === "deleted-page" ? tr("The page has been deleted. Its comments are retained.")
    : target.kind === "deleted-node" ? tr("The element has been deleted. Its comments are retained.")
    : target.hidden ? tr("The element is hidden at this screen width.") : null;
  return text ? <p className="cm-target-notice" role="status">{text}</p> : null;
}
