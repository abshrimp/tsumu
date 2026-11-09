/**
 * Share one viewport observer between the script stacks and step chunks.
 * Thousands of independently created IntersectionObservers are costly.
 * Keep focused views mounted until their blur handlers have committed drafts.
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
  // IntersectionObserver does not report focus changes. Remember visibility so
  // a view retained for editing can be released after focus leaves, even if it
  // never crosses the viewport boundary again.
  let visible = true;
  let blurTimer: ReturnType<typeof setTimeout> | undefined;
  const update = () => listener(visible || element.contains(element.ownerDocument.activeElement));
  const onFocusOut = () => {
    if (blurTimer !== undefined) clearTimeout(blurTimer);
    // Wait for both the blur commit and the next focus target to settle. Moving
    // between fields inside this view must not discard either field's state.
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
