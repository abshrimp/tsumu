"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Maximize2, X } from "lucide-react";
import { highlightCustomCode } from "../lib/code-highlight";
import { tr } from "../lib/i18n";

/** Each button opens the code field beside its own label, not a whole section. */
export function CodeEditorButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className="code-editor-button"
      aria-label={label + ": " + tr("Open code editor")}
      data-tip={tr("Open code editor")}
      onClick={onClick}
    >
      <Maximize2 size={13} />
    </button>
  );
}

/** Edit one field at a time and commit one undoable change only when applied. */
export function CustomCodeEditorModal({
  title, value, placeholder, onApply, onClose,
}: {
  title: string;
  value: string;
  placeholder?: string;
  onApply: (value: string) => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const inputId = useId();
  const initial = useRef(value);
  const [draft, setDraft] = useState(value);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLPreElement>(null);
  const highlighted = useMemo(() => highlightCustomCode(draft), [draft]);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    textareaRef.current?.focus();
    return () => previousFocus?.focus();
  }, []);

  // Stop Escape from reaching keyboard handlers in the editor behind the modal.
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
    if (draft !== initial.current) onApply(draft);
    onClose();
  };
  const onEditorKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      apply();
    } else if (event.key === "Tab" && !event.shiftKey &&
      !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      const start = event.currentTarget.selectionStart;
      const end = event.currentTarget.selectionEnd;
      setDraft((old) => old.slice(0, start) + "  " + old.slice(end));
      requestAnimationFrame(() => textareaRef.current?.setSelectionRange(start + 2, start + 2));
    }
  };
  const syncScroll = () => {
    if (!highlightRef.current || !textareaRef.current) return;
    highlightRef.current.scrollTop = textareaRef.current.scrollTop;
    highlightRef.current.scrollLeft = textareaRef.current.scrollLeft;
  };

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div
        className="modal custom-code-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="custom-code-header">
          <h2 id={titleId}>{title} · {tr("Code editor")}</h2>
          <button type="button" className="icon-btn" aria-label={tr("Close")} onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="custom-code-stage">
          <pre className="custom-code-highlight" aria-hidden="true" ref={highlightRef}>
            <code dangerouslySetInnerHTML={{ __html: highlighted + "\n" }} />
          </pre>
          <textarea
            id={inputId}
            ref={textareaRef}
            aria-label={title}
            className="textarea mono custom-code-input"
            value={draft}
            placeholder={placeholder}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            autoCorrect="off"
            wrap="off"
            onScroll={syncScroll}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onEditorKeyDown}
          />
        </div>
        <div className="custom-code-footer">
          <p className="hint">HTML / CSS / JavaScript · Tab: {tr("Indent")} · ⌘/Ctrl+S: {tr("Apply")}</p>
          <div className="modal-actions">
            <button type="button" className="btn" onClick={onClose}>{tr("Cancel")}</button>
            <button type="button" className="btn btn-primary" disabled={draft === initial.current} onClick={apply}>
              {tr("Apply")}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
