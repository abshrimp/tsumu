"use client";

/**
 * ボタンのそばに開く小さなパネル。ブラウザの Popover API を使い、最前面への表示・
 * 外側のクリックや Esc で閉じる動作・フォーカスの戻し先はブラウザに任せる。
 * 位置だけは、画面からはみ出さないよう開くときに計算する。
 */

import { useEffect, useLayoutEffect, useRef, type CSSProperties, type ReactNode, type RefObject } from "react";
import { isEscapeKey } from "../../lib/keys";
import { anchoredMenuPos } from "../controls";

export function Popover({
  anchor,
  onClose,
  width,
  height,
  className,
  label,
  children,
}: {
  /** そばに開くボタンなど。閉じたときのフォーカスの戻し先にもなる。 */
  anchor: RefObject<HTMLElement | null>;
  onClose: () => void;
  width: number;
  /** 上下どちらに開くかを決めるための、おおよその高さ */
  height: number;
  className?: string;
  label: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useLayoutEffect(() => {
    const panel = ref.current;
    const rect = anchor.current?.getBoundingClientRect();
    if (!panel || !rect) return;
    const place = anchoredMenuPos(rect, width, height) as CSSProperties & Record<string, number | undefined>;
    for (const side of ["left", "top", "bottom", "width", "maxHeight"] as const) {
      const value = place[side];
      panel.style[side] = value === undefined ? "" : `${value}px`;
    }
    // Popover API が無いブラウザでは、同じ見た目の固定配置のパネルとして表示する。
    if (typeof panel.showPopover === "function" && !panel.matches(":popover-open")) panel.showPopover();
  }, [anchor, width, height]);

  // React の autoFocus は表示する前に実行されて効かないため、表示した後に移す
  useLayoutEffect(() => {
    ref.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const panel = ref.current;
    if (!panel) return;
    const invoker = anchor.current;
    // 外側のクリックや Esc でブラウザが閉じたときに、React の状態を合わせる。
    const onToggle = (event: Event) => {
      if ((event as ToggleEvent).newState === "closed") closeRef.current();
    };
    panel.addEventListener("toggle", onToggle);
    // 閉じた後（パネルが DOM から外れた後）でも、中にフォーカスがあったかを判断できるよう記録する
    // 取り外すときに出る focusout では消さず、外の何かへ実際に移ったときだけ消す。
    let focusedInside = false;
    const onFocusIn = (event: FocusEvent) => {
      focusedInside = event.target instanceof Node && panel.contains(event.target);
    };
    document.addEventListener("focusin", onFocusIn);
    if (panel.contains(document.activeElement)) focusedInside = true;
    const native = typeof panel.showPopover === "function";
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !panel.contains(event.target) && !invoker?.contains(event.target)) {
        closeRef.current();
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (isEscapeKey(event)) {
        event.stopPropagation();
        closeRef.current();
      }
    };
    if (!native) {
      document.addEventListener("pointerdown", outside, true);
      panel.addEventListener("keydown", onKey);
    }
    return () => {
      panel.removeEventListener("toggle", onToggle);
      document.removeEventListener("pointerdown", outside, true);
      panel.removeEventListener("keydown", onKey);
      document.removeEventListener("focusin", onFocusIn);
      // 中にフォーカスがあったまま閉じたら、開いたボタンへ戻す（別の場所へ移っていたら動かさない）
      const lost = !document.activeElement || document.activeElement === document.body || panel.contains(document.activeElement);
      if (invoker?.isConnected && (focusedInside || panel.contains(document.activeElement)) && lost) {
        invoker.focus({ preventScroll: true });
      }
    };
  }, [anchor]);

  return (
    <div
      ref={ref}
      popover="auto"
      className={`se-pop${className ? ` ${className}` : ""}`}
      role="dialog"
      aria-label={label}
      data-se-popover=""
      onPointerDown={(event) => event.stopPropagation()}
    >
      {children}
    </div>
  );
}
