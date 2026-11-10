"use client";

/**
 * スクリプト画面のキー操作（Esc・削除・選択・拡大縮小・履歴・ブロックのコピー / 貼り付け）
 */
import { useEffect, type Dispatch, type RefObject, type SetStateAction } from "react";
import { useEditor } from "../../lib/store";
import type { Drag, ScriptEditorLatest } from "../ScriptEditor";
import type { ScriptBlockClipboard } from "./clipboard";

/** ScriptEditorInner から受け取る値 */
export interface UseScriptEditorKeysDeps {
  dragRef: RefObject<Drag | null>;
  cancelGesture: () => boolean;
  latest: RefObject<ScriptEditorLatest>;
  setPeekId: Dispatch<SetStateAction<string | null>>;
  setSelectedList: Dispatch<SetStateAction<string[]>>;
}

const SCRIPT_CLIP_MIME = "application/x-tsumu-script+json";
const SCRIPT_CLIP_PREFIX = "Tsumu script blocks v1\\n";
let lastScriptClipboard: { raw: string; value: ScriptBlockClipboard } | null = null;

export function useScriptEditorKeys({
  dragRef,
  cancelGesture,
  latest,
  setPeekId,
  setSelectedList,
}: UseScriptEditorKeysDeps) {
  // キー操作: Esc / Backspace・Delete / ⌘A / 取り消し・やり直し
  useEffect(() => {
    // Escape は入力欄・候補メニューが先に処理する。capture で止めると、
    // 検索のクリアなどに届かず、背後の選択解除・画面終了になってしまう。
    const onEscape = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || e.isComposing || e.keyCode === 229) return;
      if (document.querySelector(".dialog-backdrop:not(.is-leaving), [data-se-popover]")) return;
      e.stopPropagation();
      if (cancelGesture()) return;
      if (latest.current.peekId) {
        setPeekId(null);
      } else if (latest.current.selectedList.length) {
        setSelectedList([]);
      } else latest.current.onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.isComposing || e.keyCode === 229) return;
      const t = e.target as HTMLElement;
      const typing =
        t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable;
      // Pickers also contain focusable buttons. Keep workspace shortcuts out
      // of them even after focus leaves their search input (as with Escape).
      if (document.querySelector(".dialog-backdrop:not(.is-leaving), [data-se-popover]")) return;
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (dragRef.current?.started || latest.current.peekId) return;
      if (mod && (e.key === "=" || e.key === "+" || e.key === "-" || e.key === "0")) {
        e.preventDefault();
        e.stopPropagation();
        if (e.key === "0") latest.current.setZoom(1);
        else latest.current.stepZoom(e.key === "-" ? -1 : 1);
        return;
      }
      if (mod && (key === "z" || key === "y")) {
        // 入力中の文字の取り消しはブラウザに任せる
        if (typing) return;
        e.preventDefault();
        e.stopPropagation();
        const s = useEditor.getState();
        if (key === "y" || e.shiftKey) s.redo();
        else s.undo();
        return;
      }
      if (mod && key === "a" && !typing) {
        e.preventDefault();
        e.stopPropagation();
        latest.current.selectAll();
        return;
      }
      if ((e.key === "Backspace" || e.key === "Delete") && !typing) {
        if (!latest.current.selectedList.length) return;
        e.preventDefault();
        e.stopPropagation();
        latest.current.deleteSelected();
      }
    };
    // Clipboard events preserve native copy/paste inside all text fields.
    // In the workspace, transfer structured blocks instead of the stale
    // canvas-element selection behind this dialog.
    const textEditing = (event: Event) => {
      const target = event.target as HTMLElement;
      return target.tagName === "INPUT" || target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" || target.isContentEditable ||
        !!document.querySelector(".dialog-backdrop:not(.is-leaving), [data-se-popover]");
    };
    const blocked = (event: Event) => textEditing(event) ||
      !!dragRef.current?.started || !!latest.current.peekId;
    const writeSelection = (event: ClipboardEvent) => {
      if (blocked(event) || !event.clipboardData) return false;
      const textSelection = window.getSelection();
      if (textSelection && !textSelection.isCollapsed && textSelection.toString()) return false;
      const copied = latest.current.copySelection();
      if (!copied) return false;
      const raw = JSON.stringify(copied);
      event.clipboardData.setData(SCRIPT_CLIP_MIME, raw);
      // Text fallback survives browsers which strip custom OS clipboard types.
      event.clipboardData.setData("text/plain", SCRIPT_CLIP_PREFIX + raw);
      lastScriptClipboard = { raw, value: copied };
      event.preventDefault();
      return true;
    };
    const onCopy = (event: ClipboardEvent) => {
      if (!writeSelection(event)) lastScriptClipboard = null;
    };
    const onCut = (event: ClipboardEvent) => {
      if (writeSelection(event)) latest.current.deleteSelected();
      else lastScriptClipboard = null;
    };
    const onPaste = (event: ClipboardEvent) => {
      if (blocked(event) || !lastScriptClipboard) return;
      const data = event.clipboardData;
      const plain = data?.getData("text/plain") ?? "";
      const raw = data?.getData(SCRIPT_CLIP_MIME) ||
        (plain.startsWith(SCRIPT_CLIP_PREFIX) ? plain.slice(SCRIPT_CLIP_PREFIX.length) : "");
      // Never interpret arbitrary external clipboard text as editor scripts.
      // The empty clipboard fallback is only for an editor-owned prior copy.
      const copied = raw === lastScriptClipboard.raw ||
        (!raw && data?.types.length === 0)
        ? lastScriptClipboard.value : null;
      if (!copied) return;
      event.preventDefault();
      latest.current.pasteSelection(copied);
    };
    window.addEventListener("copy", onCopy);
    window.addEventListener("cut", onCut);
    window.addEventListener("paste", onPaste);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keydown", onEscape);
    const t = setTimeout(() => window.dispatchEvent(new Event("resize")), 0);
    return () => {
      window.removeEventListener("copy", onCopy);
      window.removeEventListener("cut", onCut);
      window.removeEventListener("paste", onPaste);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keydown", onEscape);
      clearTimeout(t);
      setTimeout(() => window.dispatchEvent(new Event("resize")), 0);
    };
  }, [cancelGesture]);
}
