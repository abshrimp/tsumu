import assert from "node:assert/strict";
import { test } from "node:test";
import { connectEditorPageHistory } from "../lib/editor-page-history";

function fixture(href = "https://example.test/sites/site?other=keep#anchor") {
  const stack = [href];
  let cursor = 0;
  let page = "first";
  let pages = ["first", "second", "third"];
  const listeners = new Set<() => void>();
  const setPage = (id: string) => {
    const prev = state();
    page = id;
    for (const fn of callbacks) fn(state(), prev);
  };
  const state = () => ({
    activePageId: page,
    doc: { pages: Object.fromEntries(pages.map(id => [id, {}])), pageOrder: pages },
    setActivePage: setPage,
  });
  const callbacks = new Set<(current: ReturnType<typeof state>, previous: ReturnType<typeof state>) => void>();
  const location = {
    get href() { return stack[cursor]; },
    get pathname() { return new URL(stack[cursor]).pathname; },
  };
  const browser = {
    location,
    history: {
      state: { __NA: true },
      pushState(_data: unknown, _unused: string, url: string | URL | null) {
        stack.splice(cursor + 1);
        stack.push(new URL(String(url), location.href).href);
        cursor++;
      },
      replaceState(_data: unknown, _unused: string, url: string | URL | null) {
        stack[cursor] = new URL(String(url), location.href).href;
      },
    },
    addEventListener(_event: string, fn: () => void) { listeners.add(fn); },
    removeEventListener(_event: string, fn: () => void) { listeners.delete(fn); },
  };
  const store = {
    getState: state,
    subscribe(fn: (current: ReturnType<typeof state>, previous: ReturnType<typeof state>) => void) {
      callbacks.add(fn);
      return () => { callbacks.delete(fn); };
    },
  };
  const back = () => { cursor--; for (const listener of listeners) listener(); };
  const forward = () => { cursor++; for (const listener of listeners) listener(); };
  return {
    browser, store, setPage, back, forward, get page() { return page; },
    get url() { return new URL(location.href); },
    get historyLength() { return stack.length; },
    deletePage(id: string) {
      const prev = state();
      pages = pages.filter(value => value !== id);
      for (const fn of callbacks) fn(state(), prev);
      if (page === id) setPage(pages[0]);
    },
  };
}

test("page changes preserve unrelated query parameters and create browser history", () => {
  const f = fixture();
  const dispose = connectEditorPageHistory(f.store, f.browser as unknown as Window);
  assert.equal(f.url.searchParams.get("page"), "first");
  assert.equal(f.historyLength, 1);
  f.setPage("second");
  f.setPage("third");
  assert.equal(f.url.searchParams.get("page"), "third");
  assert.equal(f.url.searchParams.get("other"), "keep");
  assert.equal(f.url.hash, "#anchor");
  assert.equal(f.historyLength, 3);
  f.back();
  assert.equal(f.page, "second");
  assert.equal(f.historyLength, 3);
  f.back();
  assert.equal(f.page, "first");
  f.forward();
  assert.equal(f.page, "second");
  f.setPage("second");
  assert.equal(f.historyLength, 3);
  dispose();
  f.setPage("third");
  assert.equal(f.url.searchParams.get("page"), "second");
});

test("direct page links override locally remembered page without pushing history", () => {
  const f = fixture("https://example.test/sites/site?other=keep&page=third");
  const dispose = connectEditorPageHistory(f.store, f.browser as unknown as Window);
  assert.equal(f.page, "third");
  assert.equal(f.historyLength, 1);
  dispose();
});

test("invalid page links fall back to the current page and are replaced", () => {
  const f = fixture("https://example.test/sites/site?page=deleted&other=keep");
  const dispose = connectEditorPageHistory(f.store, f.browser as unknown as Window);
  assert.equal(f.page, "first");
  assert.equal(f.url.searchParams.get("page"), "first");
  f.setPage("second");
  f.deletePage("second");
  assert.equal(f.page, "first");
  assert.equal(f.url.searchParams.get("page"), "first");
  // Returning to a historical link for a deleted page does not select an invalid page.
  f.back();
  assert.equal(f.page, "first");
  assert.equal(f.url.searchParams.get("page"), "first");
  dispose();
});

test("history is not installed for unrelated routes", () => {
  const f = fixture("https://example.test/");
  const dispose = connectEditorPageHistory(f.store, f.browser as unknown as Window);
  f.setPage("second");
  assert.equal(f.historyLength, 1);
  assert.equal(f.url.searchParams.has("page"), false);
  dispose();
});
