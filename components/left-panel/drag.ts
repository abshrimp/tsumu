/**
 * レイヤーとページの並べ替えのドラッグ（差し込み位置の計算と自動スクロール）
 */

import { useEffect, useRef } from "react";
import { findParentOf, type ParentRef } from "../../lib/store";
import { type SiteDoc } from "../../lib/types";

/* ============ レイヤー ============ */

/** start = 展開中のコンテナの直下（先頭の子の前）、inside = コンテナの末尾 */
export type DropPos = "before" | "after" | "start" | "inside";

export interface DragState {
  /** ドラッグ中の要素（複数選択をまとめて動かすときは、そのすべて） */
  dragIds: string[];
  /** ドラッグ中の要素とその子孫（そこにはドロップできない） */
  blockedIds: ReadonlySet<string>;
  overId: string | null;
  pos: DropPos | null;
  /** OS からファイル（画像）をドラッグしている */
  files?: boolean;
}

export const NO_DRAG: DragState = { dragIds: [], blockedIds: new Set(), overId: null, pos: null };

export const isFileDrag = (e: React.DragEvent) => e.dataTransfer.types.includes("Files");

/**
 * ドラッグ中に上下の端に近づくと、スクロールする。
 * dragover は止まっていても一定の間隔で届くため、届かなくなったら（外へ出た・ドロップした）止める
 */
export function useDragAutoScroll() {
  const state = useRef({ y: 0, last: 0, raf: 0, el: null as HTMLElement | null });
  useEffect(() => () => cancelAnimationFrame(state.current.raf), []);
  const tick = () => {
    const s = state.current;
    s.raf = 0;
    if (!s.el || performance.now() - s.last > 150) return;
    const r = s.el.getBoundingClientRect();
    // 端に近いほど速くする（最大で 14px / フレーム）
    const EDGE = 48;
    const MAX = 14;
    const top = s.y - r.top;
    const bottom = r.bottom - s.y;
    const dy =
      top < EDGE ? -MAX * (1 - Math.max(0, top) / EDGE) : bottom < EDGE ? MAX * (1 - Math.max(0, bottom) / EDGE) : 0;
    if (dy) s.el.scrollTop += dy;
    s.raf = requestAnimationFrame(tick);
  };
  return (e: React.DragEvent<HTMLElement>) => {
    const s = state.current;
    s.el = e.currentTarget;
    s.y = e.clientY;
    s.last = performance.now();
    if (!s.raf) s.raf = requestAnimationFrame(tick);
  };
}

/** 行に対するドロップの位置 → 挿入先 */
export function layerDropPoint(
  doc: SiteDoc,
  id: string,
  pos: DropPos
): { parent: ParentRef; index: number } | null {
  const node = doc.nodes[id];
  if (!node) return null;
  if (pos === "inside") return { parent: { kind: "node", id }, index: node.children.length };
  if (pos === "start") return { parent: { kind: "node", id }, index: 0 };
  const parent = findParentOf(doc, id);
  if (!parent) return null;
  const list =
    parent.kind === "page"
      ? doc.pages[parent.id].children
      : doc.nodes[parent.id].children;
  return { parent, index: list.indexOf(id) + (pos === "after" ? 1 : 0) };
}

/** レイヤー行の字下げ（px） */
export const layerIndent = (depth: number) => 8 + depth * 14;

