import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { transformSync } from "esbuild";
import type { ScriptEditorLatest } from "../components/ScriptEditor";

// Model capture -> focused control -> bubble, which a single EventTarget
// cannot reproduce. Execute the real hook; browser tests cover React and focus.
function mount() {
  const listeners: { type: string; handler: (event: Event) => void; capture: boolean }[] = [];
  const cleanups: (() => void)[] = [];
  const win = {
    addEventListener(type: string, handler: (event: Event) => void, capture = false) {
      listeners.push({ type, handler, capture });
    },
    removeEventListener(type: string, handler: (event: Event) => void, capture = false) {
      const i = listeners.findIndex((listener) => listener.type === type && listener.handler === handler && listener.capture === capture);
      if (i !== -1) listeners.splice(i, 1);
    },
    dispatchEvent() {},
  };
  const ui = { closed: 0, cancelled: 0, gesture: false, popover: false, dialog: false, zoom: 0 };
  const latest = { current: {
    selectedList: ["step:open"], peekId: null,
    onClose: () => { ui.closed++; },
    setZoom: () => { ui.zoom++; }, stepZoom: () => { ui.zoom++; },
  } as ScriptEditorLatest };
  const module = { exports: {} as any };
  const require = createRequire(resolve("components/script-editor/useScriptEditorKeys.ts"));
  const code = transformSync(readFileSync("components/script-editor/useScriptEditorKeys.ts", "utf8"), { loader: "ts", format: "cjs" }).code;
  new Function("require", "module", "exports", "window", "document", code)(
    (id: string) => id === "react" ? { useEffect: (fn: () => () => void) => cleanups.push(fn()) } : require(id),
    module, module.exports, win,
    { querySelector: (selector: string) =>
      (selector.includes("dialog-backdrop") && ui.dialog) ||
      (selector.includes("[data-se-popover]") && ui.popover) },
  );
  module.exports.useScriptEditorKeys({
    dragRef: { current: null }, latest,
    cancelGesture: () => {
      if (!ui.gesture) return false;
      ui.gesture = false; ui.cancelled++; return true;
    },
    setPeekId: (id: string | null) => { latest.current.peekId = id; },
    setSelectedList: (ids: string[]) => { latest.current.selectedList = ids; },
  });
  return {
    ui, latest,
    key(control?: (event: Event) => void, init: Record<string, unknown> = {}) {
      const event = Object.assign(new Event("keydown", { cancelable: true, bubbles: true }), {
        key: "Escape", isComposing: false, keyCode: 27, ...init,
      });
      Object.defineProperty(event, "target", { value: { tagName: "INPUT", isContentEditable: false } });
      for (const listener of listeners.filter((l) => l.type === "keydown" && l.capture)) listener.handler(event);
      if (!event.cancelBubble) control?.(event);
      if (!event.cancelBubble) {
        for (const listener of listeners.filter((l) => l.type === "keydown" && !l.capture)) listener.handler(event);
      }
      return event;
    },
    cleanup: () => cleanups.splice(0).forEach((cleanup) => cleanup()),
    listeners,
  };
}

for (const selected of [false, true]) test(`a focused control owns Escape before workspace ${selected ? "selection" : "close"}`, () => {
  const f = mount();
  if (!selected) f.latest.current.selectedList = [];
  const before = [...f.latest.current.selectedList];
  let cleared = false;
  try {
    f.key((event) => { cleared = true; event.stopPropagation(); });
    assert.equal(cleared, true);
    assert.deepEqual(f.latest.current.selectedList, before);
    assert.equal(f.ui.closed, 0);
  } finally { f.cleanup(); }
});

for (const init of [{ isComposing: true }, { keyCode: 229 }]) {
  for (const selected of [false, true]) test(`IME Escape leaves workspace unchanged: ${JSON.stringify({ ...init, selected })}`, () => {
    const f = mount();
    if (!selected) f.latest.current.selectedList = [];
    const before = [...f.latest.current.selectedList];
    try {
      const event = f.key(undefined, init);
      assert.deepEqual(f.latest.current.selectedList, before);
      assert.equal(f.ui.closed, 0);
      assert.equal(event.defaultPrevented, false);
      assert.equal(event.cancelBubble, false);
    } finally { f.cleanup(); }
  });
  test(`IME keystrokes cannot zoom the workspace: ${JSON.stringify(init)}`, () => {
    const f = mount();
    try {
      const event = f.key(undefined, { ...init, key: "-", ctrlKey: true });
      assert.equal(f.ui.zoom, 0);
      assert.equal(event.defaultPrevented, false);
    } finally { f.cleanup(); }
  });
}

test("preventDefault in a focused control also reserves Escape", () => {
  const f = mount();
  try {
    assert.equal(f.key((event) => event.preventDefault()).defaultPrevented, true);
    assert.deepEqual(f.latest.current.selectedList, ["step:open"]);
    assert.equal(f.ui.closed, 0);
  } finally { f.cleanup(); }
});

test("unhandled Escape cancels gesture, closes peek, clears selection, then closes editor", () => {
  const f = mount();
  f.ui.gesture = true;
  f.latest.current.peekId = "fetch";
  try {
    f.key();
    assert.equal(f.ui.cancelled, 1);
    assert.equal(f.latest.current.peekId, "fetch");
    f.key();
    assert.equal(f.latest.current.peekId, null);
    assert.deepEqual(f.latest.current.selectedList, ["step:open"]);
    f.key();
    assert.deepEqual(f.latest.current.selectedList, []);
    assert.equal(f.ui.closed, 0);
    f.key();
    assert.equal(f.ui.closed, 1);
  } finally { f.cleanup(); }
  assert.deepEqual(f.listeners, []);
  f.key();
  assert.equal(f.ui.closed, 1, "unmounted editor must not retain key listeners");
});

for (const overlay of ["popover", "dialog"] as const) test(`${overlay} keeps ownership of Escape`, () => {
  const f = mount();
  f.ui[overlay] = true;
  try {
    const event = f.key();
    assert.deepEqual(f.latest.current.selectedList, ["step:open"]);
    assert.equal(f.ui.closed, 0);
    assert.equal(event.cancelBubble, false);
  } finally { f.cleanup(); }
});
