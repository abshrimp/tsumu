import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { transformSync } from "esbuild";
import * as React from "react";
import type { ScriptStep } from "../lib/types";

// 実際のまとまり・並びの effect と、共有の表示範囲の監視を動かす。ここで制御するのは、React の
// スケジュールと、ホストの寸法・フォーカスのイベントだけ。ブラウザでの下書きの確定と
// DOM の取り外しは、script-large-workspace.spec.ts で確かめる。
function mount(kind: "chunk" | "stack") {
  const workspace = {};
  const field = {};
  const sibling = {};
  const document = { activeElement: null as object | null };
  const element = Object.assign(new EventTarget(), {
    ownerDocument: document,
    closest: () => workspace,
    contains: (target: unknown) => target === field || target === sibling,
  });
  let intersect!: (entries: unknown[]) => void;
  let disconnected = false;
  const timers = new Map<number, () => void>();
  let timerId = 0;
  const globals = {
    document,
    IntersectionObserver: class {
      constructor(callback: typeof intersect) { intersect = callback; }
      observe() {}
      unobserve() {}
      disconnect() { disconnected = true; }
    },
    setTimeout: (callback: () => void) => { timers.set(++timerId, callback); return timerId; },
    clearTimeout: (id: number) => timers.delete(id),
  };
  const load = (path: string, overrides: Record<string, unknown> = {}) => {
    const require = createRequire(resolve(path));
    const mod = { exports: {} as any };
    const code = transformSync(readFileSync(path, "utf8"), {
      loader: path.endsWith("tsx") ? "tsx" : "ts", jsx: "automatic", format: "cjs",
    }).code;
    new Function("require", "module", "exports", ...Object.keys(globals), code)(
      (id: string) => overrides[id] ?? require(id), mod, mod.exports, ...Object.values(globals),
    );
    return mod.exports;
  };
  const effects: (() => (() => void) | undefined)[] = [];
  let mounted = false;
  let writes = 0;
  let refs = 0;
  const hooks = {
    ...React,
    useContext: () => ({ readOnly: false, virtualizeStacks: true, selected: new Set(), zOrder: new Map() }),
    useMemo: (fn: () => unknown) => fn(),
    useRef: (initial: unknown) => ({ current: refs++ === 0 ? element : initial }),
    useState: (initial: boolean) => {
      mounted = initial;
      return [initial, (value: boolean) => { mounted = value; writes++; }];
    },
    useEffect: (fn: () => (() => void) | undefined) => effects.push(fn),
    useLayoutEffect() {},
  };
  const views = load("components/script-editor/blocks.tsx", {
    react: hooks,
    "./visibility": load("components/script-editor/visibility.ts"),
  });
  const steps: ScriptStep[] = Array.from({ length: 144 }, (_, i) => ({
    id: `wait-${i}`, kind: "wait", seconds: 1,
  }));
  if (kind === "stack") {
    views.StackView({ script: { id: "script", steps, pos: { x: 0, y: 0 } } });
  } else {
    const list = views.StepList({ scriptId: "script", list: "root", steps });
    const chunk = list.props.children[1][0];
    chunk.type(chunk.props);
  }
  const cleanups = effects.map((effect) => effect());
  return {
    get mounted() { return mounted; },
    get writes() { return writes; },
    get disconnected() { return disconnected; },
    get pending() { return timers.size; },
    visible(value: boolean) { intersect([{ target: element, isIntersecting: value }]); },
    focus() { document.activeElement = field; },
    blur(within = false) {
      document.activeElement = null;
      element.dispatchEvent(new Event("focusout"));
      if (within) document.activeElement = sibling;
    },
    flush() {
      const pending = [...timers.values()];
      timers.clear();
      pending.forEach((callback) => callback());
    },
    close() { cleanups.forEach((cleanup) => cleanup?.()); },
  };
}

for (const kind of ["chunk", "stack"] as const) {
  test(`${kind}: offscreen focus retention ends after blur without another intersection`, () => {
    const view = mount(kind);
    try {
      view.visible(true);
      view.focus();
      view.visible(false);
      assert.equal(view.mounted, true, "keep the focused draft mounted");
      view.blur();
      assert.equal(view.mounted, true, "allow the blur commit to finish before unmounting");
      view.flush();
      assert.equal(view.mounted, false, "release offscreen blocks once focus has left");
    } finally { view.close(); }
  });

  test(`${kind}: moving focus within an offscreen view preserves it until focus leaves`, () => {
    const view = mount(kind);
    try {
      view.visible(true);
      view.focus();
      view.visible(false);
      view.blur(true);
      view.flush();
      assert.equal(view.mounted, true);
      view.blur();
      view.flush();
      assert.equal(view.mounted, false);
    } finally { view.close(); }
  });

  test(`${kind}: a pending blur cannot hide a view that becomes visible again`, () => {
    const view = mount(kind);
    try {
      view.visible(true);
      view.focus();
      view.visible(false);
      view.blur();
      view.visible(true);
      view.flush();
      assert.equal(view.mounted, true);
    } finally { view.close(); }
  });

  test(`${kind}: cleanup removes pending focus work and the observer`, () => {
    const view = mount(kind);
    view.visible(true);
    view.focus();
    view.visible(false);
    view.blur();
    view.close();
    const writes = view.writes;
    assert.equal(view.pending, 0);
    assert.equal(view.disconnected, true);
    view.blur();
    view.flush();
    assert.equal(view.writes, writes, "do not update an unmounted component");
  });
}
