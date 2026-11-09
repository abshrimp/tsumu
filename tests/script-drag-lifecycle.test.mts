import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { transformSync } from "esbuild";
import { useEditor } from "../lib/store";
import { applyPageScripts, pageScriptsOf } from "../lib/script";
import type { Drag, Marquee, ScriptEditorLatest } from "../components/ScriptEditor";
import { scriptDragBundle, scriptDragDoc } from "./helpers/script-drag";

// 実フックを読み込み、DOMの寸法とイベントだけを固定する。保存・Undoは実ストアを使う。
function mount(targetSlot?: string, framed = false) {
  useEditor.getState().replaceDoc(scriptDragDoc());
  useEditor.getState().setActivePage("p");
  const win = new EventTarget();
  const doc = Object.assign(new EventTarget(), { visibilityState: "visible", querySelector: () => null });
  const cleanups: (() => void)[] = [];
  const hooks = { useEffect: (fn: () => () => void) => cleanups.push(fn()), useCallback: (fn: any) => fn,
    useRef: (current: unknown) => ({ current }) };
  let frameId = 0;
  const frames = new Map<number, () => void>();
  const requestFrame = framed ? (fn: () => void) => { frames.set(++frameId, fn); return frameId; } : undefined;
  const cancelFrame = framed ? (id: number) => { frames.delete(id); } : undefined;
  const flushFrames = () => {
    const pending = [...frames.values()]; frames.clear();
    pending.forEach((fn) => fn());
  };
  const load = (path: string) => {
    const require = createRequire(resolve(path));
    const mod = { exports: {} as any };
    const code = transformSync(readFileSync(path, "utf8"), { loader: "ts", format: "cjs" }).code;
    new Function("require", "module", "exports", "window", "document", "requestAnimationFrame", "cancelAnimationFrame", code)(
      (id: string) => id === "react" ? hooks : id === "../../lib/store" ? { useEditor } : require(id),
      mod, mod.exports, win, doc, requestFrame, cancelFrame,
    );
    return mod.exports;
  };
  const dragRef = { current: null as Drag | null };
  const marqueeRef = { current: null as Marquee | null };
  const ui = { drag: null as Drag | null, marquee: null as Marquee | null, slot: null as string | null, selected: [] as string[], closed: false };
  const rect = (left: number, right: number) => ({ left, right, top: 0, bottom: 600 });
  const paletteClasses = new Set<string>();
  const palette = { getBoundingClientRect: () => rect(0, 280), classList: {
    toggle: (name: string, on: boolean) => { if (on) paletteClasses.add(name); else paletteClasses.delete(name); },
    remove: (name: string) => { paletteClasses.delete(name); },
  } };
  const selectable = [{ dataset: { selKey: "step:wait" },
    getBoundingClientRect: () => ({ left: 780, right: 820, top: 200, bottom: 240 }) }];
  const ws = { scrollLeft: 0, scrollTop: 0, getBoundingClientRect: () => rect(300, 1200),
    querySelectorAll: (selector: string) => targetSlot && selector === '[data-slot-kind]'
      ? [{ dataset: { slot: targetSlot, slotKind: "step" },
        getBoundingClientRect: () => ({ left: 692, right: 740, top: 292, bottom: 315 }) }]
      : selector === '[data-sel-key]' ? selectable : [],
  };
  const scripts = () => pageScriptsOf(useEditor.getState().doc, [], useEditor.getState().activePageId);
  const latest = { current: {
    get scripts() { return scripts(); }, focusNodeId: null,
    commit: (next) => useEditor.getState().updateDoc((d) => applyPageScripts(d, useEditor.getState().activePageId, [], next)),
    selectedList: [], peekId: null, onClose: () => { ui.closed = true; },
    setZoom() {}, stepZoom() {}, deleteSelected() {}, selectAll() {},
  } as ScriptEditorLatest };
  const setSelectedList = (value: string[]) => { ui.selected = value; };
  const cancel = load("components/script-editor/useScriptDrag.ts").useScriptDrag({
    wsRef: { current: ws }, paletteRef: { current: palette }, zoomRef: { current: 1 },
    dragRef, marqueeRef, latest, setSelectedList, setMenu() {},
    setDrag: (value: Drag | null) => { ui.drag = value; },
    setMarquee: (value: Marquee | null) => { ui.marquee = value; },
    setActiveSlot: (value: string | null) => { ui.slot = value; },
  });
  load("components/script-editor/useScriptEditorKeys.ts").useScriptEditorKeys({ dragRef, cancelGesture: cancel, latest, setPeekId() {}, setSelectedList });
  const pointer = (type: string, { id = 1, x = 700, y = 300, buttons = 1 } = {}) => {
    win.dispatchEvent(Object.assign(new Event(type), { pointerId: id, clientX: x, clientY: y, buttons }));
  };
  const start = (kind = "script", move = true) => {
    if (kind === "marquee") marqueeRef.current = { pointerId: 1, x0: 500, y0: 100, x: 500, y: 100, base: [] };
    else {
      const script = scripts()[0];
      const payload = kind === "step" ? { type: "steps", steps: script.steps, from: { scriptId: "script", list: "root", index: 0 } } :
        kind === "palette" ? { type: "steps", steps: [{ id: "palette-wait", kind: "wait", seconds: 1 }] } : { type: "script", script, group: [script] };
      dragRef.current = { pointerId: 1, make: () => payload as any, payload: null, started: false, sx: 340, sy: 40, x: 340, y: 40, ox: 8, oy: 8, h: 40 };
    }
    if (move) pointer("pointermove");
  };
  return { start, pointer, win, doc, ui, dragRef, marqueeRef, cancel, frames, flushFrames, paletteClasses,
    key(key: string, ctrlKey = false) {
      const event = Object.assign(new Event("keydown"), { key, ctrlKey });
      Object.defineProperty(event, "target", { value: { tagName: "BODY" } });
      win.dispatchEvent(event);
    },
    close: () => { for (const fn of cleanups.reverse()) fn(); },
  };
}
const state = () => useEditor.getState();
const snapshot = () => ({ doc: structuredClone(state().doc), past: state().past.length, future: state().future.length });

test("an unrelated pointer release preserves the owner's queued slot feedback", () => {
  const m = mount("script|root|1", true);
  try {
    const before = snapshot();
    m.start("palette");
    m.pointer("pointermove");
    assert.equal(m.frames.size, 1);
    m.pointer("pointerup", { id: 2, x: 100, buttons: 0 });
    m.flushFrames();
    assert.equal(m.ui.slot, "script|root|1");
    assert.deepEqual(snapshot(), before);
    m.pointer("pointerup", { buttons: 0 });
    assert.deepEqual(state().doc.pages.p.pageScripts![0].steps.map((s) => s.id), ["wait", "palette-wait"]);
    assert.equal(state().past.length, before.past + 1);
  } finally { m.close(); }
});

for (const end of ["pointercancel", "blur", "escape", "edit", "unmount"]) {
  test(`${end} clears trash feedback and queued work before another drag`, () => {
    const m = mount("script|root|1", true);
    try {
      m.start("step");
      m.pointer("pointermove", { x: 100 }); m.flushFrames();
      assert.equal(m.paletteClasses.has("is-trash"), true);
      m.pointer("pointermove", { x: 100 });
      assert.equal(m.frames.size, 1);
      if (end === "pointercancel") m.pointer("pointercancel");
      if (end === "blur") m.win.dispatchEvent(new Event("blur"));
      if (end === "escape") m.key("Escape");
      if (end === "edit") state().updatePage("p", { title: "Changed" });
      if (end === "unmount") m.close();
      assert.equal(m.paletteClasses.has("is-trash"), false);
      assert.equal(m.frames.size, 0);
      const before = snapshot();
      if (end !== "unmount") m.start("palette");
      m.flushFrames();
      assert.equal(m.ui.slot, null, "cancelled work cannot update a later gesture");
      assert.deepEqual(snapshot(), before);
    } finally { m.close(); }
  });
}

for (const initialX of [700, 900]) for (const releaseX of [700, 900]) {
  test(`marquee uses release at ${releaseX} after last move at ${initialX}`, () => {
    const m = mount();
    try {
      const before = snapshot();
      m.start("marquee", false);
      m.marqueeRef.current!.base = ["script:kept", "script:kept"];
      m.pointer("pointermove", { x: initialX });
      m.pointer("pointerup", { x: releaseX, buttons: 0 });
      assert.deepEqual(m.ui.selected, releaseX === 900 ? ["script:kept", "step:wait"] : ["script:kept"]);
      assert.equal(m.marqueeRef.current, null);
      assert.equal(m.ui.marquee, null);
      assert.deepEqual(snapshot(), before);
    } finally { m.close(); }
  });
}

for (const kind of ["script", "step", "palette", "marquee"]) {
  for (const end of ["pointercancel", "blur", "hidden", "released-outside", "escape", "unmount"]) {
    test(`${kind}: ${end} cancels without a late drop or history change`, () => {
      const m = mount();
      try {
        state().updatePage("p", { title: "Undoable" }); state().undo();
        const before = snapshot();
        m.start(kind);
        if (end === "pointercancel") m.pointer("pointercancel", { buttons: 0 });
        if (end === "blur") m.win.dispatchEvent(new Event("blur"));
        if (end === "hidden") { m.doc.visibilityState = "hidden"; m.doc.dispatchEvent(new Event("visibilitychange")); }
        if (end === "released-outside") m.pointer("pointermove", { buttons: 0 });
        if (end === "escape") { m.key("Escape"); assert.equal(m.ui.closed, false); }
        if (end === "unmount") m.close();
        assert.equal(m.dragRef.current, null); assert.equal(m.marqueeRef.current, null);
        assert.equal(m.ui.drag, null); assert.equal(m.ui.marquee, null); assert.equal(m.ui.slot, null);
        m.pointer("pointermove"); m.pointer("pointerup", { buttons: 0 });
        assert.deepEqual(snapshot(), before);
      } finally { m.close(); }
    });
  }
}
for (const action of ["undo", "redo", "page", "replace", "edit", "component"]) {
  test(`${action} invalidates the old step payload synchronously`, () => {
    const m = mount();
    try {
      state().updatePage("p", { title: "Changed" });
      if (action === "redo") state().undo();
      m.start("step");
      if (action === "undo") state().undo();
      if (action === "redo") state().redo();
      if (action === "page") state().setActivePage("q");
      if (action === "replace") state().replaceDoc(scriptDragDoc());
      if (action === "edit") state().updatePage("p", { description: "Newer" });
      if (action === "component") useEditor.setState({ editingComponentId: "other" });
      const before = snapshot();
      assert.equal(m.dragRef.current, null);
      m.pointer("pointerup", { buttons: 0 });
      assert.deepEqual(snapshot(), before);
    } finally { m.close(); }
  });
}
for (const kind of ["script", "marquee"]) test(`${kind} ignores unrelated pointers and resumes with the owner`, () => {
  const m = mount();
  try {
    m.start(kind);
    const before = snapshot();
    for (const type of ["pointermove", "pointercancel", "pointerup"]) {
      m.pointer(type, { id: 2, x: 100, buttons: 0 });
      assert.ok(m.dragRef.current ?? m.marqueeRef.current);
      assert.deepEqual(snapshot(), before);
    }
    m.pointer("pointermove", { x: 800 }); m.pointer("pointerup", { x: 800, buttons: 0 });
    assert.equal(m.dragRef.current, null); assert.equal(m.marqueeRef.current, null);
    if (kind === "script") {
      assert.deepEqual(state().doc.pages.p.pageScripts![0].pos, { x: 492, y: 292 });
      assert.equal(state().past.length, 1);
      const saved = snapshot(); state().undo(); assert.deepEqual(snapshot().doc, before.doc); state().redo(); assert.deepEqual(snapshot().doc, saved.doc);
    } else assert.deepEqual(snapshot(), before);
  } finally { m.close(); }
});

test("a cancelled click never narrows a multi-selection, and keyboard Undo/Redo works afterward", () => {
  const m = mount();
  try {
    state().updatePage("p", { title: "Changed" });
    m.start("script", false); m.dragRef.current!.clickKey = "script:script";
    m.pointer("pointercancel"); m.pointer("pointerup", { buttons: 0 });
    assert.deepEqual(m.ui.selected, []);
    m.key("z", true); assert.equal(state().doc.pages.p.title, ""); assert.equal(state().future.length, 1);
    m.key("y", true); assert.equal(state().doc.pages.p.title, "Changed");
    m.start(); m.pointer("pointerup", { x: 800, buttons: 0 });
    assert.equal(state().past.length, 2);
  } finally { m.close(); }
});

test("ordinary drops still use their release position and palette deletion is one reversible edit", () => {
  const m = mount();
  try {
    const before = snapshot(); m.start();
    m.pointer("pointerup", { x: 100, buttons: 0 });
    assert.equal(state().doc.pages.p.pageScripts, undefined); assert.equal(state().past.length, 1);
    state().undo(); assert.deepEqual(snapshot().doc, before.doc);
    m.start(); m.pointer("pointerup", { x: 1300, buttons: 0 }); assert.deepEqual(snapshot().doc, before.doc);
    assert.equal(state().future.length, 1);
  } finally { m.close(); }
});

test("the browser fixture bundles the real script editor and gesture hooks", async () => {
  const bundle = await scriptDragBundle();
  assert.match(bundle, /function ScriptEditorInner/); assert.match(bundle, /function useScriptDrag/);
});

test("dropping a selected chain inside its own removed subtree leaves document and undo history unchanged", () => {
  const m = mount("script|repeat:then|0");
  try {
    state().updateDoc((doc) => {
      doc.pages.p.pageScripts![0].steps = [
        { id: "repeat", kind: "repeat", times: 2,
          then: [{ id: "child", kind: "wait", seconds: 1 }] },
        { id: "following", kind: "hide", target: "banner" },
      ];
    });
    const before = snapshot();
    m.start("step");
    m.pointer("pointerup", { x: 700, y: 300, buttons: 0 });
    assert.deepEqual(snapshot(), before, "an invalid descendant drop must not delete source steps");
  } finally { m.close(); }
});
