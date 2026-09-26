"use client";

/**
 * スクリプトの画面のキー操作（Esc・削除・全選択・複製・履歴・動作のコピーと貼り付け）
 */
import { useEffect, type RefObject } from "react";
import { useEditor } from "../../lib/store";
import type { ScriptBlockClipboard } from "./clipboard";

/** キー操作から参照する、画面の最新の状態 */
export interface EditorKeyState {
  selected: readonly string[];
  /** 並べ替えの途中なら取り消して true を返す */
  cancelDrag: () => boolean;
  dragging: () => boolean;
  clearSelection: () => void;
  deleteSelected: () => void;
  duplicateSelected: () => void;
  selectAll: () => void;
  copySelection: () => ScriptBlockClipboard | null;
  pasteSelection: (copied: ScriptBlockClipboard) => void;
  onClose: () => void;
}

const SCRIPT_CLIP_MIME = "application/x-tsumu-script+json";
const SCRIPT_CLIP_PREFIX = "Tsumu script actions v2\n";
let lastScriptClipboard: { raw: string; value: ScriptBlockClipboard } | null = null;

/** 開いているメニューや小窓が、先にキーを受け取る。 */
const overlayOpen = () =>
  !!document.querySelector(".dialog-backdrop:not(.is-leaving), [data-se-popover]");

const isTyping = (target: EventTarget | null) => {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
};

export function useEditorKeys(latest: RefObject<EditorKeyState>) {
  useEffect(() => {
    // Escape は、入力欄や候補のメニューが先に処理する。capture で止めてしまうと、
    // 検索語の消去などに届かず、背後の選択の解除や画面の終了になってしまう。
    const onEscape = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || e.isComposing || e.keyCode === 229) return;
      if (overlayOpen()) return;
      e.stopPropagation();
      const state = latest.current;
      if (state.cancelDrag()) return;
      if (state.selected.length) state.clearSelection();
      else state.onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.isComposing || e.keyCode === 229) return;
      if (overlayOpen()) return;
      const state = latest.current;
      if (state.dragging()) return;
      const typing = isTyping(e.target);
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (mod && (key === "z" || key === "y")) {
        // 入力中の文字の取り消しは、ブラウザに任せる
        if (typing) return;
        e.preventDefault();
        e.stopPropagation();
        const editor = useEditor.getState();
        if (key === "y" || e.shiftKey) editor.redo();
        else editor.undo();
        return;
      }
      if (typing) return;
      if (mod && key === "a") {
        e.preventDefault();
        e.stopPropagation();
        state.selectAll();
      } else if (mod && key === "d") {
        if (!state.selected.length) return;
        e.preventDefault();
        e.stopPropagation();
        state.duplicateSelected();
      } else if (e.key === "Backspace" || e.key === "Delete") {
        if (!state.selected.length) return;
        e.preventDefault();
        e.stopPropagation();
        state.deleteSelected();
      }
    };
    // 文字の入力欄では標準のコピーと貼り付けを残す。それ以外では、この画面の背後にある
    // キャンバスの要素ではなく、選択した動作を受け渡す。
    const blocked = (event: Event) => isTyping(event.target) || overlayOpen() || latest.current.dragging();
    const writeSelection = (event: ClipboardEvent) => {
      if (blocked(event) || !event.clipboardData) return false;
      const textSelection = window.getSelection();
      if (textSelection && !textSelection.isCollapsed && textSelection.toString()) return false;
      const copied = latest.current.copySelection();
      if (!copied) return false;
      const raw = JSON.stringify(copied);
      event.clipboardData.setData(SCRIPT_CLIP_MIME, raw);
      // 独自の形式を OS のクリップボードから取り除くブラウザでも、テキストの形式なら残る。
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
      // 外部から来た任意のクリップボードのテキストを、スクリプトとして解釈しない。
      // クリップボードが空のときに使う控えは、以前にこの画面自身がコピーしたものに限る。
      const copied = raw === lastScriptClipboard.raw || (!raw && data?.types.length === 0)
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
    return () => {
      window.removeEventListener("copy", onCopy);
      window.removeEventListener("cut", onCut);
      window.removeEventListener("paste", onPaste);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keydown", onEscape);
    };
  }, [latest]);
}
