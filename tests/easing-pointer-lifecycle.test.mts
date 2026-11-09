import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { transformSync } from "esbuild";

function fixture() {
  const path = resolve("components/MotionEditors.tsx"), require = createRequire(path);
  const events = new EventTarget(), refs: any[] = [], states: any[] = [], effects = new Map<number, any>();
  let index = 0;
  const react = { ...require("react"), useId: () => "easing-test", useMemo: (fn: any) => fn(), useCallback: (fn: any) => fn,
    useRef: (value: any) => { const id = index++; return refs[id] ??= { current: value }; },
    useReducer: () => [0, () => {}],
    useState: (initial: any) => { const id = index++; if (!(id in states)) states[id] = typeof initial === "function" ? initial() : initial;
      return [states[id], (v: any) => { states[id] = typeof v === "function" ? v(states[id]) : v; }]; },
    useEffect: (effect: any) => { const id = index++; if (!effects.has(id)) effects.set(id, effect()); },
  };
  react.useLayoutEffect = react.useEffect;
  const mod = { exports: {} as any };
  const code = transformSync(readFileSync(path, "utf8"), { loader: "tsx", format: "cjs", jsx: "automatic" }).code;
  // The tracker uses window too; execute its real implementation in the same
  // isolated EventTarget instead of attaching listeners to a test global.
  const tracker = { exports: {} as any };
  const trackerCode = transformSync(readFileSync(resolve("lib/motion-pointer-drag.ts"), "utf8"), { loader: "ts", format: "cjs" }).code;
  new Function("module", "exports", "window", trackerCode)(tracker, tracker.exports, events);
  new Function("require", "module", "exports", "window", "requestAnimationFrame", "cancelAnimationFrame", code)((id: string) =>
    id === "react" ? react : id === "../lib/motion-pointer-drag" ? tracker.exports : require(id), mod, mod.exports, events, () => 1, () => {});
  const svg = Object.assign(new EventTarget(), { captured: new Set<number>(),
    setPointerCapture(id: number) { this.captured.add(id); }, hasPointerCapture(id: number) { return this.captured.has(id); },
    releasePointerCapture(id: number) { this.captured.delete(id); },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 300, height: 240 }),
  });
  const flatten = (v: any): any[] => Array.isArray(v) ? v.flatMap(flatten) : v && typeof v === "object" ? [v, ...flatten(v.props?.children)] : [];
  const render = () => {
    index = 0;
    const tree = mod.exports.EasingEditorModal({ value: "cubic-bezier(0.25, 0.25, 0.75, 0.75)", duration: 1, onApply: () => {}, onClose: () => {} });
    const items = flatten(tree), graph = items.find(e => e.type === "svg" && e.props.className.startsWith("ee-graph"));
    graph.props.ref.current = svg;
    return { handles: items.filter(e => e.type === "circle" && e.props.className.startsWith("ee-handle")), value: graph.props["aria-label"] };
  };
  const dispatch = (type: string, props = {}) => { const e = new Event(type); Object.assign(e, props); events.dispatchEvent(e); };
  return { render, svg, dispatch, start: (button = 0, pointerId = 1) => render().handles[0].props.onPointerDown({ button, pointerId, preventDefault() {}, currentTarget: svg }),
    close: () => effects.forEach(cleanup => cleanup?.()) };
}

test("easing handle tracks only its owning pointer and ends on blur", () => {
  const f = fixture();
  try {
    const initial = f.render().value; f.start();
    f.dispatch("pointermove", { pointerId: 999, buttons: 1, clientX: 200, clientY: 100 });
    assert.equal(f.render().value, initial);
    f.dispatch("pointerup", { pointerId: 999 }); assert.equal(f.svg.hasPointerCapture(1), true);
    f.dispatch("pointermove", { pointerId: 1, buttons: 1, clientX: 170, clientY: 100 });
    const moved = f.render().value; assert.notEqual(moved, initial);
    f.dispatch("blur"); assert.equal(f.svg.hasPointerCapture(1), false);
    f.dispatch("pointermove", { pointerId: 1, buttons: 1, clientX: 220, clientY: 100 });
    assert.equal(f.render().value, moved);
  } finally { f.close(); }
});
test("right button does not start an easing drag, and unmount releases capture", () => {
  const f = fixture(); f.start(2); assert.equal(f.svg.captured.size, 0);
  f.start(); assert.equal(f.svg.hasPointerCapture(1), true);
  const before = f.render().value; f.close();
  assert.equal(f.svg.captured.size, 0);
  f.dispatch("pointermove", { pointerId: 1, buttons: 1, clientX: 220, clientY: 100 });
  assert.equal(f.render().value, before);
});
