"use client";

/**
 * スクリプト画面のドラッグ（パレット → ワークスペース / ワークスペース内の移動）と範囲選択
 */
import { useCallback, useEffect, type Dispatch, type RefObject, type SetStateAction } from "react";
import { useEditor } from "../../lib/store";
import { scriptUid, type PageScript } from "../../lib/script";
import { isDataStep } from "../../lib/data";
import { PAGE_TARGET } from "../../lib/types";
import { type Payload } from "./palette";
import { connectNewTransform, insertAt, parseSlot, takeAt } from "./step-tree";
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
  setActiveSlot: (key: string | null) => void;
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
  // 中断はドロップにしない。元のブロックと履歴をそのまま残す。
  const cancelGesture = useCallback(() => {
    if (!dragRef.current && !marqueeRef.current) return false;
    dragRef.current = null;
    marqueeRef.current = null;
    setDrag(null);
    setMarquee(null);
    setActiveSlot(null);
    return true;
  }, [dragRef, marqueeRef, setDrag, setMarquee, setActiveSlot]);

  // ドラッグ（パレット → ワークスペース / ワークスペース内の移動）と範囲選択
  useEffect(() => {
    const inside = (el: HTMLElement | null, x: number, y: number) => {
      const r = el?.getBoundingClientRect();
      return !!r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    };
    let slotIndex: SlotIndex | null = null;
    let slotZoom = 0;
    let marqueeGesture: Marquee | null = null;
    let marqueeShown = false;
    let marqueeSelection = "";
    let marqueeRects: Array<{ key: string; left: number; right: number; top: number; bottom: number }> | null = null;

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
        ws.querySelectorAll<HTMLElement>("[data-slot-kind]").forEach((el) => {
          const key = el.dataset.slot;
          const type = el.dataset.slotKind;
          if (!key || (type !== "step" && type !== "head")) return;
          const r = el.getBoundingClientRect();
          slots.push({ key, kind: type, x: r.left - wr.left + ws.scrollLeft,
            y: r.top - wr.top + ws.scrollTop });
        });
        slotIndex = new SlotIndex(slots);
        slotZoom = z;
      }
      const x = d.x - d.ox * z - wr.left + ws.scrollLeft;
      // Triggers attach by their bottom edge; ordinary steps by the top.
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
      el.style.left = `${d.x - d.ox * zoomRef.current}px`;
      el.style.top = `${d.y - d.oy * zoomRef.current}px`;
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
      // ウィンドウ外で離して pointerup を受け取れなかった場合も取り消す。
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
        setMenu(null);
        setActiveSlot(null);
        // The initial render creates the ghost and removes the dragged blocks.
        setDrag({ ...d });
        return;
      }
      positionGhost(d);
      paletteRef.current?.classList?.toggle("is-trash", inside(paletteRef.current, d.x, d.y));
      setActiveSlot(findSlot(d));
    };
    const onUp = (e: PointerEvent) => {
      const gesture = marqueeRef.current ?? dragRef.current;
      if (!gesture || e.pointerId !== gesture.pointerId) return;
      if (marqueeRef.current) {
        marqueeRef.current = null;
        marqueeGesture = null;
        marqueeRects = null;
        setMarquee(null);
        return;
      }
      const d = dragRef.current;
      dragRef.current = null;
      slotIndex = null;
      paletteRef.current?.classList?.remove("is-trash");
      setDrag(null);
      setActiveSlot(null);
      if (d && !d.started && d.clickKey) setSelectedList([d.clickKey]);
      if (!d?.started || !d.payload) return;
      d.x = e.clientX;
      d.y = e.clientY;
      const slot = findSlot(d);
      drop(d, d.payload, slot);
    };
    const drop = (d: Drag, p: Payload, slot: string | null) => {
      const { scripts: cur, commit, focusNodeId: focus } = latest.current;
      const ws = wsRef.current;
      let base = cur;
      if (p.type === "steps" && p.from) base = takeAt(cur, p.from)[0];
      if (p.type === "script") {
        const ids = new Set(p.group.map((s) => s.id));
        base = cur.filter((s) => !ids.has(s.id));
      }

      // パレットへ戻したら削除
      if (inside(paletteRef.current, d.x, d.y)) {
        if (base !== cur) {
          commit(base);
          setSelectedList([]);
        }
        return;
      }
      if (slot) {
        const loc = parseSlot(slot);
        if (p.type === "steps") {
          // Only newly inserted blocks inherit the previous output automatically.
          // Moving an existing chain preserves all explicit variable references.
          const nextSteps = p.from ? p.steps : connectNewTransform(base, loc, p.steps);
          const inserted = insertAt(base, loc, nextSteps);
          // A slot in the removed subtree is no longer a valid destination.
          // Preserve the original document and undo history in that case.
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
                    // 「このページ」は「ページを開いたとき」だけ
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
      // ワークスペースの外で離したら取り消し
      if (!ws || !inside(ws, d.x, d.y)) return;
      const wr = ws.getBoundingClientRect();
      // 位置は倍率 1 のときの座標で持つ
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
        // パレットから置いたデータの読み込みは「このページ｜ページを開いたとき」として置く
        const loadOnly = !p.from && p.steps.every(isDataStep);
        return commit([
          ...base,
          loadOnly
            ? { id: scriptUid(), nodeId: PAGE_TARGET, trigger: "load", steps: p.steps, pos }
            : { id: scriptUid(), nodeId: null, steps: p.steps, pos },
        ]);
      }
      // 選択中のスクリプトをまとめて同じだけ動かす
      const dx = pos.x - p.script.pos.x;
      const dy = pos.y - p.script.pos.y;
      const ids = new Set(p.group.map((s) => s.id));
      commit(
        cur.map((s) =>
          ids.has(s.id)
            ? {
                ...s,
                pos: {
                  x: Math.max(8, s.pos.x + dx),
                  y: Math.max(8, s.pos.y + dy),
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
    // Undo・ページ切替・外部の編集後に、古いペイロードを新しい文書へ落とさない。
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
      unsubscribe();
      cancelGesture();
    };
  }, [cancelGesture]);

  return cancelGesture;
}
