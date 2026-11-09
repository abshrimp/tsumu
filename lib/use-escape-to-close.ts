import { useEffect } from "react";
import { isEscapeKey } from "./keys";

/** Esc でモーダルを閉じる（確認ダイアログを開いていれば、そちらが先に受け取って閉じる） */
export function useEscapeToClose(onClose: () => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (
        isEscapeKey(e) &&
        !e.defaultPrevented &&
        (typeof document === "undefined" ||
          !Array.from(document.querySelectorAll(".modal.dialog, .dd-menu, .color-pop, .ctx-menu"))
            .some((el) => !el.closest(".is-leaving")))
      ) {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, enabled]);
}
