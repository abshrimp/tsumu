import { useEffect } from "react";
import { isEscapeKey } from "./keys";

/** Esc でモーダルを閉じる（確認ダイアログを開いていれば、そちらが先に受け取って閉じる） */
export function useEscapeToClose(onClose: () => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (isEscapeKey(e) && (typeof document === "undefined" || !document.querySelector(".modal.dialog"))) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, enabled]);
}
