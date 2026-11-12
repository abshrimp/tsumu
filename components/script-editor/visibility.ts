/**
 * スクリプトのスタックと手順のチャンクで、表示範囲の監視を1つ共有する。
 * IntersectionObserver を数千個も別々に作ると、負荷が大きい。
 * フォーカスのあるビューは、blur の処理が下書きを確定するまでマウントしたままにする。
 */
type Listener = (visible: boolean) => void;
interface ObservationSet {
  observer: IntersectionObserver;
  listeners: Map<Element, Listener>;
}
const byWorkspace = new WeakMap<Element, ObservationSet>();

export function observeScriptViewport(element: HTMLElement, listener: Listener): () => void {
  const workspace = element.closest<HTMLElement>(".se-ws");
  if (!workspace || typeof IntersectionObserver === "undefined") {
    listener(true);
    return () => {};
  }
  let group = byWorkspace.get(workspace);
  if (!group) {
    const listeners = new Map<Element, Listener>();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        listeners.get(entry.target)?.(entry.isIntersecting);
      }
    }, { root: workspace, rootMargin: "900px 600px", threshold: 0 });
    group = { observer, listeners };
    byWorkspace.set(workspace, group);
  }
  // IntersectionObserver はフォーカスの変化を知らせない。見えているかを覚えておき、
  // 編集のために残したビューを、表示範囲の境界をもう一度またがなくても、
  // フォーカスが外れた後に解放できるようにする。
  let visible = true;
  let blurTimer: ReturnType<typeof setTimeout> | undefined;
  const update = () => listener(visible || element.contains(element.ownerDocument.activeElement));
  const onFocusOut = () => {
    if (blurTimer !== undefined) clearTimeout(blurTimer);
    // blur での確定と、次のフォーカス先の両方が落ち着くまで待つ。このビューの中で
    // 欄を移動しても、どちらの欄の状態も失ってはいけない。
    blurTimer = setTimeout(() => {
      blurTimer = undefined;
      update();
    }, 0);
  };
  element.addEventListener("focusout", onFocusOut);
  group.listeners.set(element, (intersecting) => {
    visible = intersecting;
    update();
  });
  group.observer.observe(element);
  return () => {
    element.removeEventListener("focusout", onFocusOut);
    if (blurTimer !== undefined) clearTimeout(blurTimer);
    const current = byWorkspace.get(workspace);
    current?.observer.unobserve(element);
    current?.listeners.delete(element);
    if (current && !current.listeners.size) {
      current.observer.disconnect();
      byWorkspace.delete(workspace);
    }
  };
}
