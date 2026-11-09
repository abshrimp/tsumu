/** One panel resize per pointer. Remove global listeners on cancellation or unmount. */
let activePanelResizes = 0;

export function trackPanelResize(
  start: Pick<PointerEvent, "pointerId" | "clientX">,
  target: HTMLElement,
  width: number,
  direction: 1 | -1,
  resize: (nextWidth: number) => void,
  finished: () => void,
): () => void {
  const { pointerId, clientX: startX } = start;
  let active = true;
  const cleanup = () => {
    if (!active) return;
    active = false;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onEnd);
    window.removeEventListener("pointercancel", onEnd);
    window.removeEventListener("blur", onBlur);
    document.removeEventListener("visibilitychange", onVisibility);
    target.removeEventListener("lostpointercapture", onEnd);
    try {
      if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId);
    } finally {
      activePanelResizes -= 1;
      if (activePanelResizes === 0) document.body.classList.remove("is-resizing-panel");
      finished();
    }
  };
  const onMove = (event: PointerEvent) => {
    if (event.pointerId !== pointerId) return;
    // Returning to the window after releasing the button cannot resume an old drag.
    if (!(event.buttons & 1)) cleanup();
    else resize(width + (event.clientX - startX) * direction);
  };
  const onEnd = (event: Event) => {
    if ("pointerId" in event && event.pointerId !== pointerId) return;
    cleanup();
  };
  const onBlur = () => cleanup();
  const onVisibility = () => {
    if (document.visibilityState === "hidden") cleanup();
  };
  target.setPointerCapture(pointerId);
  activePanelResizes += 1;
  document.body.classList.add("is-resizing-panel");
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onEnd);
  window.addEventListener("pointercancel", onEnd);
  window.addEventListener("blur", onBlur);
  document.addEventListener("visibilitychange", onVisibility);
  target.addEventListener("lostpointercapture", onEnd);
  return cleanup;
}
