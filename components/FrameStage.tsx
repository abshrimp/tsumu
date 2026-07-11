"use client";

import { useRef, useState, type ReactNode, type RefObject } from "react";
import { useEditor } from "../lib/store";
import { BP_INFO, BP_ORDER } from "../lib/style";
import type { Breakpoint } from "../lib/types";
import { tr } from "../lib/i18n";

/** ブレークポイントの幅へ吸着する距離（画面上のpx） */
const SNAP_PX = 10;

/**
 * ページフレームを包み、左右の端に画面幅を変えるドラッグハンドルを付ける。
 * フレームは中央寄せなので、片側を動かすと両側が同じだけ広がる。
 */
export default function FrameStage({
  frameWidth,
  scale,
  areaRef,
  onDragScale,
  children,
}: {
  frameWidth: number;
  scale: number;
  areaRef: RefObject<HTMLDivElement | null>;
  /** ドラッグ中はフィット倍率を固定する（null で解除） */
  onDragScale: (s: number | null) => void;
  children: ReactNode;
}) {
  const breakpoint = useEditor((s) => s.breakpoint);
  const [drag, setDrag] = useState<null | { side: -1 | 1 }>(null);
  const dragRef = useRef<{ side: -1 | 1; scale: number } | null>(null);

  const widthAt = (clientX: number, side: -1 | 1, s: number, free: boolean) => {
    const area = areaRef.current;
    if (!area) return frameWidth;
    const r = area.getBoundingClientRect();
    const center = r.left + area.clientWidth / 2;
    let w = (2 * side * (clientX - center)) / s;
    // 画面からはみ出す幅では左端が固定されるので、右端の位置から求める
    if (side === 1 && w * s > area.clientWidth - 56) {
      w = (clientX - (r.left - area.scrollLeft) - 28) / s;
    }
    if (!free) {
      for (const bp of BP_ORDER) {
        if (Math.abs(BP_INFO[bp].width - w) * s <= SNAP_PX) return BP_INFO[bp].width;
      }
    }
    return Math.round(w);
  };

  const onPointerDown = (e: React.PointerEvent, side: -1 | 1) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { side, scale };
    onDragScale(scale);
    setDrag({ side });
    document.body.classList.add("is-resizing-frame");
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    useEditor.getState().setCustomWidth(widthAt(e.clientX, d.side, d.scale, e.altKey));
  };

  const end = () => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setDrag(null);
    onDragScale(null);
    document.body.classList.remove("is-resizing-frame");
    // ブレークポイントの幅ちょうどなら、そのデバイス表示として扱う
    const s = useEditor.getState();
    const bp = BP_ORDER.find(
      (b) => s.customWidth !== null && BP_INFO[b].width === s.customWidth
    );
    if (bp) s.setBreakpoint(bp as Breakpoint);
  };

  const handle = (side: -1 | 1) => (
    <div
      className={`frame-handle ${side < 0 ? "is-left" : "is-right"}${
        drag?.side === side ? " is-active" : ""
      }`}
      onPointerDown={(e) => onPointerDown(e, side)}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={() => useEditor.getState().setBreakpoint(breakpoint)}
    >
      <div
        className="frame-grip"
        data-tip={drag ? undefined : tr("ドラッグで画面幅を変更（⌥を押しながらで吸着しない・ダブルクリックで元の幅に戻す）")}
      >
        <span className="frame-grip-bar" />
        {drag?.side === side && (
          <span className="frame-width-badge">
            {frameWidth}
            <small>px</small>
            <span className="frame-width-bp">{BP_INFO[breakpoint].label}</span>
          </span>
        )}
      </div>
    </div>
  );

  return (
    <div className={`canvas-stage${drag ? " is-dragging" : ""}`}>
      {/* 各ブレークポイントの幅（区切りの幅ちょうど。ここを超えると、ひとつ大きい画面のスタイルになる） */}
      {drag &&
        BP_ORDER.map((bp) => {
          const off = (BP_INFO[bp].width * scale) / 2;
          return (
            <div
              key={bp}
              className={`bp-guide${BP_INFO[bp].width === frameWidth ? " is-hit" : ""}`}
              style={{ left: `calc(50% + ${off}px)` }}
            >
              <span>
                {BP_INFO[bp].short} {BP_INFO[bp].width}
              </span>
            </div>
          );
        })}
      {handle(-1)}
      {children}
      {handle(1)}
    </div>
  );
}
