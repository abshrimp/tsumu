"use client";

/**
 * スクリプト画面のキー操作（Esc・削除・すべて選択・拡大縮小・取り消し / やり直し）
 */
import { useEffect, type Dispatch, type RefObject, type SetStateAction } from "react";
import { useEditor } from "../../lib/store";
import type { Drag, ScriptEditorLatest } from "../ScriptEditor";

/** ScriptEditorInner から受け取る値 */
export interface UseScriptEditorKeysDeps {
  dragRef: RefObject<Drag | null>;
  setDrag: Dispatch<SetStateAction<Drag | null>>;
  setActiveSlot: Dispatch<SetStateAction<string | null>>;
  latest: RefObject<ScriptEditorLatest>;
  setPeekId: Dispatch<SetStateAction<string | null>>;
  setSelectedList: Dispatch<SetStateAction<string[]>>;
}

export function useScriptEditorKeys({
  dragRef,
  setDrag,
  setActiveSlot,
  latest,
  setPeekId,
  setSelectedList,
}: UseScriptEditorKeysDeps) {
  // キー操作: Esc / Backspace・Delete / ⌘A / 取り消し・やり直し
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing =
        t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable;
      // 確認ダイアログを開いている間は、ダイアログに任せる
      if (document.querySelector(".dialog-backdrop:not(.is-leaving)")) return;
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (e.key === "Escape") {
        // 開いている選択メニューは、メニュー側で閉じる
        if (document.querySelector("[data-se-popover]")) return;
        e.stopPropagation();
        if (dragRef.current) {
          dragRef.current = null;
          setDrag(null);
          setActiveSlot(null);
        } else if (latest.current.peekId) {
          setPeekId(null);
        } else if (latest.current.selectedList.length) {
          setSelectedList([]);
        } else latest.current.onClose();
        return;
      }
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
    window.addEventListener("keydown", onKey, true);
    const t = setTimeout(() => window.dispatchEvent(new Event("resize")), 0);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      clearTimeout(t);
      setTimeout(() => window.dispatchEvent(new Event("resize")), 0);
    };
  }, []);
}
