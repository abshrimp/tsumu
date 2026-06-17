"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Check, CornerDownLeft, MessageSquare, MoreHorizontal, Pencil, RotateCcw, Trash2, X } from "lucide-react";
import { useEditor } from "../lib/store";
import { commentId, useComments, type CommentDraft } from "../lib/comment-store";
import { isAuthor, type CommentMessage, type CommentThread } from "../lib/comments";
import { useServerStatus } from "../lib/status";
import { BP_INFO } from "../lib/style";
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
  return useMemo(
    () =>
      threads
        .filter((t) => t.pageId === pageId && (showResolved || !t.resolvedAt))
        .sort((a, b) => a.createdAt - b.createdAt),
    [threads, showResolved, pageId]
  );
}

/* ---------- 書き込み欄 ---------- */

function Composer({
  placeholder,
  initial = "",
  submitLabel,
  autoFocus,
  onSubmit,
  onCancel,
}: {
  placeholder: string;
  initial?: string;
  submitLabel: string;
  autoFocus?: boolean;
  onSubmit: (body: string) => Promise<boolean> | boolean;
  onCancel?: () => void;
}) {
  const [body, setBody] = useState(initial);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);
  const submit = async () => {
    const text = body.trim();
    if (!text || busy) return;
    setBusy(true);
    const ok = await onSubmit(text);
    setBusy(false);
    if (ok) setBody("");
  };
  return (
    <div className="cm-compose">
      <textarea
        ref={ref}
        value={body}
        rows={Math.min(6, Math.max(2, body.split("\n").length))}
        placeholder={placeholder}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          // ⌘Enter / Ctrl+Enter で送る（日本語の変換中は除く）
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void submit();
          } else if (e.key === "Escape") {
            e.stopPropagation();
            onCancel?.();
          }
        }}
      />
      <div className="cm-compose-acts">
        {onCancel && (
          <button type="button" className="btn btn-sm btn-ghost" onClick={onCancel}>
            {tr("キャンセル")}
          </button>
        )}
        <button
          type="button"
          className="btn btn-sm btn-primary"
          disabled={!body.trim() || busy}
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

function Message({ m, thread }: { m: CommentMessage; thread: CommentThread }) {
  const user = useServerStatus()?.user ?? null;
  const run = useComments((s) => s.run);
  const [editing, setEditing] = useState(false);
  /** 「…」メニューの位置（スクロールする一覧に隠れないよう、画面に固定して出す） */
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const mine = isAuthor(m.author, user);
  const first = thread.messages[0]?.id === m.id;
  return (
    <div className="cm-msg">
      <div className="cm-msg-head">
        <UserAvatar user={m.author} size={22} />
        <strong>{userLabel(m.author, tr("ゲスト"))}</strong>
        <time title={new Date(m.at).toLocaleString(getLang())}>
          {relativeTime(m.at)}
          {m.editedAt ? tr("（編集済み）") : ""}
        </time>
        {mine && !editing && (
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
                      setEditing(true);
                    },
                  },
                  {
                    key: "delete",
                    label: tr("削除"),
                    icon: <Trash2 size={14} />,
                    danger: true,
                    onClick: async () => {
                      setMenu(null);
                      const all = first && thread.messages.length === 1;
                      if (
                        await showConfirm(all ? tr("このスレッドを削除します。") : tr("このコメントを削除します。"), {
                          title: tr("コメントを削除しますか？"),
                          okLabel: tr("削除"),
                          danger: true,
                        })
                      ) {
                        await run({ action: "delete-message", messageId: m.id });
                      }
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
          placeholder={tr("コメント")}
          submitLabel={tr("保存")}
          autoFocus
          onCancel={() => setEditing(false)}
          onSubmit={async (body) => {
            const ok = await run({ action: "edit", messageId: m.id, body });
            if (ok) setEditing(false);
            return ok;
          }}
        />
      ) : (
        <p className="cm-msg-body">{m.body}</p>
      )}
    </div>
  );
}

function ThreadView({ thread, onClose }: { thread: CommentThread; onClose: () => void }) {
  const run = useComments((s) => s.run);
  const user = useServerStatus()?.user ?? null;
  const owner = thread.messages[0] ? isAuthor(thread.messages[0].author, user) : true;
  return (
    <>
      <div className="cm-pop-head">
        <span className="cm-pop-title">{thread.resolvedAt ? tr("解決済み") : tr("コメント")}</span>
        <button
          type="button"
          className={`icon-btn sm${thread.resolvedAt ? " is-on" : ""}`}
          data-tip={thread.resolvedAt ? tr("未解決に戻す") : tr("解決済みにする")}
          aria-label={thread.resolvedAt ? tr("未解決に戻す") : tr("解決済みにする")}
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
            onClick={async () => {
              if (
                await showConfirm(tr("返信も含めて、このスレッドを削除します。"), {
                  title: tr("スレッドを削除しますか？"),
                  okLabel: tr("削除"),
                  danger: true,
                })
              ) {
                if (await run({ action: "delete-thread", threadId: thread.id })) onClose();
              }
            }}
          >
            <Trash2 size={13} />
          </button>
        )}
        <button type="button" className="icon-btn sm" aria-label={tr("閉じる")} onClick={onClose}>
          <X size={14} />
        </button>
      </div>
      {thread.resolvedAt && thread.resolvedBy && (
        <p className="cm-resolved">
          {tr("{name}が解決済みにしました（{time}）", {
            name: userLabel(thread.resolvedBy, tr("ゲスト")),
            time: relativeTime(thread.resolvedAt),
          })}
        </p>
      )}
      <div className="cm-msgs">
        {thread.messages.map((m) => (
          <Message key={m.id} m={m} thread={thread} />
        ))}
      </div>
      <Composer
        placeholder={tr("返信")}
        submitLabel={tr("返信")}
        autoFocus
        onSubmit={(body) => run({ action: "reply", threadId: thread.id, id: commentId(), body })}
      />
    </>
  );
}

/* ---------- キャンバス上のピンと吹き出し ---------- */

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
  const threads = usePageThreads();
  const allThreads = useComments((s) => s.threads);
  const { open, setDraft, run, load } = useComments.getState();
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
      if (e.key !== "Escape" || document.querySelector(".modal-backdrop")) return;
      const s = useComments.getState();
      if (s.draft || s.openId) s.open(null);
      else s.setActive(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
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
        const dp = d ? place(d.nodeId, d.x, d.y) : null;
        setDraftPos((prev) =>
          prev && dp && Math.abs(prev.left - dp.left) < 0.5 && Math.abs(prev.top - dp.top) < 0.5 ? prev : dp
        );
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [on, threads, frameRef, innerRef]);

  // 開いていたスレッドが消えた（ほかの人が削除した・ページを移った）ら閉じる
  useEffect(() => {
    if (openId && !allThreads.some((t) => t.id === openId && t.pageId === pageId)) open(null);
  }, [openId, allThreads, pageId, open]);

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

  const openThread = openId ? threads.find((t) => t.id === openId) : undefined;
  const openPin = openThread ? pins.find((p) => p.id === openThread.id) : undefined;
  const popAt = draft ? draftPos : openPin ?? null;
  const innerWidth = innerRef.current?.clientWidth ?? 0;

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
        }}
      />
      {hover && !draft && !openId && (
        <div className="cm-hover" style={{ left: hover.left, top: hover.top, width: hover.width, height: hover.height }} />
      )}
      {pins.map((p) => {
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
            }}
          >
            {author?.image ? <UserAvatar user={author} size={20} /> : <span>{n}</span>}
            {t.messages.length > 1 && <small>{t.messages.length}</small>}
          </button>
        );
      })}
      {draft && draftPos && <span className="cm-pin is-draft" style={{ left: draftPos.left, top: draftPos.top }} />}
      {popAt && (draft || openThread) && (
        <CommentPop left={popAt.left} top={popAt.top} limit={innerWidth}>
          {draft ? (
            <>
              <div className="cm-pop-head">
                <span className="cm-pop-title">{tr("新しいコメント")}</span>
                <span className="cm-pop-sub">{BP_INFO[draft.bp]?.label}</span>
                <button type="button" className="icon-btn sm" aria-label={tr("閉じる")} onClick={() => setDraft(null)}>
                  <X size={14} />
                </button>
              </div>
              <Composer
                placeholder={tr("コメントを書く")}
                submitLabel={tr("投稿")}
                autoFocus
                onCancel={() => setDraft(null)}
                onSubmit={async (body) => {
                  const id = commentId();
                  const ok = await run({ action: "create", id, ...draft, body });
                  if (ok) open(id);
                  return ok;
                }}
              />
            </>
          ) : (
            openThread && <ThreadView thread={openThread} onClose={() => open(null)} />
          )}
        </CommentPop>
      )}
    </>
  );
}

/** ピンの横に出す吹き出し（右に収まらなければ左に出す） */
function CommentPop({ left, top, limit, children }: { left: number; top: number; limit: number; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [flip, setFlip] = useState(false);
  useLayoutEffect(() => {
    const w = ref.current?.offsetWidth ?? 300;
    setFlip(limit > 0 && left + 24 + w > limit);
  }, [left, limit]);
  return (
    <div
      ref={ref}
      className="cm-pop"
      style={flip ? { left: left - 16, top, transform: "translateX(-100%)" } : { left: left + 24, top }}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {children}
    </div>
  );
}

/* ---------- 右パネルの一覧 ---------- */

export function CommentsPanel() {
  const threads = useComments((s) => s.threads);
  const showResolved = useComments((s) => s.showResolved);
  const setShowResolved = useComments((s) => s.setShowResolved);
  const openId = useComments((s) => s.openId);
  const store = useComments((s) => s.store);
  const error = useComments((s) => s.error);
  const loading = useComments((s) => s.loading);
  const doc = useEditor((s) => s.doc);
  const activePageId = useEditor((s) => s.activePageId);
  const [allPages, setAllPages] = useState(false);
  const shown = threads
    .filter((t) => (showResolved || !t.resolvedAt) && (allPages || t.pageId === activePageId))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const pageThreads = threads
    .filter((t) => t.pageId === activePageId && (showResolved || !t.resolvedAt))
    .sort((a, b) => a.createdAt - b.createdAt);

  const jump = (t: CommentThread) => {
    const s = useEditor.getState();
    if (t.pageId !== s.activePageId && s.doc.pages[t.pageId]) s.setActivePage(t.pageId);
    // 付けたときの画面幅で見せる（その幅で非表示の要素もあるため）
    if (BP_INFO[t.bp] && s.breakpoint !== t.bp) s.setBreakpoint(t.bp);
    useComments.getState().open(t.id);
  };

  return (
    <div className="cm-panel">
      <div className="cm-panel-head">
        <MessageSquare size={14} />
        <strong>{tr("コメント")}</strong>
        <button type="button" className="icon-btn sm" aria-label={tr("コメントモードを終える")} data-tip={tr("コメントモードを終える（Esc）")} onClick={() => useComments.getState().setActive(false)}>
          <X size={14} />
        </button>
      </div>
      <p className="hint cm-panel-hint">{tr("キャンバスをクリックすると、その場所の要素にコメントを付けられます。")}</p>
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
      {store === "local" && (
        <p className="hint cm-panel-hint">{tr("サーバーの保存先が無いため、コメントはこのブラウザにだけ保存されます。")}</p>
      )}
      {error && <p className="hint is-error cm-panel-hint">{error}</p>}
      <div className="cm-list">
        {shown.length === 0 ? (
          <p className="cm-empty">{loading ? tr("読み込み中…") : tr("コメントはありません")}</p>
        ) : (
          shown.map((t) => {
            const first = t.messages[0];
            const last = t.messages[t.messages.length - 1];
            const n = pageThreads.indexOf(t) + 1;
            const node = t.nodeId ? doc.nodes[t.nodeId] : null;
            return (
              <button
                key={t.id}
                type="button"
                className={`cm-item${t.id === openId ? " is-on" : ""}${t.resolvedAt ? " is-resolved" : ""}`}
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
                  {allPages && doc.pages[t.pageId] ? `${doc.pages[t.pageId].name} · ` : ""}
                  {t.nodeId ? (node ? node.name : tr("削除された要素")) : tr("ページ")}
                  {t.messages.length === 2 ? ` · ${tr("返信1件")}` : t.messages.length > 2 ? ` · ${tr("返信{n}件", { n: t.messages.length - 1 })}` : ""}
                  {t.resolvedAt ? ` · ${tr("解決済み")}` : ""}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
