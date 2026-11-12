"use client";

/**
 * スクリプトの画面のキー操作（Esc・削除・選択・拡大と縮小・履歴・ブロックのコピーと貼り付け）
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
  // キー操作: Esc / Backspace・Delete / ⌘A / 元に戻す・やり直す
  useEffect(() => {
    // Escape は、入力欄や候補のメニューが先に処理する。capture で止めてしまうと、
    // 検索語の消去などに届かず、背後の選択の解除や画面の終了になってしまう。
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
      // 選択欄にもフォーカスできるボタンがある。検索の入力欄からフォーカスが外れた後も
      // （Escape と同じく）ワークスペースのショートカットを選択欄の中では動かさない。
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
        // 入力中の文字の取り消しは、ブラウザに任せる
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
    // クリップボードのイベントでは、すべての文字の入力欄で標準のコピーと貼り付けを残す。
    // ワークスペースでは、このダイアログの背後にある古いキャンバスの要素の選択ではなく、
    // 構造を持つブロックを受け渡す。
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
      // 外部から来た任意のクリップボードのテキストを、エディタのスクリプトとして解釈しない。
      // クリップボードが空のときに使う控えは、以前にエディタ自身がコピーしたものに限る。
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
