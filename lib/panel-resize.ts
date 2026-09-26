/** パネルの大きさの変更はポインターごとに1つ。取り消しやアンマウントのときは、グローバルなリスナーを外す。 */
let activePanelResizes = 0;

export function trackPanelResize(
  start: Pick<PointerEvent, "pointerId" | "clientX">,
  target: HTMLElement,
  width: number,
  direction: 1 | -1,
  resize: (nextWidth: number) => void,
  finished: (releasedWidth: number | null) => void,
): () => void {
  const { pointerId, clientX: startX } = start;
  const listeners = new AbortController();
  const { signal } = listeners;
  const widthAt = (event: PointerEvent) => width + (event.clientX - startX) * direction;
  const finish = (releasedWidth: number | null) => {
    if (signal.aborted) return;
    listeners.abort();
    try {
      if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId);
    } finally {
      activePanelResizes -= 1;
      if (activePanelResizes === 0) document.body.classList.remove("is-resizing-panel");
      finished(releasedWidth);
    }
  };
  const cancel = () => finish(null);
  const onMove = (event: PointerEvent) => {
    if (event.pointerId !== pointerId) return;
    // ボタンを離した後にウィンドウへ戻っても、古いドラッグを再開することはできない。
    if (!(event.buttons & 1)) cancel();
    else resize(widthAt(event));
  };
  const onEnd = (event: PointerEvent) => {
    if (event.pointerId !== pointerId) return;
    finish(event.type === "pointerup" ? widthAt(event) : null);
  };
  const onVisibility = () => {
    if (document.visibilityState === "hidden") cancel();
  };
  target.setPointerCapture(pointerId);
  activePanelResizes += 1;
  document.body.classList.add("is-resizing-panel");
  window.addEventListener("pointermove", onMove, { signal });
  window.addEventListener("pointerup", onEnd, { signal });
  window.addEventListener("pointercancel", onEnd, { signal });
  window.addEventListener("blur", cancel, { signal });
  document.addEventListener("visibilitychange", onVisibility, { signal });
  target.addEventListener("lostpointercapture", onEnd, { signal });
  return cancel;
}
