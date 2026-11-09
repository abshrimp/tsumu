/**
 * Share one viewport observer between the script stacks and step chunks.
 * Thousands of independently created IntersectionObservers are costly.
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
  group.listeners.set(element, listener);
  group.observer.observe(element);
  return () => {
    const current = byWorkspace.get(workspace);
    current?.observer.unobserve(element);
    current?.listeners.delete(element);
    if (current && !current.listeners.size) {
      current.observer.disconnect();
      byWorkspace.delete(workspace);
    }
  };
}
