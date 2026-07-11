/**
 * レイヤー・ページの並べ替えのドラッグ（差し込み位置の計算と自動スクロール）
 */

import { useEffect, useRef } from "react";
import { findParentOf, type ParentRef } from "../../lib/store";
import { type SiteDoc } from "../../lib/types";

/* ============ レイヤー ============ */

/** start = 展開中のコンテナの直下（先頭の子の前）、inside = コンテナの末尾 */
export type DropPos = "before" | "after" | "start" | "inside";

export interface DragState {
  /** ドラッグ中の要素（複数選択ごと動かすときは全部） */
  dragIds: string[];
  /** ドラッグ中の要素とその子孫（そこへは落とせない） */
  blockedIds: string[];
  overId: string | null;
  pos: DropPos | null;
  /** OSからファイル（画像）をドラッグ中 */
  files?: boolean;
}

export const NO_DRAG: DragState = { dragIds: [], blockedIds: [], overId: null, pos: null };

export const isFileDrag = (e: React.DragEvent) => e.dataTransfer.types.includes("Files");

/**
 * ドラッグ中に上下の端へ近づくと、スクロールする。
 * dragover は止まっていても一定間隔で届くので、届かなくなったら（外へ出た・落とした）止める
 */
export function useDragAutoScroll() {
  const state = useRef({ y: 0, last: 0, raf: 0, el: null as HTMLElement | null });
  useEffect(() => () => cancelAnimationFrame(state.current.raf), []);
  const tick = () => {
    const s = state.current;
    s.raf = 0;
    if (!s.el || performance.now() - s.last > 150) return;
    const r = s.el.getBoundingClientRect();
    // 端からの距離が近いほど速く（最大 14px / フレーム）
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

/** 行に対するドロップ位置 → 挿入先 */
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

export interface InsertPoint {
  parent: ParentRef;
  index?: number;
}
