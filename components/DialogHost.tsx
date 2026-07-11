"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CircleAlert, Info, TriangleAlert } from "lucide-react";
import { isEnterKey } from "../lib/keys";
import { closeDialog, useDialogs, type DialogRequest } from "../lib/dialog";
import { tr } from "../lib/i18n";

/** lib/dialog の showAlert / showConfirm / showPrompt を表示する（エディタに1つ置く） */
export default function DialogHost() {
  const current = useDialogs((s) => s.queue[0]);
  if (!current || typeof document === "undefined") return null;
  return createPortal(<Dialog key={current.id} req={current} />, document.body);
}

function Dialog({ req }: { req: DialogRequest }) {
  const [value, setValue] = useState(
    req.kind === "prompt" ? (req.opts.defaultValue ?? "") : ""
  );
  const okRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { opts } = req;
  const danger = !!opts.danger;
  const expect = req.kind === "prompt" ? req.opts.expect : undefined;
  const canOk = !expect || value.trim() === expect;

  const finish = (ok: boolean) => {
    closeDialog(req.id);
    if (req.kind === "alert") req.resolve();
    else if (req.kind === "confirm") req.resolve(ok);
    else req.resolve(ok ? value : null);
  };

  // 初期フォーカス: 入力欄 → （危険な操作なら）キャンセル → 決定
  useEffect(() => {
    if (req.kind === "prompt") {
      inputRef.current?.focus();
      inputRef.current?.select();
    } else if (danger && req.kind === "confirm") cancelRef.current?.focus();
    else okRef.current?.focus();
  }, [req.kind, danger]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        finish(false);
      }
    };
    // ダイアログを開いている間は、エディタのショートカット（Delete で要素を消すなど）を動かさない。
    // ダイアログ内の入力・ボタンの処理（React）は先に終わっているので、document で止めれば
    // window に付けたショートカットへは届かない
    const block = (e: KeyboardEvent) => e.stopPropagation();
    // 他の画面（スクリプト画面など）の Esc より先に受け取る
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("keydown", block);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("keydown", block);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const Icon = danger ? TriangleAlert : req.kind === "alert" ? Info : CircleAlert;
  const title =
    opts.title ?? (req.kind === "alert" ? tr("お知らせ") : req.kind === "prompt" ? tr("入力してください") : tr("確認"));

  return (
    <div
      className="modal-backdrop dialog-backdrop"
      onMouseDown={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget && req.kind !== "prompt") finish(false);
      }}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      data-se-popover=""
    >
      <div
        className={`modal dialog${danger ? " is-danger" : ""}`}
        role={req.kind === "alert" ? "alertdialog" : "dialog"}
        aria-modal="true"
        aria-labelledby={`dialog-title-${req.id}`}
        aria-describedby={`dialog-msg-${req.id}`}
      >
        <div className="dialog-head">
          <span className="dialog-icon">
            <Icon size={18} />
          </span>
          <h2 id={`dialog-title-${req.id}`}>{title}</h2>
        </div>
        <p id={`dialog-msg-${req.id}`} className="dialog-msg">
          {req.message}
        </p>
        {req.kind === "prompt" && (
          <input
            ref={inputRef}
            className="input dialog-input"
            value={value}
            placeholder={req.opts.placeholder ?? expect}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (isEnterKey(e) && canOk) {
                e.preventDefault();
                finish(true);
              }
            }}
          />
        )}
        <div className="modal-actions">
          {req.kind !== "alert" && (
            <button ref={cancelRef} className="btn" onClick={() => finish(false)}>
              {opts.cancelLabel ?? tr("キャンセル")}
            </button>
          )}
          <button
            ref={okRef}
            className={`btn btn-primary${danger ? " btn-danger" : ""}`}
            disabled={!canOk}
            onClick={() => finish(true)}
          >
            {opts.okLabel ?? "OK"}
          </button>
        </div>
      </div>
    </div>
  );
}
