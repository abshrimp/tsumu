"use client";

/**
 * 動作のカードの操作部品以外をドラッグして並べ替える。
 * つかんだカードそのものを持ち上げて動かし（複製は作らない）、落ちる位置は線で示す。
 * 並びを実際に変えるのは、離したときの1回だけ。
 */

import { useCallback, useEffect, useRef, type RefObject } from "react";
import type { PageScript } from "../../lib/script";
import { tr } from "../../lib/i18n";
import { moveSteps, type Loc } from "./step-tree";

interface DropTarget {
  list: string;
  beforeId: string | null;
}

interface DragState {
  pointerId: number;
  surface: HTMLElement;
  card: HTMLElement;
  loc: Loc;
  stepId: string;
  ids: Set<string>;
  started: boolean;
  startX: number;
  startY: number;
  x: number;
  y: number;
  startScroll: number;
  target: DropTarget | null;
  frame: number;
  lastFrame: number;
}

interface StepDragDeps {
  rootRef: RefObject<HTMLElement | null>;
  flowRef: RefObject<HTMLElement | null>;
  lineRef: RefObject<HTMLElement | null>;
  getScripts: () => PageScript[];
  getSelected: () => readonly string[];
  setSelected: (ids: string[]) => void;
  commit: (next: PageScript[]) => void;
  /** 並びを変える直前に、今のカードの位置を覚える（移動をアニメーションで見せるため） */
  captureLayout: () => void;
  announce: (text: string) => void;
}

const cardsOf = (list: Element) =>
  Array.from(list.querySelectorAll<HTMLElement>(":scope > [data-step-id], :scope > .se-chunk > [data-step-id]"));

/** 中に動作を入れられるカードは、背の高い全体ではなく見出しの行で上下を判定する。 */
function midpoint(card: HTMLElement): number {
  const head = card.querySelector<HTMLElement>(":scope > .se-card-head") ?? card;
  const box = head.getBoundingClientRect();
  return box.top + box.height / 2;
}

export function useStepDrag(deps: StepDragDeps) {
  const latest = useRef(deps);
  latest.current = deps;
  const drag = useRef<DragState | null>(null);

  // 持ち上げ中の印は class ではなく属性で付ける（選択が変わると React が class を書き直すため）
  const isMoving = (el: Element | null) => !!el?.closest("[data-drag]");

  const findTarget = useCallback((state: DragState): DropTarget | null => {
    const flow = latest.current.flowRef.current;
    const root = flow?.querySelector<HTMLElement>('[data-list="root"]');
    if (!flow || !root) return null;
    const bounds = flow.getBoundingClientRect();
    const rootBox = root.getBoundingClientRect();
    // 流れの外へ出ても、いちばん近い端の位置として扱う
    const y = Math.max(bounds.top + 1, Math.min(bounds.bottom - 1, state.y));
    const x = Math.max(rootBox.left + 1, Math.min(rootBox.right - 1, state.x));
    const hit = document.elementFromPoint(x, y);
    let list = hit?.closest<HTMLElement>("[data-list]") ?? root;
    if (!flow.contains(list)) list = root;
    // 動かしている動作自身の中には入れられない
    for (let inside = list.closest("[data-drag]"); inside; inside = list.closest("[data-drag]")) {
      list = inside.parentElement?.closest<HTMLElement>("[data-list]") ?? root;
    }
    // 「もし」「くり返す」の見出しの下半分に重ねたら、その中の先頭に入れる
    const head = hit?.closest<HTMLElement>(".se-card-head");
    const container = head?.parentElement;
    if (head && container?.classList.contains("is-container") && !isMoving(container) &&
        container.parentElement?.closest("[data-list]") === list && y > midpoint(container)) {
      const inner = container.querySelector<HTMLElement>(":scope > .se-branch > [data-list]");
      if (inner) {
        const first = cardsOf(inner).find((card) => !isMoving(card));
        return { list: inner.dataset.list!, beforeId: first?.dataset.stepId ?? null };
      }
    }
    const before = cardsOf(list).find((card) => !isMoving(card) && midpoint(card) > y);
    return { list: list.dataset.list!, beforeId: before?.dataset.stepId ?? null };
  }, []);

  const showLine = useCallback((state: DragState) => {
    const { flowRef, lineRef, getScripts } = latest.current;
    const line = lineRef.current;
    const flow = flowRef.current;
    if (!line || !flow) return;
    const target = state.target;
    // 今と同じ位置に落とす場合は、線を表示しない
    if (!target || moveSteps(getScripts(), state.loc, state.ids, target) === getScripts()) {
      line.hidden = true;
      return;
    }
    const list = flow.querySelector<HTMLElement>(`[data-list="${CSS.escape(target.list)}"]`);
    if (!list) {
      line.hidden = true;
      return;
    }
    const cards = cardsOf(list).filter((card) => !isMoving(card));
    const next = target.beforeId === null ? null : cards.find((card) => card.dataset.stepId === target.beforeId);
    const previous = next ? cards[cards.indexOf(next) - 1] : cards[cards.length - 1];
    const box = list.getBoundingClientRect();
    const top = previous && next
      ? (previous.getBoundingClientRect().bottom + next.getBoundingClientRect().top) / 2
      : next ? next.getBoundingClientRect().top - 6
        : previous ? previous.getBoundingClientRect().bottom + 6 : box.top + 6;
    line.style.translate = `${box.left}px ${top}px`;
    line.style.width = `${box.width}px`;
    line.hidden = false;
  }, []);

  const follow = useCallback((state: DragState) => {
    const flow = latest.current.flowRef.current;
    const scrolled = (flow?.scrollTop ?? 0) - state.startScroll;
    state.card.style.translate = `${state.x - state.startX}px ${state.y - state.startY + scrolled}px`;
    state.target = findTarget(state);
    showLine(state);
  }, [findTarget, showLine]);

  const finish = useCallback((drop: boolean) => {
    const state = drag.current;
    if (!state) return false;
    drag.current = null;
    cancelAnimationFrame(state.frame);
    const { rootRef, flowRef, lineRef, getScripts, commit, captureLayout, announce } = latest.current;
    if (state.surface.hasPointerCapture(state.pointerId)) state.surface.releasePointerCapture(state.pointerId);
    const scripts = getScripts();
    const next = drop && state.started && state.target
      ? moveSteps(scripts, state.loc, state.ids, state.target) : scripts;
    // 持ち上げた位置から新しい位置までを動いて見せるため、見た目を戻す前に位置を覚える
    if (state.started) captureLayout();
    state.card.style.translate = "";
    rootRef.current?.classList.remove("is-reordering");
    flowRef.current?.querySelectorAll("[data-drag]").forEach((el) => el.removeAttribute("data-drag"));
    if (lineRef.current) lineRef.current.hidden = true;
    if (next !== scripts) {
      commit(next);
      announce(state.ids.size > 1
        ? tr("Moved {n} actions.", { n: state.ids.size }) : tr("Moved the action."));
    } else if (state.started && !drop) {
      announce(tr("Reordering cancelled."));
    }
    return state.started;
  }, []);

  const start = useCallback((state: DragState) => {
    const { rootRef, flowRef, getSelected, setSelected } = latest.current;
    const selected = getSelected();
    if (selected.includes(state.stepId)) state.ids = new Set(selected);
    else setSelected([state.stepId]);
    state.started = true;
    state.startScroll = flowRef.current?.scrollTop ?? 0;
    rootRef.current?.classList.add("is-reordering");
    flowRef.current?.querySelectorAll<HTMLElement>("[data-step-id]").forEach((card) => {
      if (card !== state.card && state.ids.has(card.dataset.stepId!)) card.dataset.drag = "moving";
    });
    state.card.dataset.drag = "lifted";
    // 流れの上下の端に近づいたら、近づいた分だけ速くスクロールする
    const tick = (time: number) => {
      if (drag.current !== state) return;
      const flow = flowRef.current;
      if (flow) {
        const box = flow.getBoundingClientRect();
        const zone = Math.min(72, box.height / 3);
        const elapsed = Math.min(48, time - (state.lastFrame || time));
        const over = state.y < box.top + zone ? state.y - (box.top + zone)
          : state.y > box.bottom - zone ? state.y - (box.bottom - zone) : 0;
        if (over) {
          const before = flow.scrollTop;
          flow.scrollTop += Math.max(-1, Math.min(1, over / zone)) * 0.9 * elapsed;
          if (flow.scrollTop !== before) follow(state);
        }
      }
      state.lastFrame = time;
      state.frame = requestAnimationFrame(tick);
    };
    state.frame = requestAnimationFrame(tick);
  }, [follow]);

  const grab = useCallback((event: React.PointerEvent, loc: Loc, stepId: string) => {
    // 主ボタンだけ。すでに別のポインターで動かしている間は、新しく始めない。
    if (event.button !== 0 || drag.current) return;
    const card = event.currentTarget as HTMLElement;
    if (!card.matches("[data-step-id]")) return;
    event.stopPropagation();
    card.setPointerCapture(event.pointerId);
    drag.current = {
      pointerId: event.pointerId, surface: card, card, loc, stepId, ids: new Set([stepId]),
      started: false, startX: event.clientX, startY: event.clientY,
      x: event.clientX, y: event.clientY, startScroll: 0, target: null, frame: 0, lastFrame: 0,
    };
    const onMove = (move: PointerEvent) => {
      const state = drag.current;
      if (!state || move.pointerId !== state.pointerId) return;
      state.x = move.clientX;
      state.y = move.clientY;
      if (!state.started) {
        if (Math.hypot(state.x - state.startX, state.y - state.startY) < 4) return;
        start(state);
      }
      follow(state);
    };
    const end = (drop: boolean) => (up: PointerEvent) => {
      const state = drag.current;
      if (state && up.pointerId !== state.pointerId) return;
      card.removeEventListener("pointermove", onMove);
      card.removeEventListener("pointerup", onUp);
      card.removeEventListener("pointercancel", onCancel);
      card.removeEventListener("lostpointercapture", onCancel);
      const moved = finish(drop);
      // 動かさずに離したら、そのカードを選ぶ
      if (!moved && drop) latest.current.setSelected([stepId]);
    };
    const onUp = end(true);
    const onCancel = end(false);
    card.addEventListener("pointermove", onMove);
    card.addEventListener("pointerup", onUp);
    card.addEventListener("pointercancel", onCancel);
    card.addEventListener("lostpointercapture", onCancel);
  }, [finish, follow, start]);

  // 画面を閉じるときに、動かしている途中の見た目を残さない
  useEffect(() => () => { finish(false); }, [finish]);

  /** Esc で取り消す。動かしている途中だったら true。 */
  const cancel = useCallback(() => !!drag.current?.started && finish(false), [finish]);
  const active = useCallback(() => !!drag.current?.started, []);
  return { grab, cancel, active };
}
