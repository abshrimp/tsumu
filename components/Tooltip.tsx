"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { glyphs } from "./Glyph";

interface TipState {
  text: string;
  kbd: string | null;
  x: number;
  y: number;
  /** 要素の上端（下に収まらないときに、上へ表示する位置） */
  top: number;
  below: boolean;
  /** 続けてホバーしたとき（直前にも表示していたとき）は、フェードを省く */
  anim: boolean;
}

/**
 * `data-tip` 属性を持つ要素にホバーしたときに表示する、独自のツールチップ。
 * `data-tip-kbd` があれば、ショートカットの表記を添える。
 */
export default function TooltipLayer() {
  const [tip, setTip] = useState<TipState | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let currentEl: Element | null = null;
    let visible = false;
    let warmUntil = 0;

    const hide = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      currentEl = null;
      if (visible) warmUntil = Date.now() + 1000;
      visible = false;
      setTip(null);
    };

    const onOver = (e: MouseEvent | FocusEvent) => {
      // キーボードでのフォーカスは、説明アイコンにだけ反応させる（クリックでフォーカスしたときは表示しない）
      if (e.type === "focusin" && !(e.target as Element).matches?.(".info-tip:focus-visible")) return;
      const el = (e.target as Element).closest?.("[data-tip]") ?? null;
      if (el === currentEl) return;
      if (timer) clearTimeout(timer);
      currentEl = el;
      if (!el) {
        if (visible) warmUntil = Date.now() + 1000;
        visible = false;
        setTip(null);
        return;
      }
      const show = (anim: boolean) => {
        if (!el.isConnected || currentEl !== el) return;
        const text = el.getAttribute("data-tip");
        if (!text) return;
        const r = el.getBoundingClientRect();
        const below = r.bottom + 40 < window.innerHeight;
        visible = true;
        setTip({
          text,
          kbd: el.getAttribute("data-tip-kbd"),
          x: r.left + r.width / 2,
          y: below ? r.bottom + 7 : r.top - 7,
          top: r.top - 7,
          below,
          anim,
        });
      };
      // 直前までツールチップを見ていた場合は、待たずにフェードなしで表示する
      if (visible || Date.now() < warmUntil) show(false);
      else timer = setTimeout(() => show(true), 150);
    };

    window.addEventListener("mouseover", onOver);
    window.addEventListener("focusin", onOver);
    window.addEventListener("mousedown", hide, true);
    window.addEventListener("wheel", hide, true);
    window.addEventListener("keydown", hide, true);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener("mouseover", onOver);
      window.removeEventListener("focusin", onOver);
      window.removeEventListener("mousedown", hide, true);
      window.removeEventListener("wheel", hide, true);
      window.removeEventListener("keydown", hide, true);
    };
  }, []);

  // 画面の端からはみ出さないよう、実際の大きさを測って横の位置をずらし、下に収まらなければ上に表示する
  const ref = useRef<HTMLDivElement>(null);
  const [shift, setShift] = useState(0);
  const [flip, setFlip] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!tip || !el) return;
    const w = el.offsetWidth;
    const left = tip.x - w / 2;
    const margin = 8;
    setShift(
      left < margin
        ? margin - left
        : left + w > window.innerWidth - margin
          ? window.innerWidth - margin - (left + w)
          : 0
    );
    setFlip(tip.below && tip.y + el.offsetHeight > window.innerHeight - margin);
  }, [tip]);

  if (!tip) return null;

  return (
    <div
      ref={ref}
      className="tooltip"
      style={{
        left: tip.x + shift,
        top: flip ? tip.top : tip.y,
        transform: `translate(-50%, ${tip.below && !flip ? "0" : "-100%"})`,
        animation: tip.anim ? undefined : "none",
      }}
    >
      {glyphs(tip.text)}
      {tip.kbd && <span className="tip-kbd">{glyphs(tip.kbd)}</span>}
    </div>
  );
}
