/**
 * 一覧から名前で探す代わりに、ページ（キャンバス）の上で要素を直接クリックして選ぶ。
 * 選んでいる間はスクリプトの画面を隠し、ポインターの下の選べる要素を枠で示す。
 */

import { tr } from "../../lib/i18n";

interface CanvasPick {
  /** 選べる要素の ID（キャンバスの要素から親へたどり、最初に見つかったものを選ぶ） */
  pickable: (nodeId: string) => boolean;
  onPick: (nodeId: string) => void;
  onCancel: () => void;
}

/** キャンバスに、選べる要素が1つでも表示されているか。 */
export function canPickOnCanvas(pickable: (nodeId: string) => boolean): boolean {
  if (typeof document === "undefined") return false;
  for (const el of document.querySelectorAll<HTMLElement>(".cv-root [data-node]")) {
    if (pickable(el.dataset.node!)) return true;
  }
  return false;
}

export function pickOnCanvas({ pickable, onPick, onCancel }: CanvasPick): () => void {
  const root = document.documentElement;
  root.classList.add("se-picking");

  const frame = document.createElement("div");
  frame.className = "se-pick-frame";
  frame.hidden = true;
  const bar = document.createElement("div");
  bar.className = "se-pick-bar";
  bar.setAttribute("role", "status");
  const label = document.createElement("span");
  label.textContent = tr("Click an element on the page");
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = tr("Cancel");
  bar.append(label, cancel);
  document.body.append(frame, bar);

  let current: HTMLElement | null = null;
  const find = (target: EventTarget | null): HTMLElement | null => {
    let el = target instanceof Element ? target.closest<HTMLElement>(".cv-root [data-node]") : null;
    while (el && !pickable(el.dataset.node!)) {
      el = el.parentElement?.closest<HTMLElement>(".cv-root [data-node]") ?? null;
    }
    return el;
  };
  const show = (el: HTMLElement | null) => {
    current = el;
    frame.hidden = !el;
    if (!el) return;
    const box = el.getBoundingClientRect();
    frame.style.translate = `${box.left}px ${box.top}px`;
    frame.style.width = `${box.width}px`;
    frame.style.height = `${box.height}px`;
  };

  let done = false;
  const stop = () => {
    if (done) return;
    done = true;
    root.classList.remove("se-picking");
    frame.remove();
    bar.remove();
    for (const type of BLOCKED) window.removeEventListener(type, block, true);
    window.removeEventListener("pointermove", onMove, true);
    window.removeEventListener("click", onClick, true);
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("scroll", onScroll, true);
  };
  const inBar = (event: Event) => event.target instanceof Node && bar.contains(event.target);
  // キャンバス自身の選択やドラッグを始めさせない
  const BLOCKED = ["pointerdown", "mousedown", "pointerup", "mouseup", "dblclick", "contextmenu"] as const;
  const block = (event: Event) => {
    if (inBar(event)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const onMove = (event: PointerEvent) => show(inBar(event) ? null : find(event.target));
  const onScroll = () => show(null);
  const onClick = (event: MouseEvent) => {
    if (inBar(event)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const el = find(event.target) ?? current;
    if (!el) return;
    stop();
    onPick(el.dataset.node!);
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopImmediatePropagation();
    stop();
    onCancel();
  };
  cancel.addEventListener("click", () => {
    stop();
    onCancel();
  });
  for (const type of BLOCKED) window.addEventListener(type, block, true);
  window.addEventListener("pointermove", onMove, true);
  window.addEventListener("click", onClick, true);
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("scroll", onScroll, true);
  (document.activeElement as HTMLElement | null)?.blur?.();
  return stop;
}
