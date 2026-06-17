"use client";

import { useEffect } from "react";

/** 閉じるときに短くフェードアウトさせる要素 */
const SELECTOR = ".modal-backdrop, .se-backdrop";

/**
 * モーダルは state で即座に取り除かれるため、取り除かれた瞬間の見た目を複製して
 * 同じ位置に置き、短いフェードアウトを再生してから消す（操作は受け付けない）。
 */
export default function LeaveAnimator() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const play = (el: HTMLElement, parent: Node) => {
      // 親ごと消えた（画面の切り替えなど）ときは再生しない
      if (!parent.isConnected) return;
      const ghost = el.cloneNode(true) as HTMLElement;
      ghost.classList.add("is-leaving");
      ghost.setAttribute("aria-hidden", "true");
      ghost.removeAttribute("id");
      ghost.querySelectorAll("[id]").forEach((n) => n.removeAttribute("id"));
      // 入力欄の値は複製されないので写しておく
      const src = el.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea");
      const dst = ghost.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea");
      src.forEach((s, i) => {
        if (dst[i]) dst[i].value = s.value;
      });
      // スクロール位置も保つ
      const scrolled: [number, number, number][] = [];
      el.querySelectorAll<HTMLElement>("*").forEach((n, i) => {
        if (n.scrollTop || n.scrollLeft) scrolled.push([i, n.scrollTop, n.scrollLeft]);
      });
      // React が管理する要素の中には差し込まず、body の末尾に置く（どれも position: fixed）
      document.body.appendChild(ghost);
      if (scrolled.length) {
        const all = ghost.querySelectorAll<HTMLElement>("*");
        for (const [i, top, left] of scrolled) {
          if (all[i]) {
            all[i].scrollTop = top;
            all[i].scrollLeft = left;
          }
        }
      }
      const done = () => ghost.remove();
      ghost.addEventListener("animationend", (e) => {
        if (e.target === ghost) done();
      });
      setTimeout(done, 400);
    };

    const obs = new MutationObserver((records) => {
      for (const r of records) {
        r.removedNodes.forEach((n) => {
          if (!(n instanceof HTMLElement) || n.classList.contains("is-leaving")) return;
          if (n.matches(SELECTOR)) play(n, r.target);
        });
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
    return () => obs.disconnect();
  }, []);

  return null;
}
