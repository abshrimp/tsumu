/** モーションの編集画面のポインターを1つ、離す・取り消す・キャプチャを失うまで追跡する。 */
export function trackMotionPointer(
  start: Pick<PointerEvent, "pointerId">,
  target: Element,
  move: (event: PointerEvent) => void,
  finish: (event: PointerEvent | null) => void,
): () => void {
  const pointerId = start.pointerId;
  let active = true;
  const cleanup = () => {
    if (!active) return;
    active = false;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onCancel);
    window.removeEventListener("blur", onBlur);
    target.removeEventListener("lostpointercapture", onLostCapture);
    if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId);
  };
  const end = (event: PointerEvent | null) => {
    if (!active) return;
    cleanup();
    finish(event);
  };
  const onMove = (event: PointerEvent) => {
    if (event.pointerId !== pointerId) return;
    // ウィンドウの外でボタンを離して戻ってきても、編集を再開してはいけない。
    if (!(event.buttons & 1)) end(null);
    else move(event);
  };
  const onUp = (event: PointerEvent) => {
    if (event.pointerId === pointerId) end(event);
  };
  const onCancel = (event: PointerEvent) => {
    if (event.pointerId === pointerId) end(null);
  };
  const onLostCapture = (event: Event) => onCancel(event as PointerEvent);
  const onBlur = () => end(null);
  // 動くたびに DOM の順序が変わる印ではなく、変わらないタイムラインでキャプチャする。
  target.setPointerCapture(pointerId);
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onCancel);
  window.addEventListener("blur", onBlur);
  target.addEventListener("lostpointercapture", onLostCapture);
  return cleanup;
}
