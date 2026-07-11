/**
 * ブラウザ標準の alert / confirm / prompt の代わりに使う、エディタのダイアログ。
 * どこからでも呼べ、結果は Promise で受け取る（DialogHost が表示する）
 */

import { create } from "zustand";

export interface DialogOptions {
  title?: string;
  /** 決定ボタンの文字 */
  okLabel?: string;
  cancelLabel?: string;
  /** 削除など取り消せない操作（決定ボタンを赤くし、初期フォーカスをキャンセルに置く） */
  danger?: boolean;
}

export interface PromptOptions extends DialogOptions {
  placeholder?: string;
  defaultValue?: string;
  /** この文字を入力したときだけ決定できる（確認のための入力） */
  expect?: string;
}

export type DialogRequest =
  | { id: number; kind: "alert"; message: string; opts: DialogOptions; resolve: () => void }
  | { id: number; kind: "confirm"; message: string; opts: DialogOptions; resolve: (ok: boolean) => void }
  | {
      id: number;
      kind: "prompt";
      message: string;
      opts: PromptOptions;
      resolve: (value: string | null) => void;
    };

/** 表示待ちのダイアログ（先頭を表示する） */
export const useDialogs = create<{ queue: DialogRequest[] }>(() => ({ queue: [] }));

let nextId = 1;

function push(req: DialogRequest) {
  useDialogs.setState((s) => ({ queue: [...s.queue, req] }));
}

/** 先頭のダイアログを閉じる（DialogHost から呼ぶ） */
export function closeDialog(id: number) {
  useDialogs.setState((s) => ({ queue: s.queue.filter((d) => d.id !== id) }));
}

/** お知らせ（OK だけ） */
export function showAlert(message: string, opts: DialogOptions = {}): Promise<void> {
  return new Promise((resolve) =>
    push({ id: nextId++, kind: "alert", message, opts, resolve })
  );
}

/** 確認（OK = true / キャンセル = false） */
export function showConfirm(message: string, opts: DialogOptions = {}): Promise<boolean> {
  return new Promise((resolve) =>
    push({ id: nextId++, kind: "confirm", message, opts, resolve })
  );
}

/** 文字の入力（キャンセル = null） */
export function showPrompt(message: string, opts: PromptOptions = {}): Promise<string | null> {
  return new Promise((resolve) =>
    push({ id: nextId++, kind: "prompt", message, opts, resolve })
  );
}
