import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { transformSync } from "esbuild";
import { useEditor } from "../lib/store";
import type { UseCanvasDragDeps } from "../components/canvas/useCanvasDrag";
import { canvasMoveBundle, canvasMoveDoc } from "./helpers/canvas-move";

const state = () => useEditor.getState();
const snapshot = () => structuredClone({ doc: state().doc, past: state().past, future: state().future });

// 実フックと実ストアを使う。DOMの寸法とフックの描画だけを固定し、ブラウザ操作はe2eで確認する。
function mount() {
  state().replaceDoc(canvasMoveDoc());
  state().setActivePage("p");
  state().setMode("design");
  state().setBreakpoint("base");
  state().select(null);
  const win = new EventTarget();
  const rect = { left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 };
  const elements: Record<string, any> = {};
  for (const id of ["a", "b", "c"]) elements[id] = {
    getAttribute: () => id, getBoundingClientRect: () => rect,
    closest: () => elements[id], parentElement: { closest: () => null },
  };
  let hit = "c";
  const doc = Object.assign(new EventTarget(), {
    visibilityState: "visible", elementFromPoint: () => elements[hit] ?? null,
  });
  const cleanups: (() => void)[] = [];
  const refs: { current: any }[] = [];
  let refIndex = 0, mounted = false;
  const hooks = {
    useRef: (value: any) => refs[refIndex++] ?? (refs[refIndex - 1] = { current: value }),
    useLayoutEffect: (fn: () => () => void) => { if (!mounted) cleanups.push(fn()); },
  };
  const path = "components/canvas/useCanvasDrag.ts";
  const require = createRequire(resolve(path));
  const mod = { exports: {} as any };
  const code = transformSync(readFileSync(path, "utf8"), { loader: "ts", format: "cjs" }).code;
  new Function("require", "module", "exports", "window", "document", "getComputedStyle", code)(
    (id: string) => id === "react" ? hooks : id === "../../lib/store" ? { ...require(id), useEditor } :
      id === "../../lib/image-drop" ? { useImageDrop: () => ({ uploading: false, dropFiles() {} }) } : require(id),
    mod, mod.exports, win, doc, () => ({ display: "block", flexDirection: "column" }),
  );
  const moveState: UseCanvasDragDeps["moveState"] = { current: null };
  const moveDropRef: UseCanvasDragDeps["moveDropRef"] = { current: null };
  const movedJustNow = { current: false };
  const ui: { drag: any } = { drag: null };
  let onDown: (event: any) => void;
  const render = () => {
    refIndex = 0;
    onDown = mod.exports.useCanvasDrag({
      ...state(), innerRef: { current: { getBoundingClientRect: () => rect } },
      frameRef: { current: null }, editingComp: null, moveState, moveDropRef, movedJustNow,
      scale: 1, setMoveDrag: (value: any) => { ui.drag = value; },
      setDropState() {}, setElemDropTarget() {}, elemDropTarget: null, dropState: "none",
    }).onCvPointerDown;
    mounted = true;
  };
  render();
  const pointer = (type: string, { id = 1, x = 50, y = 95, buttons = 1 } = {}) => {
    win.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), {
      pointerId: id, clientX: x, clientY: y, buttons,
    }));
  };
  const down = ({ id = 1, node = "a", button = 0, shiftKey = false } = {}) => {
    render();
    onDown!({ target: elements[node], pointerId: id, clientX: 0, clientY: 0, button, shiftKey });
  };
  return { win, doc, ui, moveState, moveDropRef, movedJustNow, pointer, down,
    start(move = true) { down(); if (move) pointer("pointermove"); },
    hit(id: string) { hit = id; },
    key(key: string) { const e = Object.assign(new Event("keydown", { cancelable: true }), { key }); win.dispatchEvent(e); return e; },
    close() { for (const fn of cleanups.splice(0).reverse()) fn(); },
  };
}

test("pointer movement reuses the dragged subtree and sibling positions for one gesture", () => {
  const m = mount();
  try {
    state().updateDoc(doc => {
      doc.pages.p.children = ["a", "b"];
      doc.nodes.b.children = ["c"];
    });
    const { doc } = state();
    const children = doc.nodes.a.children;
    let reads = 0;
    Object.defineProperty(doc.nodes.a, "children", {
      configurable: true, enumerable: true, get() { reads++; return children; },
    });
    try {
      m.start(false);
      m.pointer("pointermove", { x: 2, y: 2 });
      assert.equal(reads, 0, "clicks below the movement threshold never walk the subtree");
      m.pointer("pointermove");
      const firstMoveReads = reads;
      assert.ok(firstMoveReads > 0);
      for (let i = 0; i < 20; i++) {
        m.pointer("pointermove", { y: i % 2 ? 5 : 95 });
        assert.deepEqual(m.moveDropRef.current, {
          parent: { kind: "node", id: "b" }, index: i % 2 ? 0 : 1,
        });
      }
      assert.equal(reads, firstMoveReads, "subsequent pointer samples must reuse both tree lookups");
    } finally {
      Object.defineProperty(doc.nodes.a, "children", {
        configurable: true, enumerable: true, writable: true, value: children,
      });
    }
  } finally { m.close(); }
});

for (const active of [false, true]) {
  for (const end of ["pointercancel", "blur", "hidden", "released-outside", "escape", "unmount"]) {
    test(`${active ? "active" : "pending"} movement: ${end} removes the gesture without editing or destroying redo`, () => {
      const m = mount();
      try {
        state().updatePage("p", { title: "Undoable" }); state().undo();
        const before = snapshot();
        m.start(active);
        if (active) assert.ok(m.ui.drag);
        if (end === "pointercancel") m.pointer("pointercancel", { buttons: 0 });
        if (end === "blur") m.win.dispatchEvent(new Event("blur"));
        if (end === "hidden") { m.doc.visibilityState = "hidden"; m.doc.dispatchEvent(new Event("visibilitychange")); }
        if (end === "released-outside") m.pointer("pointermove", { buttons: 0 });
        if (end === "escape") assert.equal(m.key("Escape").defaultPrevented, true);
        if (end === "unmount") m.close();
        assert.equal(m.moveState.current, null); assert.equal(m.moveDropRef.current, null); assert.equal(m.ui.drag, null);
        m.pointer("pointermove"); m.pointer("pointerup", { buttons: 0 });
        assert.deepEqual(snapshot(), before);
        if (end !== "unmount") {
          m.start(); m.pointer("pointerup", { buttons: 0 });
          assert.deepEqual(state().doc.pages.p.children, ["b", "c", "a"]);
          assert.equal(state().past.length, before.past.length + 1);
          assert.equal(state().future.length, 0);
          const moved = snapshot(); state().undo(); assert.deepEqual(state().doc, before.doc);
          state().redo(); assert.deepEqual(state().doc, moved.doc);
        }
      } finally { m.close(); }
    });
  }
}

for (const active of [false, true]) {
  for (const change of ["undo", "redo", "page", "replace", "remote", "edit", "component", "mode", "breakpoint", "style", "selection", "primary", "text"]) {
    test(`${active ? "active" : "pending"} movement: ${change} synchronously invalidates the old destination`, () => {
      const m = mount();
      try {
        state().updatePage("p", { title: "Changed" });
        if (change === "redo") state().undo();
        m.start(active);
        if (change === "undo") state().undo();
        if (change === "redo") state().redo();
        if (change === "page") state().setActivePage("q");
        if (change === "replace") state().replaceDoc(canvasMoveDoc());
        if (change === "remote") { const doc = structuredClone(state().doc); doc.nodes.b.name = "Remote"; state().applyRemoteDoc(doc); }
        if (change === "edit") state().updateNode("b", { name: "Newer edit" });
        if (change === "component") useEditor.setState({ editingComponentId: "component" });
        if (change === "mode") state().setMode("preview");
        if (change === "breakpoint") state().setBreakpoint("sm");
        if (change === "style") state().setStyleState("hover");
        if (change === "selection") state().selectMany(["b", "c"], "b");
        if (change === "primary") useEditor.setState({ selection: "b" });
        if (change === "text") state().setEditingText("b");
        const before = snapshot();
        assert.equal(m.moveState.current, null); assert.equal(m.moveDropRef.current, null); assert.equal(m.ui.drag, null);
        m.pointer("pointermove"); m.pointer("pointerup", { buttons: 0 });
        assert.deepEqual(snapshot(), before);
      } finally { m.close(); }
    });
  }
}

for (const active of [false, true]) test(`${active ? "active" : "pending"} movement ignores other pointers and commits only the owner`, () => {
  const m = mount();
  try {
    const before = snapshot(); m.start(active);
    const gesture = m.moveState.current, ui = m.ui.drag;
    m.down({ id: 2, node: "b" });
    for (const type of ["pointermove", "pointercancel", "pointerup"]) {
      m.pointer(type, { id: 2, buttons: 0, x: 0, y: 0 });
      assert.equal(m.moveState.current, gesture); assert.equal(m.ui.drag, ui); assert.deepEqual(snapshot(), before);
    }
    m.pointer("pointermove"); m.pointer("pointerup", { buttons: 0 });
    assert.equal(m.ui.drag, null); assert.equal(m.moveState.current, null);
    assert.deepEqual(state().doc.pages.p.children, ["b", "c", "a"]);
    assert.equal(state().past.length, 1);
    state().undo(); assert.deepEqual(state().doc, before.doc);
    state().redo(); assert.deepEqual(state().doc.pages.p.children, ["b", "c", "a"]);
  } finally { m.close(); }
});

for (const selected of [[], ["a"], ["b"]]) {
  for (const style of ["default", "hover", "active", "focus"] as const) {
    test(`own selection from ${selected.join() || "none"}/${style} does not cancel a normal move`, () => {
      const m = mount();
      try {
        state().select(selected[0] ?? null); state().setStyleState(style);
        m.start(); assert.ok(m.ui.drag); assert.deepEqual(state().selectedIds, ["a"]);
        m.pointer("pointerup", { buttons: 0 });
        assert.deepEqual(state().doc.pages.p.children, ["b", "c", "a"]);
        assert.equal(state().past.length, 1);
      } finally { m.close(); }
    });
  }
}

for (const style of ["default", "hover", "active", "focus"] as const) test(`multi-selection in ${style} moves together in one reversible edit and excludes locked nodes`, () => {
  const m = mount();
  try {
    state().selectMany(["a", "b"], "a"); state().setStyleState(style);
    const before = snapshot(); m.start(); assert.deepEqual(m.ui.drag.dragIds, ["a", "b"]);
    m.pointer("pointerup", { buttons: 0 });
    assert.deepEqual(state().doc.pages.p.children, ["c", "a", "b"]);
    assert.deepEqual(state().selectedIds, ["a", "b"]); assert.equal(state().past.length, 1);
    const moved = snapshot(); state().undo(); assert.deepEqual(state().doc, before.doc);
    state().redo(); assert.deepEqual(state().doc, moved.doc);
    state().undo(); state().updateNode("b", { locked: true }); state().selectMany(["a", "b"], "a");
    m.start(); assert.deepEqual(m.ui.drag.dragIds, ["a"]); m.pointer("pointerup", { buttons: 0 });
    assert.deepEqual(state().doc.pages.p.children, ["b", "c", "a"]);
  } finally { m.close(); }
});

test("a click and sub-threshold movement leave history, redo, and selection untouched", () => {
  const m = mount();
  try {
    state().selectMany(["a", "b"], "b"); state().updatePage("p", { title: "Undoable" }); state().undo();
    const before = snapshot(); const selection = state().selectedIds;
    m.start(false); m.pointer("pointermove", { x: 3, y: 4 }); m.pointer("pointerup", { buttons: 0 });
    assert.deepEqual(snapshot(), before); assert.equal(state().selectedIds, selection); assert.equal(m.ui.drag, null);
    m.start(false); m.pointer("pointercancel"); assert.deepEqual(snapshot(), before);
  } finally { m.close(); }
});

test("release coordinates replace the last preview and repeated pointerdown cannot leave duplicate listeners", () => {
  const m = mount();
  try {
    m.start(); m.down({ node: "b" }); m.pointer("pointermove");
    m.hit("a"); m.pointer("pointerup", { y: 1, buttons: 0 });
    assert.deepEqual(state().doc.pages.p.children, ["b", "a", "c"]);
    assert.equal(state().past.length, 1); assert.equal(m.moveState.current, null);
    const saved = snapshot(); m.pointer("pointermove"); m.pointer("pointerup", { buttons: 0 });
    assert.deepEqual(snapshot(), saved);
  } finally { m.close(); }
});

test("unrelated store updates do not invalidate movement", () => {
  const m = mount();
  try {
    m.start(); useEditor.setState({ cloudState: "saved" });
    assert.ok(m.ui.drag); m.pointer("pointerup", { buttons: 0 });
    assert.deepEqual(state().doc.pages.p.children, ["b", "c", "a"]);
  } finally { m.close(); }
});

test("the browser fixture bundles the actual Canvas and movement hook", async () => {
  const bundle = await canvasMoveBundle();
  assert.match(bundle, /function Canvas/); assert.match(bundle, /function useCanvasDrag/);
});
