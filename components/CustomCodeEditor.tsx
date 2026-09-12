"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Code2, X } from "lucide-react";
import { tr } from "../lib/i18n";

export interface CodeEditorField {
  id: string;
  label: string;
  value: string;
  placeholder?: string;
}

/** セクションのヘルプと並べる、拡大編集ボタン。 */
export function CodeEditorButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className="sec-help code-editor-button"
      aria-label={tr("Open code editor")}
      data-tip={tr("Open code editor")}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      <Code2 size={14} />
    </button>
  );
}

/** 確定前はストアに書き込まず、複数のコード欄をまとめて編集する。 */
export function CustomCodeEditorModal({
  title, fields, onApply, onClose,
}: {
  title: string;
  fields: CodeEditorField[];
  onApply: (changed: Record<string, string>) => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const editorId = useId();
  const initial = useRef<Record<string, string>>(Object.fromEntries(fields.map((field) => [field.id, field.value])));
  const [draft, setDraft] = useState<Record<string, string>>(() => ({ ...initial.current }));
  const [active, setActive] = useState(fields[0].id);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const current = fields.find((field) => field.id === active) ?? fields[0];
  const value = draft[current.id] ?? "";
  const modified = fields.some((field) => draft[field.id] !== initial.current[field.id]);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    textareaRef.current?.focus();
    return () => previousFocus?.focus();
  }, []);

  // 背後のエディタに Esc を伝播させず、コード編集画面だけを閉じる。
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onClose();
    };
    document.addEventListener("keydown", escape, true);
    return () => document.removeEventListener("keydown", escape, true);
  }, [onClose]);

  const apply = () => {
    const changed = Object.fromEntries(
      fields.filter((field) => draft[field.id] !== initial.current[field.id])
        .map((field) => [field.id, draft[field.id]])
    );
    if (Object.keys(changed).length) onApply(changed);
    onClose();
  };

  const onEditorKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      apply();
    } else if (event.key === "Tab" && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      const start = event.currentTarget.selectionStart;
      const end = event.currentTarget.selectionEnd;
      setDraft((old) => ({
        ...old,
        [active]: (old[active] ?? "").slice(0, start) + "  " + (old[active] ?? "").slice(end),
      }));
      requestAnimationFrame(() => textareaRef.current?.setSelectionRange(start + 2, start + 2));
    }
  };

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal custom-code-modal" role="dialog" aria-modal="true"
        aria-labelledby={titleId} onClick={(event) => event.stopPropagation()}>
        <div className="custom-code-header">
          <h2 id={titleId}>{title} · {tr("Code editor")}</h2>
          <button type="button" className="icon-btn" aria-label={tr("Close")} onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        {fields.length > 1 && (
          <div className="custom-code-tabs">
            {fields.map((field) => (
              <button type="button" key={field.id}
                className={active === field.id ? "is-active" : ""}
                aria-pressed={active === field.id}
                onClick={() => { setActive(field.id); textareaRef.current?.focus(); }}>
                {field.label}
              </button>
            ))}
          </div>
        )}
        <label className="lbl" htmlFor={editorId}>{current.label}</label>
        <textarea
          id={editorId}
          ref={textareaRef}
          className="textarea mono custom-code-input"
          value={value}
          placeholder={current.placeholder}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          wrap="off"
          onChange={(event) => setDraft((old) => ({ ...old, [active]: event.target.value }))}
          onKeyDown={onEditorKeyDown}
        />
        <div className="custom-code-footer">
          <p className="hint">Tab: {tr("Indent")} · ⌘/Ctrl+S: {tr("Apply")}</p>
          <div className="modal-actions">
            <button type="button" className="btn" onClick={onClose}>{tr("Cancel")}</button>
            <button type="button" className="btn btn-primary" disabled={!modified} onClick={apply}>
              {tr("Apply")}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
