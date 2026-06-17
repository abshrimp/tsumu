"use client";

import { useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { ArrowUp, LoaderCircle, RotateCcw, Sparkles, Square, Trash2, X } from "lucide-react";
import { useEditor } from "../lib/store";
import { buildAiContext, type AiOp } from "../lib/aiOps";
import { AI_STREAM_TYPE, appendAiProgress, readAiResponse, type AiPhase, type AiProgress } from "../lib/ai/progress";
import AiActivity, { opLabel, phaseLabel } from "./AiActivity";
import { AiEditConflict, applyAiEdits } from "../lib/ai/client";
import { isEnterKey } from "../lib/keys";
import { userMessage } from "../lib/errors";
import { tr } from "../lib/i18n";
import type { SiteDoc } from "../lib/types";

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  /** 適用した操作の数 */
  ops?: number;
  /** 適用した直後の編集データ（これと同じ間だけ「元に戻す」を出す） */
  appliedDoc?: SiteDoc;
  /** 変更した要素（押すとその要素を選ぶ） */
  changes?: AiChange[];
  undone?: boolean;
  error?: boolean;
  activity?: AiProgress[];
}

interface AiChange {
  /** 要素のID（ページ設定の変更は null） */
  id: string | null;
  name: string;
  kinds: string[];
  deleted?: boolean;
}

/** 操作を要素ごとにまとめる（同じ要素への操作は1行にする） */
function summarizeChanges(ops: AiOp[], before: SiteDoc, after: SiteDoc): AiChange[] {
  const byId = new Map<string, AiChange>();
  for (const op of ops) {
    const id = op.op === "update_page" ? "" : op.op === "insert" ? op.node.id : op.op === "duplicate" ? op.newId : op.id;
    if (id === undefined) continue;
    const node = id ? after.nodes[id] ?? before.nodes[id] : null;
    const entry = byId.get(id) ?? { id: id || null, name: id ? node?.name || id : tr("ページ設定"), kinds: [] };
    const kind = opLabel(op.op);
    if (!entry.kinds.includes(kind)) entry.kinds.push(kind);
    if (id && !after.nodes[id]) entry.deleted = true;
    byId.set(id, entry);
  }
  return [...byId.values()];
}

/** 変更した要素を選び、キャンバスでその位置まで動かす */
function revealNode(id: string) {
  useEditor.getState().select(id);
  requestAnimationFrame(() => {
    document.querySelector(`.cv-root [data-node="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  });
}

interface AiState {
  /** サーバーでAI機能が有効か（null = 確認中） */
  enabled: boolean | null;
  open: boolean;
  messages: ChatMessage[];
  busy: boolean;
  phase: AiPhase;
  activity: AiProgress[];
  startedAt: number | null;
}

export const useAi = create<AiState>(() => ({
  enabled: null,
  open: false,
  messages: [],
  busy: false,
  phase: "preparing",
  activity: [],
  startedAt: null,
}));

export function toggleAi(open?: boolean) {
  useAi.setState((s) => ({ open: open ?? !s.open }));
}

/** AI機能が有効かをサーバーに確かめる（ヘッダーのボタンを出すか決める） */
export function useAiAvailability(): boolean {
  const enabled = useAi((s) => s.enabled);
  useEffect(() => {
    let cancelled = false;
    const check = () => fetch("/api/ai", { cache: "no-store", signal: AbortSignal.timeout(10_000) })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { enabled?: boolean } | null) => {
        if (!cancelled) useAi.setState({ enabled: !!data?.enabled });
      })
      .catch(() => {
        // 一時的な通信の失敗で機能を隠したままにしない（確認中のままなら、いったん無効にする）
        if (!cancelled && useAi.getState().enabled === null) useAi.setState({ enabled: false });
      });
    void check();
    window.addEventListener("focus", check);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", check);
    };
  }, []);
  return !!enabled;
}

const SUGGESTIONS = () => [
  tr("選んでいる要素を中央にそろえて"),
  tr("このページの上に、見出しと説明とボタンのあるヒーローセクションを作って"),
  tr("スマホでは文字を少し小さく、余白を詰めて"),
  tr("ボタンにホバーしたとき少し暗くなるようにして"),
];

async function ask(text: string) {
  if (useAi.getState().busy) return;
  const s = useEditor.getState();
  const history = useAi.getState().messages.filter((m) => !m.error && !m.undone);
  const context = buildAiContext(s.doc, {
    pageId: s.activePageId,
    componentId: s.editingComponentId,
    selection: s.selection,
    breakpoint: s.breakpoint,
  });
  useAi.setState((st) => ({ busy: true, phase: "preparing", activity: [], startedAt: Date.now(), messages: [...st.messages, { role: "user", text }] }));
  const controller = new AbortController();
  pendingRequest = controller;
  const timer = setTimeout(() => controller.abort(), 250_000);
  try {
    const res = await fetch("/api/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: AI_STREAM_TYPE },
      signal: controller.signal,
      body: JSON.stringify({
        messages: [...history.map((m) => ({ role: m.role, text: m.text })), { role: "user", text }],
        context,
      }),
    });
    const data = await readAiResponse(res, (event) => {
      useAi.setState((st) => ({
        activity: appendAiProgress(st.activity, event),
        ...(event.type === "phase" ? { phase: event.phase } : {}),
      }));
    });
    controller.signal.throwIfAborted();
    const ops = data.operations;
    let appliedDoc: SiteDoc | undefined;
    let applied = 0;
    if (ops.length) {
      // 1回の「元に戻す」で戻せるよう、まとめて適用する
      useEditor.getState().updateDoc((d) => {
        applied = applyAiEdits(d, context, ops);
      });
      if (useEditor.getState().doc !== s.doc) appliedDoc = useEditor.getState().doc;
    }
    const changes = applied ? summarizeChanges(ops, s.doc, useEditor.getState().doc) : undefined;
    useAi.setState((st) => ({
      messages: [
        ...st.messages,
        { role: "assistant", text: data.reply ?? "", ops: applied || undefined, changes, appliedDoc, activity: st.activity },
      ],
    }));
  } catch (e) {
    useAi.setState((st) => ({
      messages: [
        ...st.messages,
        { role: "assistant", text: controller.signal.aborted
          ? tr("AIへの依頼を中止しました。変更は適用していません。")
          : e instanceof AiEditConflict
            ? tr("待機中に編集内容が変わったため、AIの変更は適用していません。もう一度依頼してください。")
            : userMessage(e, tr("AIに問い合わせできませんでした")), error: true, activity: st.activity },
      ],
    }));
  } finally {
    clearTimeout(timer);
    pendingRequest = null;
    useAi.setState({ busy: false, activity: [], startedAt: null });
  }
}

let pendingRequest: AbortController | null = null;

export default function AiChat() {
  const open = useAi((s) => s.open);
  const messages = useAi((s) => s.messages);
  const busy = useAi((s) => s.busy);
  const phase = useAi((s) => s.phase);
  const activity = useAi((s) => s.activity);
  const startedAt = useAi((s) => s.startedAt);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!busy || !startedAt) return;
    const tick = () => setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [busy, startedAt]);
  const doc = useEditor((s) => s.doc);
  const selection = useEditor((s) => s.selection);
  const [input, setInput] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, busy]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  if (!open) return null;

  const selected = selection ? doc.nodes[selection] : null;
  const send = (text = input) => {
    const t = text.trim();
    if (!t || busy) return;
    setInput("");
    void ask(t);
  };

  return (
    <aside className="ai-panel" aria-label={tr("AIに頼む")}>
      <header className="ai-head">
        <Sparkles size={15} />
        <strong>{tr("AIに頼む")}</strong>
        <span className="ai-head-sp" />
        {messages.length > 0 && (
          <button
            className="icon-btn"
            aria-label={tr("会話を消す")}
            data-tip={tr("会話を消す（編集内容はそのまま）")}
            disabled={busy}
            onClick={() => useAi.setState({ messages: [] })}
          >
            <Trash2 size={13} />
          </button>
        )}
        <button className="icon-btn" aria-label={tr("閉じる")} data-tip={tr("閉じる")} onClick={() => toggleAi(false)}>
          <X size={14} />
        </button>
      </header>

      <div className="ai-list" ref={listRef}>
        {!messages.length && (
          <div className="ai-empty">
            <p>
              {tr("やりたいことを文章で頼むと、AIがページを編集します。結果は「元に戻す」（⌘Z）でいつでも取り消せます。")}
            </p>
            <div className="ai-suggest">
              {SUGGESTIONS().map((s) => (
                <button key={s} onClick={() => send(s)} disabled={busy}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => {
          const canUndo = !!m.appliedDoc && !m.undone && doc === m.appliedDoc;
          return (
            <div key={i} className={`ai-msg is-${m.role}${m.error ? " is-error" : ""}`}>
              <p>{m.text}</p>
              {!!m.changes?.length && !m.undone && (
                <ul className="ai-changes" aria-label={tr("変更した要素")}>
                  {m.changes.map((c) => (
                    <li key={c.id ?? ""}>
                      {c.id && !c.deleted && doc.nodes[c.id] ? (
                        <button type="button" data-tip={tr("この要素を選ぶ")} onClick={() => revealNode(c.id!)}>{c.name}</button>
                      ) : (
                        <span className={`ai-changes-name${c.id ? " is-gone" : ""}`}>{c.name}</span>
                      )}
                      <span className="ai-changes-kind">{c.kinds.join(" · ")}</span>
                    </li>
                  ))}
                </ul>
              )}
              {!!m.activity?.length && (
                <details className="ai-activity-history">
                  <summary>{tr("作業の記録")}</summary>
                  <AiActivity events={m.activity} />
                </details>
              )}
              {!!m.ops && (
                <div className="ai-msg-meta">
                  <span>{m.undone ? tr("取り消しました") : tr("{n}件の変更を適用", { n: m.ops })}</span>
                  {canUndo && (
                    <button
                      onClick={() => {
                        useEditor.getState().undo();
                        useAi.setState((st) => ({
                          messages: st.messages.map((x, j) => (j === i ? { ...x, undone: true } : x)),
                        }));
                      }}
                    >
                      <RotateCcw size={11} />
                      {tr("元に戻す")}
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {busy && (
          <div className="ai-msg is-assistant ai-activity" aria-busy="true">
            <div className="ai-activity-head">
              <LoaderCircle size={13} className="spin" />
              <span role="status">{phaseLabel(phase)}</span>
              <span className="ai-elapsed">{tr("{n}秒", { n: elapsed })}</span>
              <button type="button" className="icon-btn" aria-label={tr("中止")} onClick={() => pendingRequest?.abort()}>
                <Square size={12} />
              </button>
            </div>
            <p className="ai-activity-note">{tr("変更は完了後にまとめて反映します。")}</p>
            <AiActivity events={activity} live />
            {elapsed >= 20 && <p className="ai-activity-note">{tr("応答を待っています。このまま待つか、中止できます。")}</p>}
          </div>
        )}
      </div>

      <form
        className="ai-input"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        {selected && (
          <span className="ai-sel" title={tr("「これ」「選んでいる要素」はこの要素を指します")}>
            {tr("選択中: {name}", { name: selected.name })}
          </span>
        )}
        <div className="ai-input-row">
          <textarea
            ref={inputRef}
            value={input}
            rows={2}
            placeholder={tr("例: 見出しをもっと大きく、太くして")}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (isEnterKey(e) && !e.shiftKey) {
                e.preventDefault();
                send();
              }
              if (e.key === "Escape") toggleAi(false);
            }}
          />
          <button
            type="submit"
            className="ai-send"
            aria-label={tr("送信")}
            data-tip={tr("送信（Enter）")}
            disabled={busy || !input.trim()}
          >
            <ArrowUp size={15} />
          </button>
        </div>
      </form>
    </aside>
  );
}
