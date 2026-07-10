"use client";

/**
 * キャンバス上のドラッグ操作（要素の移動・大きさの変更）と、ファイル・追加パネルからのドロップ
 */
import { useLayoutEffect, useRef, type Dispatch, type RefObject, type SetStateAction } from "react";
import { collectDescendants, findParentOf, useEditor, type EditorMode, type ParentRef } from "../../lib/store";
import { canvasFallbackDrop } from "../../lib/canvas-drop";
import { ELEMENT_DRAG_TYPE, makeElementByKey, normalizeMade } from "../../lib/elements";
import { ASSET_DRAG_TYPE, assetKind, nodeAssetSrc } from "../../lib/assets";
import { useImageDrop } from "../../lib/image-drop";
import { makeImage } from "../../lib/presets";
import { canContainElements } from "../../lib/tags";
import type { Component, DocNode, SiteDoc } from "../../lib/types";

/** Canvas から受け取る値 */
export interface UseCanvasDragDeps {
  innerRef: RefObject<HTMLDivElement | null>;
  doc: SiteDoc;
  editingComp: Component | null | undefined;
  activePageId: string;
  mode: EditorMode;
  editingText: string | null;
  moveState: RefObject<{ pointerId: number; startX: number; startY: number; id: string; ids: string[]; active: boolean } | null>;
  select: (id: string | null) => void;
  moveDropRef: RefObject<{ parent: ParentRef; index: number } | null>;
  setMoveDrag: Dispatch<SetStateAction<{ dragIds: string[]; line: { left: number; top: number; width: number; height: number } | null; insideId: string | null } | null>>;
  movedJustNow: RefObject<boolean>;
  selection: string | null;
  frameRef: RefObject<HTMLDivElement | null>;
  scale: number;
  setStyleProps: (nodeId: string, props: Record<string, string | null>, opts?: { transient?: boolean }) => void;
  setDropState: Dispatch<SetStateAction<"none" | "over">>;
  insertNodes: (nodes: DocNode[], rootId: string, parent: ParentRef, index?: number) => void;
  elemDropTarget: string | null;
  setElemDropTarget: Dispatch<SetStateAction<string | null>>;
  dropState: "none" | "over";
}

export function useCanvasDrag({
  innerRef,
  doc,
  editingComp,
  activePageId,
  mode,
  editingText,
  moveState,
  select,
  moveDropRef,
  setMoveDrag,
  movedJustNow,
  selection,
  frameRef,
  scale,
  setStyleProps,
  setDropState,
  insertNodes,
  elemDropTarget,
  setElemDropTarget,
  dropState,
}: UseCanvasDragDeps) {
  // リサイズハンドル
  const resizing = useRef(false);
  const resizeCleanup = useRef<(() => void) | null>(null);
  const moveCleanup = useRef<(() => void) | null>(null);
  useLayoutEffect(() => () => {
    resizeCleanup.current?.();
    moveCleanup.current?.();
  }, []);

  /** キャンバス内ドラッグ移動: ドロップ先（前/後/中）を解決 */
  const resolveMoveDrop = (x: number, y: number, dragIds: string[]) => {
    const inner = innerRef.current;
    if (!inner) return null;
    const innerRect = inner.getBoundingClientRect();
    const descendants = new Set(dragIds.flatMap((id) => collectDescendants(doc, id)));
    let el: Element | null =
      document.elementFromPoint(x, y)?.closest("[data-node]") ?? null;
    while (el && descendants.has(el.getAttribute("data-node")!)) {
      el = el.parentElement?.closest("[data-node]") ?? null;
    }
    if (!el) {
      return {
        ...canvasFallbackDrop(doc, editingComp, activePageId),
        line: null,
        insideId: null,
      };
    }
    const targetId = el.getAttribute("data-node")!;
    const node = doc.nodes[targetId];
    const r = el.getBoundingClientRect();
    const ratioY = (y - r.top) / Math.max(1, r.height);
    const canInside = !!node && canContainElements(node);
    if (canInside && ratioY > 0.3 && ratioY < 0.7) {
      return {
        parent: { kind: "node", id: targetId } as ParentRef,
        index: node.children.length,
        line: null,
        insideId: targetId,
      };
    }
    const parent = findParentOf(doc, targetId);
    if (!parent) return null;
    const list =
      parent.kind === "page"
        ? doc.pages[parent.id].children
        : doc.nodes[parent.id].children;
    // 親が横並び（flex-row）なら左右、それ以外は上下で挿入位置を決める
    const parentEl = el.parentElement;
    const pcs = parentEl ? getComputedStyle(parentEl) : null;
    const isRow =
      !!pcs && pcs.display.includes("flex") && pcs.flexDirection.startsWith("row");
    const after = isRow
      ? (x - r.left) / Math.max(1, r.width) >= 0.5
      : ratioY >= 0.5;
    const index = list.indexOf(targetId) + (after ? 1 : 0);
    const line = isRow
      ? {
          left: (after ? r.right : r.left) - innerRect.left - 1.5,
          top: r.top - innerRect.top,
          width: 3,
          height: r.height,
        }
      : {
          left: r.left - innerRect.left,
          top: (after ? r.bottom : r.top) - innerRect.top - 1.5,
          width: r.width,
          height: 3,
        };
    return { parent, index, line, insideId: null };
  };

  /** キャンバス内の要素をドラッグで移動（6px動いたらドラッグ開始） */
  const onCvPointerDown = (e: React.PointerEvent) => {
    if (mode !== "design" || editingText || e.button !== 0) return;
    // 別の指では進行中の移動を奪わない。同じポインターの新しい操作なら前の操作を片付ける。
    if (moveState.current && moveState.current.pointerId !== e.pointerId) return;
    moveCleanup.current?.();
    const el = (e.target as Element).closest("[data-node]");
    if (!el) return;
    const id = el.getAttribute("data-node")!;
    const node = doc.nodes[id];
    if (!node || node.locked) return;
    // 複数選んでいる要素の1つをつかんだら、選んでいる要素をまとめて動かす（レイヤーと同じ）
    const selected = useEditor.getState().selectedIds;
    const ids =
      selected.length > 1 && selected.includes(id) && !e.shiftKey
        ? selected.filter((x) => doc.nodes[x] && !doc.nodes[x].locked)
        : [id];
    moveState.current = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, id, ids, active: false };
    const initial = useEditor.getState();
    let expectedSelection = initial.selectedIds;
    let expectedPrimary = initial.selection;
    let expectedStyleState = initial.styleState;
    let selecting = false;

    const onMove = (ev: PointerEvent) => {
      const st = moveState.current;
      if (!st || ev.pointerId !== st.pointerId) return;
      // ウィンドウの外でボタンを離した（pointerup が届かない）ときは、移動せずに終える
      if (!(ev.buttons & 1)) {
        finish();
        return;
      }
      if (!st.active) {
        if (Math.hypot(ev.clientX - st.startX, ev.clientY - st.startY) < 6) {
          return;
        }
        st.active = true;
        if (st.ids.length === 1) {
          selecting = true;
          select(st.id);
          selecting = false;
          if (moveState.current !== st) return;
        }
      }
      ev.preventDefault();
      const res = resolveMoveDrop(ev.clientX, ev.clientY, st.ids);
      moveDropRef.current = res
        ? { parent: res.parent, index: res.index }
        : null;
      setMoveDrag({
        dragIds: st.ids,
        line: res?.line ?? null,
        insideId: res?.insideId ?? null,
      });
    };
    const finish = (ev?: PointerEvent) => {
      if (ev && ev.pointerId !== e.pointerId) return;
      if (moveCleanup.current !== finish) return;
      moveCleanup.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("visibilitychange", onVisibility);
      unsubscribe();
      const st = moveState.current;
      moveState.current = null;
      const drop = st?.active && ev?.type === "pointerup"
        ? resolveMoveDrop(ev.clientX, ev.clientY, st.ids) : null;
      moveDropRef.current = null;
      setMoveDrag(null);
      if (st?.active) {
        movedJustNow.current = true;
        setTimeout(() => { movedJustNow.current = false; }, 0);
        if (drop) useEditor.getState().moveNodes(st.ids, drop.parent, drop.index);
      }
    };
    const cancel = () => finish();
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      ev.preventDefault();
      ev.stopPropagation();
      finish();
    };
    const onVisibility = () => { if (document.visibilityState === "hidden") finish(); };
    const unsubscribe = useEditor.subscribe((next) => {
      if (selecting) {
        // ドラッグ開始時の select は選択と表示状態を初期化するため、自分の変更だけ受け入れる。
        expectedSelection = next.selectedIds;
        expectedPrimary = next.selection;
        expectedStyleState = next.styleState;
      }
      // 確定前の移動は文書を書き換えない。Undo・共同編集・画面変更後の古いdropは捨てる。
      if (next.doc !== initial.doc || next.historyRevision !== initial.historyRevision ||
          next.activePageId !== initial.activePageId || next.editingComponentId !== initial.editingComponentId ||
          next.mode !== initial.mode || next.breakpoint !== initial.breakpoint || next.styleState !== expectedStyleState ||
          next.editingText !== initial.editingText || next.selection !== expectedPrimary ||
          next.selectedIds !== expectedSelection) finish();
    });
    moveCleanup.current = finish;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    window.addEventListener("blur", cancel);
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("visibilitychange", onVisibility);
  };

  const startResize = (e: React.PointerEvent, dir: string) => {
    resizeCleanup.current?.();
    if (!selection) return;
    e.preventDefault();
    e.stopPropagation();
    const el = frameRef.current?.querySelector(
      `[data-node="${selection}"]`
    ) as HTMLElement | null;
    if (!el) return;
    resizing.current = true;
    const initial = useEditor.getState();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = el.offsetWidth;
    const startH = el.offsetHeight;
    // 左・上のハンドルはドラッグ方向を反転（外側へ引くと拡大）
    const xSign = dir.includes("w") ? -1 : dir.includes("e") ? 1 : 0;
    const ySign = dir.includes("n") ? -1 : dir.includes("s") ? 1 : 0;
    let started = false;
    let finishGesture: (() => void) | undefined;
    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      // ウィンドウの外でボタンを離すと pointerup が届かないので、押していなければ終える
      if (!(ev.buttons & 1)) {
        onUp();
        return;
      }
      const dx = ((ev.clientX - startX) / scale) * xSign;
      const dy = ((ev.clientY - startY) / scale) * ySign;
      const props: Record<string, string> = {};
      if (xSign !== 0) props.width = `${Math.max(4, Math.round(startW + dx))}px`;
      if (ySign !== 0) props.height = `${Math.max(4, Math.round(startH + dy))}px`;
      if (ev.shiftKey && xSign !== 0 && ySign !== 0) {
        // Shift: 比率固定（幅基準）
        const w = Math.max(4, Math.round(startW + dx));
        props.width = `${w}px`;
        props.height = `${Math.max(4, Math.round((w / startW) * startH))}px`;
      }
      if (!started) {
        started = true;
        finishGesture = useEditor.getState().beginGesture();
      }
      setStyleProps(selection, props, { transient: true });
    };
    const onUp = (ev?: Event) => {
      if (ev && "pointerId" in ev && ev.pointerId !== e.pointerId) return;
      if (resizeCleanup.current !== onUp) return;
      resizeCleanup.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      window.removeEventListener("blur", onUp);
      target.removeEventListener("lostpointercapture", onUp);
      unsubscribe();
      if (target.hasPointerCapture?.(e.pointerId)) target.releasePointerCapture(e.pointerId);
      finishGesture?.();
      // ドラッグ終端の合成クリック（選択解除判定）が済んでから解除
      setTimeout(() => {
        if (!resizeCleanup.current) resizing.current = false;
      }, 0);
    };
    const unsubscribe = useEditor.subscribe((next) => {
      if (next.selection !== initial.selection || next.selectedIds !== initial.selectedIds ||
          next.activePageId !== initial.activePageId || next.editingComponentId !== initial.editingComponentId ||
          next.breakpoint !== initial.breakpoint || next.styleState !== initial.styleState ||
          next.mode !== initial.mode || next.historyRevision !== initial.historyRevision) onUp();
    });
    resizeCleanup.current = onUp;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    window.addEventListener("blur", onUp);
    target.addEventListener("lostpointercapture", onUp);
  };

  const { uploading, dropFiles } = useImageDrop();

  /** 要素D&D: ドロップ先（中に入れられるbox / 兄弟挿入の基準）を解決 */
  const resolveElementDrop = (
    target: Element
  ): { parent: ParentRef; index?: number; highlight: string | null } => {
    const el = target.closest("[data-node]");
    const fallback: ParentRef = editingComp
      ? { kind: "node", id: editingComp.rootId }
      : { kind: "page", id: activePageId };
    if (!el) return { parent: fallback, highlight: null };
    const nodeId = el.getAttribute("data-node")!;
    const node = doc.nodes[nodeId];
    if (node && canContainElements(node)) {
      return { parent: { kind: "node", id: nodeId }, highlight: nodeId };
    }
    const parent = findParentOf(doc, nodeId);
    if (!parent) return { parent: fallback, highlight: null };
    const list =
      parent.kind === "page"
        ? doc.pages[parent.id].children
        : doc.nodes[parent.id].children;
    return {
      parent,
      index: list.indexOf(nodeId) + 1,
      highlight: parent.kind === "node" ? parent.id : null,
    };
  };

  const dropHandlers =
    mode === "design"
      ? {
          onDragOver: (e: React.DragEvent) => {
            if (
              e.dataTransfer.types.includes(ELEMENT_DRAG_TYPE) ||
              e.dataTransfer.types.includes(ASSET_DRAG_TYPE)
            ) {
              e.preventDefault();
              e.dataTransfer.dropEffect = "copy";
              const { highlight } = resolveElementDrop(e.target as Element);
              if (elemDropTarget !== highlight) setElemDropTarget(highlight);
              return;
            }
            if (e.dataTransfer.types.includes("Files")) {
              e.preventDefault();
              if (dropState === "none") setDropState("over");
              // 画像を入れる先（ボックス）を、要素のドラッグと同じように示す
              const { highlight } = resolveElementDrop(e.target as Element);
              if (elemDropTarget !== highlight) setElemDropTarget(highlight);
            }
          },
          onDragLeave: (e: React.DragEvent) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) {
              if (dropState === "over") setDropState("none");
              if (elemDropTarget) setElemDropTarget(null);
            }
          },
          onDrop: (e: React.DragEvent) => {
            const assetId = e.dataTransfer.getData(ASSET_DRAG_TYPE);
            if (assetId) {
              e.preventDefault();
              setElemDropTarget(null);
              const asset = doc.assets[assetId];
              if (!asset || assetKind(asset) !== "image") return;
              const node = makeImage();
              node.name = asset.name;
              node.image = {
                src: nodeAssetSrc(asset),
                alt: "",
                width: asset.width,
                height: asset.height,
                assetId: asset.id,
              };
              const { parent, index } = resolveElementDrop(e.target as Element);
              insertNodes([node], node.id, parent, index);
              return;
            }
            const elementKey = e.dataTransfer.getData(ELEMENT_DRAG_TYPE);
            if (elementKey) {
              e.preventDefault();
              setElemDropTarget(null);
              const made = makeElementByKey(elementKey);
              if (!made) return;
              const { root, nodes } = normalizeMade(made);
              const { parent, index } = resolveElementDrop(e.target as Element);
              insertNodes(nodes, root.id, parent, index);
              return;
            }
            if (e.dataTransfer.files.length) {
              e.preventDefault();
              setElemDropTarget(null);
              // 落とした要素の中（入れられないなら後ろ）。何もない所ならページ・編集中のコンポーネントの末尾
              const { parent, index } = resolveElementDrop(e.target as Element);
              setDropState("none");
              void dropFiles(e.dataTransfer.files, { parent, index });
            } else {
              setDropState("none");
            }
          },
        }
      : {};

  return { resizing, onCvPointerDown, startResize, dropHandlers, uploading };
}
