"use client";

/**
 * スクリプト画面のドラッグ（パレット → ワークスペース / ワークスペース内の移動）と範囲選択
 */
import { useEffect, type Dispatch, type RefObject, type SetStateAction } from "react";
import { scriptUid, type PageScript } from "../../lib/script";
import { isDataStep } from "../../lib/data";
import { PAGE_TARGET } from "../../lib/types";
import { type Payload } from "./palette";
import { insertAt, parseSlot, takeAt } from "./step-tree";
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
  setActiveSlot: Dispatch<SetStateAction<string | null>>;
  setDrag: Dispatch<SetStateAction<Drag | null>>;
  latest: RefObject<ScriptEditorLatest>;
  paletteRef: RefObject<HTMLDivElement | null>;
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
}: UseScriptDragDeps) {
  // ドラッグ（パレット → ワークスペース / ワークスペース内の移動）と範囲選択
  useEffect(() => {
    const inside = (el: HTMLElement | null, x: number, y: number) => {
      const r = el?.getBoundingClientRect();
      return !!r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    };
    const findSlot = (d: Drag): string | null => {
      const ws = wsRef.current;
      if (!ws || !d.payload || !inside(ws, d.x, d.y)) return null;
      const kind =
        d.payload.type === "steps"
          ? "step"
          : d.payload.type === "trigger"
            ? "head"
            : null;
      if (!kind) return null;
      const z = zoomRef.current;
      const gx = d.x - d.ox * z;
      // きっかけはブロックの下端を、動作は上端を差し込み位置に合わせる
      const gy = d.y - d.oy * z + (kind === "head" ? d.h * z : 0);
      let best: string | null = null;
      let bestDist = Infinity;
      ws.querySelectorAll<HTMLElement>(`[data-slot-kind="${kind}"]`).forEach(
        (el) => {
          const r = el.getBoundingClientRect();
          const dx = gx - r.left;
          const dy = gy - r.top;
          if (Math.abs(dx) > 80 || Math.abs(dy) > 28) return;
          const dist = Math.hypot(dx, dy * 2);
          if (dist < bestDist) {
            bestDist = dist;
            best = el.dataset.slot ?? null;
          }
        }
      );
      return best;
    };
    const marqueeHits = (m: Marquee): string[] => {
      const left = Math.min(m.x0, m.x);
      const right = Math.max(m.x0, m.x);
      const top = Math.min(m.y0, m.y);
      const bottom = Math.max(m.y0, m.y);
      const hits: string[] = [];
      wsRef.current
        ?.querySelectorAll<HTMLElement>("[data-sel-key]")
        .forEach((el) => {
          const r = el.getBoundingClientRect();
          if (r.right < left || r.left > right || r.bottom < top || r.top > bottom) {
            return;
          }
          hits.push(el.dataset.selKey!);
        });
      return hits;
    };
    const onMove = (e: PointerEvent) => {
      const m = marqueeRef.current;
      if (m) {
        m.x = e.clientX;
        m.y = e.clientY;
        setMarquee({ ...m });
        setSelectedList([...new Set([...m.base, ...marqueeHits(m)])]);
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
        setMenu(null);
      }
      setActiveSlot(findSlot(d));
      setDrag({ ...d });
    };
    const onUp = () => {
      if (marqueeRef.current) {
        marqueeRef.current = null;
        setMarquee(null);
        return;
      }
      const d = dragRef.current;
      dragRef.current = null;
      if (d && !d.started && d.clickKey) setSelectedList([d.clickKey]);
      if (!d?.started || !d.payload) return;
      const slot = findSlot(d);
      setDrag(null);
      setActiveSlot(null);
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
        if (p.type === "steps") return commit(insertAt(base, loc, p.steps));
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
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, []);
}
