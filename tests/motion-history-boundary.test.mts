import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { transformSync } from "esbuild";

function fixture() {
  const path = resolve("components/MotionEditors.tsx");
  const require = createRequire(path);
  const mod = { exports: {} as any };
  const events = new EventTarget();
  const ref = { current: null as any };
  let mounted = false;
  const cleanups: (() => void)[] = [];
  const source = readFileSync(path, "utf8") + "\nexport { useHistory as testHistory };";
  const code = transformSync(source, { loader: "tsx", format: "cjs", jsx: "automatic" }).code;
  new Function("require", "module", "exports", "window", code)((id: string) => {
    if (id === "react") return {
      ...require(id), useRef: () => ref, useReducer: () => [0, () => {}], useCallback: (f: any) => f,
      useEffect: (effect: () => () => void) => { if (!mounted) cleanups.push(effect()); },
    };
    return require(id);
  }, mod, mod.exports, events);
  const render = () => { const value = mod.exports.testHistory(() => 0); mounted = true; return value; };
  const move = () => { const e = new Event("pointermove"); Object.assign(e, { pointerId: 1 }); events.dispatchEvent(e); };
  return { render, move, close: () => cleanups.forEach(c => c()) };
}

test("a drag update after undo starts a new undoable edit", () => {
  const f = fixture();
  try {
    let h = f.render(); h.beginGesture(1); f.move(); h.set(1);
    h = f.render(); h.undo();
    h = f.render(); assert.equal(h.value, 0); assert.equal(h.canRedo, true);
    h.set(2);
    h = f.render(); assert.equal(h.value, 2); assert.equal(h.canUndo, true); assert.equal(h.canRedo, false);
    h.undo(); assert.equal(f.render().value, 0);
  } finally { f.close(); }
});
test("redo followed by remaining drag updates does not consume the preceding history entry", () => {
  const f = fixture();
  try {
    let h = f.render(); h.beginGesture(1); f.move(); h.set(1);
    h = f.render(); h.undo(); h = f.render(); h.redo();
    h = f.render(); assert.equal(h.value, 1); h.set(2);
    h = f.render(); h.undo(); assert.equal(f.render().value, 1);
    f.render().undo(); assert.equal(f.render().value, 0);
  } finally { f.close(); }
});
