"use client";

/**
 * スクリプトの画面のキー操作（Esc・削除・全選択・複製・履歴・動作のコピーと貼り付け）
 */
import { useEffect, type RefObject } from "react";
import { useEditor } from "../../lib/store";
import { isScriptBlockClipboard, type ScriptBlockClipboard } from "./clipboard";
import { storageKey } from "../../lib/storage-keys";

/** キー操作から参照する、画面の最新の状態 */
export interface EditorKeyState {
  selected: readonly string[];
  /** 並べ替えの途中なら取り消して true を返す */
  cancelDrag: () => boolean;
  dragging: () => boolean;
  clearSelection: () => void;
  deleteSelected: (focusedStepId?: string) => void;
  duplicateSelected: () => void;
  selectAll: () => void;
  copySelection: (focusedStepId?: string) => ScriptBlockClipboard | null;
  pasteSelection: (copied: ScriptBlockClipboard, focusedStepId?: string) => void;
  onClose: () => void;
}

const SCRIPT_CLIP_MIME = "application/x-tsumu-script+json";
const SCRIPT_CLIP_PREFIX = "Tsumu script actions v2\n";
const SCRIPT_CLIP_MIRROR = storageKey("script-clipboard-v2");
const MAX_SCRIPT_CLIP_LENGTH = 8 * 1024 * 1024;
let lastScriptClipboard: { raw: string; value: ScriptBlockClipboard } | null = null;
let pendingWrite: Promise<boolean> | null = null;
let useInternalPaste = false;

function saveScriptClipboard(value: ScriptBlockClipboard): string {
  const raw = JSON.stringify(value);
  lastScriptClipboard = { raw, value };
  try {
    if (raw.length <= MAX_SCRIPT_CLIP_LENGTH) localStorage.setItem(SCRIPT_CLIP_MIRROR, raw);
    else localStorage.removeItem(SCRIPT_CLIP_MIRROR);
  } catch {
    // 保存を許可しないブラウザでも、その画面でのコピーは利用できる。
  }
  return raw;
}

/** 同じブラウザで Tsumu がコピーした内容だけを受け付ける。 */
function ownScriptClipboard(raw: string): ScriptBlockClipboard | null {
  if (!raw) return null;
  if (lastScriptClipboard?.raw === raw) return lastScriptClipboard.value;
  if (raw.length > MAX_SCRIPT_CLIP_LENGTH) return null;
  try {
    if (localStorage.getItem(SCRIPT_CLIP_MIRROR) !== raw) return null;
  } catch {
    return null;
  }
  try {
    const value: unknown = JSON.parse(raw);
    if (!isScriptBlockClipboard(value)) return null;
    lastScriptClipboard = { raw, value };
    return value;
  } catch {
    return null;
  }
}

function rawFromText(text: string): string | null {
  return text.startsWith(SCRIPT_CLIP_PREFIX) ? text.slice(SCRIPT_CLIP_PREFIX.length) : null;
}

/** メニューからのコピーもネイティブのコピーと同じ形式で保持する。 */
export function rememberScriptClipboard(value: ScriptBlockClipboard): void {
  const raw = saveScriptClipboard(value);
  useInternalPaste = !navigator.clipboard?.writeText;
  try {
    // メニュー操作には ClipboardEvent が来ないので、OS のクリップボードも更新する。
    pendingWrite = navigator.clipboard?.writeText(SCRIPT_CLIP_PREFIX + raw)
      .then(() => true, () => false) ?? null;
  } catch {
    pendingWrite = null;
    useInternalPaste = true;
  }
}

/**
 * ボタンの貼り付けは OS の現在のクリップボードを優先する。
 * 他の文字列をコピーしたのに古いブロックを挿入することを防ぐ。
 */
export async function readScriptClipboard(): Promise<ScriptBlockClipboard | null> {
  try {
    if (pendingWrite) {
      useInternalPaste = !(await pendingWrite);
      pendingWrite = null;
    }
    if (useInternalPaste) return lastScriptClipboard?.value ?? null;
    if (navigator.clipboard?.readText) {
      const text = await navigator.clipboard.readText();
      const raw = rawFromText(text);
      return raw ? ownScriptClipboard(raw) : null;
    }
  } catch {
    // Clipboard API が使えない環境では、最後にコピーした内部データを利用する。
  }
  return lastScriptClipboard?.value ?? null;
}

/** 開いているメニューや小窓が、先にキーを受け取る。 */
const overlayOpen = () =>
  !!document.querySelector(".dialog-backdrop:not(.is-leaving), [data-se-popover]");

const isTyping = (target: EventTarget | null) => {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
};

/**
 * 未設定の入力欄ではコピーする文字が無い。そこにカーソルがあれば、
 * その入力欄を含む動作をコピー・貼り付けの対象にする。
 * 入力済みの文字や選択中の文字にはブラウザ標準の動作を優先する。
 */
function emptyFieldStep(target: EventTarget | null): string | null {
  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) ||
      target.disabled || target.readOnly || target.value.length !== 0) return null;
  const selectionStart = target.selectionStart;
  const selectionEnd = target.selectionEnd;
  if (selectionStart !== null && selectionEnd !== null && selectionStart !== selectionEnd) return null;
  return target.closest<HTMLElement>(".se-card[data-step-id]")?.dataset.stepId ?? null;
}

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
      const focusedStepId = emptyFieldStep(event.target);
      if ((blocked(event) && !focusedStepId) || !event.clipboardData) return false;
      const textSelection = window.getSelection();
      if (textSelection && !textSelection.isCollapsed && textSelection.toString()) return false;
      const copied = latest.current.copySelection(focusedStepId ?? undefined);
      if (!copied) return false;
      const raw = saveScriptClipboard(copied);
      pendingWrite = null;
      useInternalPaste = false;
      event.clipboardData.setData(SCRIPT_CLIP_MIME, raw);
      // 独自の形式を OS のクリップボードから取り除くブラウザでも、テキストの形式なら残る。
      event.clipboardData.setData("text/plain", SCRIPT_CLIP_PREFIX + raw);
      event.preventDefault();
      return true;
    };
    const onCopy = (event: ClipboardEvent) => {
      if (!writeSelection(event)) lastScriptClipboard = null;
    };
    const onCut = (event: ClipboardEvent) => {
      if (writeSelection(event)) latest.current.deleteSelected(emptyFieldStep(event.target) ?? undefined);
      else lastScriptClipboard = null;
    };
    const onPaste = (event: ClipboardEvent) => {
      const focusedStepId = emptyFieldStep(event.target);
      if (blocked(event) && !focusedStepId) return;
      const data = event.clipboardData;
      const raw = data && (data.getData(SCRIPT_CLIP_MIME) ||
        rawFromText(data.getData("text/plain")));
      // 別タブ・再読み込み後でも、以前このエディタが保存したデータと完全一致すれば利用できる。
      // コピー元を判別できない空のイベントでは、現在のタブの控えだけを使う。
      const copied = raw ? ownScriptClipboard(raw)
        : data?.types.length === 0 ? lastScriptClipboard?.value : null;
      if (!copied) return;
      event.preventDefault();
      latest.current.pasteSelection(copied, focusedStepId ?? undefined);
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
