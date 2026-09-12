"use client";

/**
 * スクリプトの画面のドラッグ（パレット → ワークスペース / ワークスペース内での移動）と範囲選択
 */
import { useCallback, useEffect, type Dispatch, type RefObject, type SetStateAction } from "react";
import { useEditor } from "../../lib/store";
import { scriptUid } from "../../lib/script";
import { isDataStep } from "../../lib/data";
import { PAGE_TARGET } from "../../lib/types";
import { type Payload } from "./palette";
import { connectNewTransform, insertAt, parseSlot, slotKey } from "./step-tree";
import { SlotIndex, type SlotPoint } from "./slot-index";
import type { Drag, Marquee, Menu, ScriptEditorLatest } from "../ScriptEditor";

/** ScriptEditorInner から受け取る値 */
export interface UseScriptDragDeps {
  wsRef: RefObject<HTMLDivElement | null>;
  zoomRef: RefObject<number>;
  marqueeRef: RefObject<Marquee | null>;
  setMarquee: Dispatch<SetStateAction<Marquee | null>>;
  setSelectedList: Dispatch<SetStateAction<string[]>>;
  dragRef: RefObject<Drag | null>;
  setMenu: Dispatch<SetStateAction<Menu | null>>;
  setActiveSlot: (key: string | null, measuredElement?: HTMLElement | null) => void;
  setDrag: Dispatch<SetStateAction<Drag | null>>;
  latest: RefObject<ScriptEditorLatest>;
  paletteRef: RefObject<HTMLDivElement | null>;
  ghostRef?: RefObject<HTMLDivElement | null>;
  marqueeElRef?: RefObject<HTMLDivElement | null>;
}

export function useScriptDrag({
  wsRef,
  zoomRef,
  marqueeRef,
  setMarquee,
  setSelectedList,
  dragRef,
  setMenu,
  setActiveSlot,
  setDrag,
  latest,
  paletteRef,
  ghostRef,
  marqueeElRef,
}: UseScriptDragDeps) {
  // 中断はドロップとして扱わない。元のブロックと履歴をそのまま残す。
  const cancelGesture = useCallback(() => {
    if (!dragRef.current && !marqueeRef.current) return false;
    dragRef.current = null;
    marqueeRef.current = null;
    // A cancelled drag must also remove the palette's trash-hover state.
    // Normal pointerup handles this already, but Escape, blur and document
    // changes all bypass the drop path.
    paletteRef.current?.classList?.remove("is-trash");
    setDrag(null);
    setMarquee(null);
    setActiveSlot(null);
    return true;
  }, [dragRef, marqueeRef, paletteRef, setDrag, setMarquee, setActiveSlot]);

  // ドラッグ（パレット → ワークスペース / ワークスペース内での移動）と範囲選択
  useEffect(() => {
    const inside = (el: HTMLElement | null, x: number, y: number) => {
      const r = el?.getBoundingClientRect();
      return !!r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    };
    let slotIndex: SlotIndex | null = null;
    let slotElements = new Map<string, HTMLElement>();
    let slotZoom = 0;
    let marqueeGesture: Marquee | null = null;
    let marqueeShown = false;
    let marqueeSelection = "";
    let marqueeRects: Array<{ key: string; left: number; right: number; top: number; bottom: number }> | null = null;

    // ドラッグ中にスクロールすると、仮想化したチャンクがマウント・アンマウントされることがある。
    // もう存在しない DOM ノードから測った当たり判定の座標は、使い回さない。
    const slotObserver = typeof MutationObserver === "undefined" ? null :
      new MutationObserver(() => {
        slotIndex = null;
        slotElements.clear();
        marqueeRects = null;
      });
    if (wsRef.current) slotObserver?.observe(wsRef.current, { subtree: true, childList: true });
    let animationFrame = 0;
    const cancelFrame = () => {
      if (animationFrame && typeof cancelAnimationFrame === "function") cancelAnimationFrame(animationFrame);
      animationFrame = 0;
    };

    const contentRect = (ws: HTMLDivElement) => ws.getBoundingClientRect();
    const findSlot = (d: Drag): string | null => {
      const ws = wsRef.current;
      if (!ws || !d.payload || !inside(ws, d.x, d.y)) return null;
      const kind = d.payload.type === "steps" ? "step" :
        d.payload.type === "trigger" ? "head" : null;
      if (!kind) return null;
      const z = zoomRef.current;
      const wr = contentRect(ws);
      if (!slotIndex || slotZoom !== z) {
        const slots: SlotPoint[] = [];
        slotElements = new Map();
        ws.querySelectorAll<HTMLElement>("[data-slot-kind]").forEach((el) => {
          const key = el.dataset.slot;
          const type = el.dataset.slotKind;
          if (!key || (type !== "step" && type !== "head")) return;
          slotElements.set(key, el);
          const r = el.getBoundingClientRect();
          slots.push({ key, kind: type, x: r.left - wr.left + ws.scrollLeft,
            y: r.top - wr.top + ws.scrollTop });
        });
        slotIndex = new SlotIndex(slots);
        slotZoom = z;
      }
      const x = d.x - d.ox * z - wr.left + ws.scrollLeft;
      // きっかけのブロックは下端で、通常の手順は上端でつなぐ。
      const y = d.y - d.oy * z + (kind === "head" ? d.h * z : 0) -
        wr.top + ws.scrollTop;
      return slotIndex.nearest(kind, x, y);
    };

    const marqueeHits = (m: Marquee): string[] => {
      const ws = wsRef.current;
      if (!ws) return [];
      const wr = contentRect(ws);
      if (!marqueeRects) {
        marqueeRects = [];
        ws.querySelectorAll<HTMLElement>("[data-sel-key]").forEach((el) => {
          const key = el.dataset.selKey;
          if (!key) return;
          const r = el.getBoundingClientRect();
          marqueeRects!.push({ key, left: r.left - wr.left + ws.scrollLeft,
            right: r.right - wr.left + ws.scrollLeft,
            top: r.top - wr.top + ws.scrollTop,
            bottom: r.bottom - wr.top + ws.scrollTop });
        });
      }
      const left = Math.min(m.x0, m.x) - wr.left + ws.scrollLeft;
      const right = Math.max(m.x0, m.x) - wr.left + ws.scrollLeft;
      const top = Math.min(m.y0, m.y) - wr.top + ws.scrollTop;
      const bottom = Math.max(m.y0, m.y) - wr.top + ws.scrollTop;
      return marqueeRects.filter((r) =>
        !(r.right < left || r.left > right || r.bottom < top || r.top > bottom)
      ).map((r) => r.key);
    };

    const positionGhost = (d: Drag) => {
      const el = ghostRef?.current;
      if (!el) return;
      el.style.transform = `translate3d(${d.x - d.ox * zoomRef.current}px, ${d.y - d.oy * zoomRef.current}px, 0)`;
    };
    const positionMarquee = (m: Marquee) => {
      const el = marqueeElRef?.current;
      if (!el) return;
      el.style.left = `${Math.min(m.x0, m.x)}px`;
      el.style.top = `${Math.min(m.y0, m.y)}px`;
      el.style.width = `${Math.abs(m.x - m.x0)}px`;
      el.style.height = `${Math.abs(m.y - m.y0)}px`;
    };
    const onMove = (e: PointerEvent) => {
      const gesture = marqueeRef.current ?? dragRef.current;
      if (!gesture || e.pointerId !== gesture.pointerId) return;
      // ウィンドウの外でボタンを離して pointerup を受け取れなかった場合も、取り消す。
      if (!(e.buttons & 1)) {
        cancelGesture();
        return;
      }
      const m = marqueeRef.current;
      if (m) {
        if (marqueeGesture !== m) {
          marqueeGesture = m;
          marqueeRects = null;
          marqueeShown = false;
          marqueeSelection = m.base.join("\\0");
        }
        m.x = e.clientX;
        m.y = e.clientY;
        if (!marqueeShown || (marqueeElRef && !marqueeElRef.current)) {
          setMarquee({ ...m });
          marqueeShown = true;
        } else {
          positionMarquee(m);
        }
        const hits = [...new Set([...m.base, ...marqueeHits(m)])];
        const signature = hits.join("\\0");
        if (signature !== marqueeSelection) {
          marqueeSelection = signature;
          setSelectedList(hits);
        }
        return;
      }
      const d = dragRef.current;
      if (!d) return;
      d.x = e.clientX;
      d.y = e.clientY;
      if (!d.started) {
        if (Math.hypot(d.x - d.sx, d.y - d.sy) < 4) return;
        d.started = true;
        d.payload = d.make();
        slotIndex = null;
        slotElements.clear();
        setMenu(null);
        setActiveSlot(null);
        // 最初の描画でゴーストを作り、ドラッグしているブロックを取り除く。
        setDrag({ ...d });
        return;
      }
      // pointermove は、ブラウザが描画できるよりはるかに頻繁に発生することがある。
      // レイアウトの読み取りと当たり判定は、1フレームにまとめて行う。
      const updatePosition = () => {
        const active = dragRef.current;
        if (!active?.started || !active.payload) return;
        positionGhost(active);
        paletteRef.current?.classList?.toggle("is-trash",
          inside(paletteRef.current, active.x, active.y));
        const target = findSlot(active);
        setActiveSlot(target, target ? slotElements.get(target) : null);
      };
      if (typeof requestAnimationFrame !== "function") {
        // ブラウザ以外のテスト環境では、合成したポインターのイベントが同期的に送られる。
        updatePosition();
      } else if (!animationFrame) {
        animationFrame = requestAnimationFrame(() => {
          animationFrame = 0;
          updatePosition();
        });
      }
    };
    const onUp = (e: PointerEvent) => {
      const gesture = marqueeRef.current ?? dragRef.current;
      if (!gesture || e.pointerId !== gesture.pointerId) return;
      cancelFrame();
      if (marqueeRef.current) {
        marqueeRef.current = null;
        marqueeGesture = null;
        marqueeRects = null;
        setMarquee(null);
        return;
      }
      const d = dragRef.current;
      dragRef.current = null;
      if (d) {
        d.x = e.clientX;
        d.y = e.clientY;
      }
      // 最後のドロップには、すでに測った差し込み位置の索引を使う。この検索の前に索引を作り直すと、
      // ボタンを離したときに DOM 全体を同期的に測ることになっていた。
      const slot = d?.started && d.payload ? findSlot(d) : null;
      slotIndex = null;
      slotElements.clear();
      paletteRef.current?.classList?.remove("is-trash");
      setDrag(null);
      setActiveSlot(null);
      if (d && !d.started && d.clickKey) setSelectedList([d.clickKey]);
      if (!d?.started || !d.payload) return;
      drop(d, d.payload, slot);
    };
    const drop = (d: Drag, p: Payload, slot: string | null) => {
      const { scripts: cur, commit, focusNodeId: focus } = latest.current;
      const ws = wsRef.current;
      let base = cur;
      if (p.type === "steps" && p.from) base = p.from.remaining;
      if (p.type === "script") {
        const ids = new Set(p.group.map((s) => s.id));
        base = cur.filter((s) => !ids.has(s.id));
      }

      // パレットに戻したら削除する
      if (inside(paletteRef.current, d.x, d.y)) {
        if (base !== cur) {
          commit(base);
          setSelectedList([]);
        }
        return;
      }
      if (slot) {
        if (p.type === "steps" && p.from && slot === slotKey(p.from.loc)) return;
        const loc = parseSlot(slot);
        if (p.type === "steps") {
          // 直前の出力を自動で受け継ぐのは、新しく挿入したブロックだけ。
          // 既存のつながりを動かしたときは、明示的な変数の参照をすべてそのまま残す。
          const nextSteps = p.from ? p.steps : connectNewTransform(base, loc, p.steps);
          const inserted = insertAt(base, loc, nextSteps);
          // 取り除いた部分木の中の差し込み位置は、もう有効なドロップ先ではない。
          // その場合は、元の文書と元に戻す履歴をそのまま残す。
          if (inserted === base) return;
          return commit(inserted);
        }
        if (p.type === "trigger") {
          return commit(
            base.map((s) =>
              s.id === loc.scriptId
                ? {
                    ...s,
                    trigger: p.trigger,
                    // 「このページ」のきっかけは「ページを開いたとき」だけ
                    nodeId:
                      s.nodeId === PAGE_TARGET && p.trigger !== "load"
                        ? focus
                        : (s.nodeId ?? focus),
                  }
                : s
            )
          );
        }
      }
      // ワークスペースの外で離したら取り消す
      if (!ws || !inside(ws, d.x, d.y)) return;
      const wr = ws.getBoundingClientRect();
      // 位置は、倍率が 1 のときの座標で持つ
      const z = zoomRef.current;
      const pos = {
        x: Math.max(8, Math.round((d.x - d.ox * z - wr.left + ws.scrollLeft) / z)),
        y: Math.max(8, Math.round((d.y - d.oy * z - wr.top + ws.scrollTop) / z)),
      };
      if (p.type === "trigger") {
        return commit([
          ...base,
          { id: scriptUid(), nodeId: focus, trigger: p.trigger, steps: [], pos },
        ]);
      }
      if (p.type === "steps") {
        // パレットから置いたデータの読み込みは、「このページ｜ページを開いたとき」の下に置く
        const loadOnly = !p.from && p.steps.every(isDataStep);
        return commit([
          ...base,
          loadOnly
            ? { id: scriptUid(), nodeId: PAGE_TARGET, trigger: "load", steps: p.steps, pos }
            : { id: scriptUid(), nodeId: null, steps: p.steps, pos },
        ]);
      }
      // 選択中のスクリプトをまとめて同じだけ動かす
      let dx = pos.x - p.script.pos.x;
      let dy = pos.y - p.script.pos.y;
      const ids = new Set<string>();
      for (const script of p.group) {
        ids.add(script.id);
        dx = Math.max(dx, 8 - script.pos.x);
        dy = Math.max(dy, 8 - script.pos.y);
      }
      if (!dx && !dy) return;
      commit(
        cur.map((s) =>
          ids.has(s.id)
            ? {
                ...s,
                pos: {
                  x: s.pos.x + dx,
                  y: s.pos.y + dy,
                },
              }
            : s
        )
      );
    };
    const onCancel = (e: PointerEvent) => {
      const gesture = marqueeRef.current ?? dragRef.current;
      if (gesture?.pointerId === e.pointerId) cancelGesture();
    };
    const onHidden = () => {
      if (document.visibilityState === "hidden") cancelGesture();
    };
    // 元に戻す操作・ページの切り替え・外部での編集の後に、古いペイロードを新しい文書へドロップしない。
    const unsubscribe = useEditor.subscribe((state, previous) => {
      if (
        state.doc !== previous.doc ||
        state.activePageId !== previous.activePageId ||
        state.editingComponentId !== previous.editingComponentId ||
        state.historyRevision !== previous.historyRevision
      ) cancelGesture();
    });
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("blur", cancelGesture);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("blur", cancelGesture);
      document.removeEventListener("visibilitychange", onHidden);
      slotObserver?.disconnect();
      cancelFrame();
      unsubscribe();
      cancelGesture();
    };
  }, [cancelGesture]);

  return cancelGesture;
}
