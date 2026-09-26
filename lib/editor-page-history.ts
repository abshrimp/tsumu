/** Keep editor page selection in same-document browser history, not document undo history. */
type PageState = {
  activePageId: string;
  doc: { pages: Record<string, unknown>; pageOrder: string[] };
  setActivePage: (id: string) => void;
};

type PageStore = {
  getState: () => PageState;
  subscribe: (listener: (state: PageState, previous: PageState) => void) => () => void;
};

type PageBrowser = Pick<Window, "location" | "history" | "addEventListener" | "removeEventListener">;

const PAGE_PARAM = "page";

function requestedPage(browser: PageBrowser): string | null {
  return new URL(browser.location.href).searchParams.get(PAGE_PARAM);
}

function available(state: PageState, id: string | null): id is string {
  return !!id && Object.hasOwn(state.doc.pages, id);
}

function writePage(browser: PageBrowser, id: string, push: boolean): void {
  const url = new URL(browser.location.href);
  if (url.searchParams.get(PAGE_PARAM) === id) return;
  url.searchParams.set(PAGE_PARAM, id);
  // Next.js uses history.state for its own router state; never replace it with our data.
  if (push) browser.history.pushState(browser.history.state, "", url);
  else browser.history.replaceState(browser.history.state, "", url);
}

/**
 * Attach after the initial site document is ready.
 * A direct ?page= link wins over the last locally opened page; an ordinary page
 * switch creates one entry. Popstate only changes editor UI, never the document.
 */
export function connectEditorPageHistory(
  store: PageStore,
  browser: PageBrowser = window,
): () => void {
  const pathname = browser.location.pathname;
  if (!/^\/sites\/[^/]+\/?$/.test(pathname)) return () => {};

  const current = store.getState();
  const requested = requestedPage(browser);
  const initialPage = available(current, requested)
    ? requested
    : available(current, current.activePageId)
      ? current.activePageId
      : current.doc.pageOrder.find((id) => available(current, id));
  if (initialPage && current.activePageId !== initialPage) current.setActivePage(initialPage);
  if (initialPage) writePage(browser, initialPage, false);

  let restoring = false;
  const unsubscribe = store.subscribe((next, previous) => {
    if (restoring || browser.location.pathname !== pathname || !available(next, next.activePageId)) return;
    // If the previous page was deleted, replace its URL instead of adding an invalid entry.
    const userSwitch = next.activePageId !== previous.activePageId &&
      available(next, previous.activePageId);
    writePage(browser, next.activePageId, userSwitch);
  });

  const onPopState = () => {
    if (browser.location.pathname !== pathname) return;
    const state = store.getState();
    const requested = requestedPage(browser);
    const pageId = available(state, requested)
      ? requested
      : available(state, state.activePageId)
        ? state.activePageId
        : state.doc.pageOrder.find((id) => available(state, id));
    if (!pageId) return;
    restoring = true;
    try {
      if (state.activePageId !== pageId) state.setActivePage(pageId);
      // A page may have been deleted since this history entry was created.
      if (requested !== pageId) writePage(browser, pageId, false);
    } finally {
      restoring = false;
    }
  };
  browser.addEventListener("popstate", onPopState);
  return () => {
    unsubscribe();
    browser.removeEventListener("popstate", onPopState);
  };
}
