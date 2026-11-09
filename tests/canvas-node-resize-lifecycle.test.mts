import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { test } from "node:test";
import { transformSync } from "esbuild";
import { useEditor } from "../lib/store";
import { canvasMoveDoc } from "./helpers/canvas-move";

const state = () => useEditor.getState();
const width = () => state().doc.nodes.a.styles.base?.default?.width;

function mount() {
  state().replaceDoc(canvasMoveDoc());
  state().setActivePage("p");
  state().setMode("design");
  state().setBreakpoint("base");
  state().select("a");
  const win = new EventTarget();
  const doc = Object.assign(new EventTarget(), { visibilityState: "visible" });
  const target = Object.assign(new EventTarget(), {
    captured: new Set<number>(),
    setPointerCapture(id: number) { this.captured.add(id); },
    hasPointerCapture(id: number) { return this.captured.has(id); },
    releasePointerCapture(id: number) {
      this.captured.delete(id);
      this.dispatchEvent(Object.assign(new Event("lostpointercapture"), { pointerId: id }));
    },
  });
  const element = { offsetWidth: 100, offsetHeight: 60 };
  const frameRef = { current: { querySelector: () => element } };
  const refs: { current: any }[] = [];
  const cleanups: (() => void)[] = [];
  let refIndex = 0, mounted = false;
  const hooks = {
    useRef: (value: unknown) => refs[refIndex++] ?? (refs[refIndex - 1] = { current: value }),
    useLayoutEffect: (fn: () => () => void) => { if (!mounted) cleanups.push(fn()); },
  };
  const path = resolve("components/canvas/useCanvasDrag.ts");
  const require = createRequire(path);
  const mod = { exports: {} as any };
  const code = transformSync(readFileSync(path, "utf8"), { loader: "ts", format: "cjs" }).code;
  new Function("require", "module", "exports", "window", "document", code)((id: string) => {
    if (id === "react") return hooks;
    if (id === "../../lib/store") return { ...require(id), useEditor };
    if (id === "../../lib/image-drop") return { useImageDrop: () => ({ uploading: false, dropFiles() {} }) };
    return require(id);
  }, mod, mod.exports, win, doc);

  let startResize: (event: any, dir: string) => void;
  const render = () => {
    refIndex = 0;
    startResize = mod.exports.useCanvasDrag({
      ...state(), frameRef, scale: 1, editingComp: null, editingText: null,
      innerRef: { current: null }, moveState: { current: null }, moveDropRef: { current: null },
      movedJustNow: { current: false }, setMoveDrag() {}, setDropState() {}, setElemDropTarget() {},
      elemDropTarget: null, dropState: "none",
    }).startResize;
    mounted = true;
  };
  render();
  const down = (id = 1, dir = "se", button = 0) => {
    render();
    startResize!({ currentTarget: target, pointerId: id, clientX: 0, clientY: 0, button,
      preventDefault() {}, stopPropagation() {} }, dir);
  };
  const event = (type: string, { id = 1, x = 0, y = 0, buttons = 1, key = "" } = {}) => {
    const e = Object.assign(new Event(type, { cancelable: true }), {
      pointerId: id, clientX: x, clientY: y, buttons, key,
      preventDefault() { Object.getPrototypeOf(e).preventDefault.call(this); },
    });
    win.dispatchEvent(e);
    return e;
  };
  const close = () => { for (const fn of cleanups.splice(0).reverse()) fn(); };
  return { win, doc, target, down, event, close };
}

test("canvas node resizing is owned by the initiating pointer and is one undo step", () => {
  const f = mount();
  try {
    const before = structuredClone(state().doc);
    f.down();
    f.event("pointermove", { x: 20, y: 10 });
    assert.equal(width(), "120px");
    f.down(2, "nw");
    f.event("pointermove", { id: 2, x: 90, y: 90 });
    f.event("pointerup", { id: 2, buttons: 0 });
    assert.equal(width(), "120px", "other pointers cannot hijack a resize");
    f.event("pointermove", { x: 30 });
    assert.equal(width(), "130px");
    f.event("pointerup", { buttons: 0 });
    assert.equal(f.target.captured.size, 0);
    assert.equal(state().past.length, 1);
    const after = structuredClone(state().doc);
    state().undo();
    assert.deepEqual(state().doc, before);
    state().redo();
    assert.deepEqual(state().doc, after);
  } finally { f.close(); }
});

for (const reason of ["cancel", "lost-capture", "blur", "hidden", "released-outside", "escape", "unmount"]) {
  test(`canvas node resize ${reason} stops without accepting delayed moves`, () => {
    const f = mount();
    try {
      f.down();
      f.event("pointermove", { x: 20 });
      assert.equal(width(), "120px");
      if (reason === "cancel") f.event("pointercancel", { buttons: 0 });
      if (reason === "lost-capture") f.target.releasePointerCapture(1);
      if (reason === "blur") f.win.dispatchEvent(new Event("blur"));
      if (reason === "hidden") { f.doc.visibilityState = "hidden"; f.doc.dispatchEvent(new Event("visibilitychange")); }
      if (reason === "released-outside") f.event("pointermove", { x: 40, buttons: 0 });
      if (reason === "escape") {
        const result = f.event("keydown", { key: "Escape" });
        assert.equal(result.defaultPrevented, true);
      }
      if (reason === "unmount") f.close();
      f.event("pointermove", { x: 100 });
      f.event("pointerup", { buttons: 0 });
      assert.equal(width(), "120px");
      assert.equal(f.target.captured.size, 0);
      if (reason !== "unmount") {
        f.down();
        f.event("pointermove", { x: 30 });
        f.event("pointerup", { buttons: 0 });
        assert.equal(width(), "130px");
      }
    } finally { f.close(); }
  });
}

test("remote edits invalidate the canvas resize without overwriting the new document", () => {
  const f = mount();
  try {
    f.down();
    f.event("pointermove", { x: 20 });
    const remote = structuredClone(state().doc);
    remote.nodes.b.name = "Collaborator edit";
    state().applyRemoteDoc(remote);
    assert.equal(f.target.captured.size, 0);
    f.event("pointermove", { x: 120 });
    f.event("pointerup", { buttons: 0 });
    assert.equal(width(), "120px");
    assert.equal(state().doc.nodes.b.name, "Collaborator edit");
    f.down();
    f.event("pointermove", { x: 30 });
    f.event("pointerup", { buttons: 0 });
    assert.equal(width(), "130px");
    assert.equal(state().doc.nodes.b.name, "Collaborator edit");
  } finally { f.close(); }
});
