import { describe, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { transformSync } from "./helpers/bundle";
import { easeAt, easingValue, parseEasing } from "../lib/easing";
import { parseKeyframes, serializeKeyframes } from "../lib/keyframes";
import { KEYFRAMES, motionCss, keyframesCss } from "../lib/motion";
import { makeBox } from "../lib/presets";
import { useEditor } from "../lib/store";
import { type SiteDoc } from "../lib/types";
import { trackMotionPointer } from "../lib/motion-pointer-drag";

describe("easing-pointer-lifecycle", () => {
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
  // 追跡の処理も window を使う。テスト用のグローバルにリスナーを付けず、
  // 同じ切り離した EventTarget の中で、実際の実装を実行する。
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
});

describe("motion-editors", () => {
const close = (a: number, b: number, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test("easing keywords and cubic-bezier values round-trip", () => {
  assert.deepEqual(parseEasing("ease-out"), { kind: "bezier", b: [0, 0, 0.58, 1] });
  assert.equal(easingValue({ kind: "bezier", b: [0.42, 0, 0.58, 1] }), "ease-in-out");
  assert.equal(easingValue({ kind: "bezier", b: [0.123, 0.5, 0.456, 1.2] }), "cubic-bezier(0.123, 0.5, 0.456, 1.2)");
  // プリセットと同じ曲線は、プリセットの書き方に戻す（ドロップダウンで選択中として表示される）
  assert.equal(easingValue(parseEasing("cubic-bezier(0.340, 1.56, 0.64, 1.0)")!), "cubic-bezier(0.34, 1.56, 0.64, 1)");
});

test("easing values that cannot be drawn are rejected", () => {
  assert.equal(parseEasing("cubic-bezier(1.2, 0, 0, 1)"), null);
  assert.equal(parseEasing("cubic-bezier(0, 0, 1)"), null);
  assert.equal(parseEasing("linear(0, 0.5 20%, 1)"), null);
  assert.equal(parseEasing("steps(1, jump-none)"), null);
});

test("steps follow the CSS definition", () => {
  const end = parseEasing("steps(4)")!;
  assert.deepEqual(end, { kind: "steps", n: 4, pos: "jump-end" });
  assert.equal(easeAt(end, 0), 0);
  assert.equal(easeAt(end, 0.3), 0.25);
  assert.equal(easeAt(end, 1), 1);
  const start = parseEasing("steps(4, start)")!;
  assert.equal(easeAt(start, 0), 0.25);
  const none = parseEasing("steps(3, jump-none)")!;
  assert.equal(easeAt(none, 0.5), 0.5);
  const both = parseEasing("steps(3, jump-both)")!;
  assert.equal(easeAt(both, 0), 0.25);
  assert.equal(easingValue(start), "steps(4, jump-start)");
  assert.equal(easingValue(end), "steps(4)");
});

test("bezier evaluation matches known points", () => {
  const linear = parseEasing("linear")!;
  close(easeAt(linear, 0.37), 0.37);
  const ease = parseEasing("ease-in-out")!;
  close(easeAt(ease, 0.5), 0.5);
  assert.ok(easeAt(parseEasing("ease-in")!, 0.25) < 0.25);
  // 行き過ぎる曲線は、1 を超える
  assert.ok(easeAt(parseEasing("cubic-bezier(0.34, 1.56, 0.64, 1)")!, 0.6) > 1);
});

test("keyframes are split into editable properties", () => {
  const list = parseKeyframes("from { opacity: 0; transform: translateY(24px) scale(0.9); filter: blur(4px); }")!;
  assert.equal(list.length, 1);
  assert.equal(list[0].offset, 0);
  assert.equal(list[0].opacity, 0);
  assert.equal(list[0].y, 24);
  assert.equal(list[0].scale, 0.9);
  assert.equal(list[0].extra, "filter: blur(4px);");
});

test("grouped selectors become separate keyframes and the same offset is merged", () => {
  const list = parseKeyframes("0%, 100% { transform: translateX(0); } 50% { transform: translateX(6px); } 100% { opacity: 1; }")!;
  assert.deepEqual(list.map((k) => k.offset), [0, 50, 100]);
  assert.equal(list[2].x, 0);
  assert.equal(list[2].opacity, 1);
});

test("transforms that would change meaning stay as raw CSS", () => {
  // 回転してから移動すると、項目に分けた順（移動 → 回転）とは見た目が変わる
  const list = parseKeyframes("to { transform: rotate(45deg) translateX(10px); }")!;
  assert.equal(list[0].x, undefined);
  assert.equal(list[0].extra, "transform: rotate(45deg) translateX(10px);");
  const flip = parseKeyframes("to { transform: perspective(600px) rotateY(360deg); }")!;
  assert.match(flip[0].extra, /perspective/);
});

test("invalid keyframe CSS is rejected", () => {
  assert.equal(parseKeyframes("from { opacity: 0;"), null);
  assert.equal(parseKeyframes("middle { opacity: 0; }"), null);
  assert.equal(parseKeyframes("opacity: 0;"), null);
  assert.deepEqual(parseKeyframes(""), []);
});

test("serialized keyframes share the same transform functions", () => {
  const css = serializeKeyframes([
    { id: "a", offset: 0, y: 20, extra: "" },
    { id: "b", offset: 100, scale: 1.2, extra: "" },
    { id: "c", offset: 50, opacity: 0.5, extra: "filter: blur(2px)" },
  ]);
  assert.equal(
    css,
    [
      "from { transform: translateY(20px) scale(1); }",
      "50% { opacity: 0.5; filter: blur(2px); }",
      "to { transform: translateY(0px) scale(1.2); }",
    ].join("\n")
  );
});

test("every built-in keyframe preset parses and keeps its meaning", () => {
  for (const kf of KEYFRAMES) {
    const list = parseKeyframes(kf.css);
    assert.ok(list, kf.key);
    // 書き出したものをもう一度読んでも、同じ内容になる
    const again = parseKeyframes(serializeKeyframes(list!))!;
    const strip = (l: typeof list) => l!.map(({ id: _id, ...rest }) => rest);
    assert.deepEqual(strip(again), strip(list), kf.key);
  }
});

test("keyframes preserve case-sensitive custom property names and quoted comment text", () => {
  const source = 'from { --fadeLevel: 0.25; --label: "a/*keep*/b"; opacity: var(--fadeLevel); }';
  const parsed = parseKeyframes(source)!;
  assert.ok(parsed);
  assert.equal(serializeKeyframes(parsed), source);
});

for (const declaration of [
  'opacity: var(--fadeLevel, 0.2); opacity: 0.8;',
  'transform: translate3d(4px, 5px, 6px); transform: translateX(12px);',
  'opacity: 0.8; opacity: var(--fadeLevel, 0.2);',
]) {
  test(`keyframes preserve the cascade of repeated declarations: ${declaration}`, () => {
    const source = `from { ${declaration} }`;
    const parsed = parseKeyframes(source)!;
    assert.ok(parsed);
    assert.equal(serializeKeyframes(parsed), source);
    assert.equal(parsed[0].opacity, undefined);
    assert.equal(parsed[0].x, undefined);
  });
}

test("keyframe rules sharing an offset preserve declaration order at that offset", () => {
  const parsed = parseKeyframes('from, to { opacity: var(--fadeLevel, 0.2); } to { opacity: 0.8; transform: translateX(12px); }')!;
  assert.ok(parsed);
  assert.equal(parsed[1].opacity, undefined);
  assert.equal(parsed[1].x, 12);
  assert.match(serializeKeyframes(parsed), /to \{ transform: translateX\(12px\); opacity: var\(--fadeLevel, 0.2\); opacity: 0.8; \}/);
});

test("escaped quotes do not turn CSS string contents into declarations or comments", () => {
  const source = String.raw`from { --label: "a\";/*keep*/b"; opacity: 0.5; }`;
  const parsed = parseKeyframes(source)!;
  assert.ok(parsed);
  assert.equal(parsed[0].extra, String.raw`--label: "a\";/*keep*/b";`);
  assert.equal(parsed[0].opacity, 0.5);
  assert.equal(serializeKeyframes(parseKeyframes(serializeKeyframes(parsed))!), serializeKeyframes(parsed));
});

test("CSS comments outside strings do not join separate tokens", () => {
  const parsed = parseKeyframes('/* start */ from { opacity: 0.5; --label: a/**/b; } /* end */')!;
  assert.ok(parsed);
  assert.equal(parsed[0].opacity, 0.5);
  assert.equal(parsed[0].extra, '--label: a b;');
  assert.equal(parseKeyframes('from { opacity: 0.5; } /* unfinished'), null);
  assert.equal(parseKeyframes('from { --label: "unfinished; }'), null);
});

for (const declaration of [
  'all: initial; opacity: 0.8; transform: translateX(12px);',
  '-webkit-transform: translateX(4px); transform: translateX(12px);',
]) {
  test(`keyframes keep CSS resets and aliases in order: ${declaration}`, () => {
    const source = `from { ${declaration} }`;
    const parsed = parseKeyframes(source)!;
    assert.ok(parsed);
    assert.equal(serializeKeyframes(parsed), source);
  });
}

for (const declaration of [
  String.raw`\6f pacity: 0.2; opacity: 0.8;`,
  String.raw`\2d \2d fadeLevel: 0.25; opacity: var(--fadeLevel);`,
]) {
  test(`escaped CSS property names preserve their case and cascade: ${declaration}`, () => {
    const source = `from { ${declaration} }`;
    const parsed = parseKeyframes(source)!;
    assert.ok(parsed);
    assert.equal(parsed[0].opacity, undefined);
    assert.equal(serializeKeyframes(parsed), source);
  });
}

test("easing parsing treats prototype names and malformed steps as raw values", () => {
  for (const value of ["constructor", "__proto__", "steps(3, constructor)", "steps(3, __proto__)", "steps(3, jump-end, ignored)", "steps(3, jump-end,)"]) {
    assert.equal(parseEasing(value), null, value);
  }
});

test("easing parsing never produces infinite control points", () => {
  const huge = "9".repeat(400);
  assert.equal(parseEasing(`cubic-bezier(0, ${huge}, 1, 1)`), null);
  assert.equal(parseEasing(`cubic-bezier(0, 0, 1, -${huge})`), null);
  assert.equal(parseEasing(`steps(${huge})`), null);
  for (const value of ["EASE", "steps(3, START)", "steps(3, end)", "steps(3, jump-both)"]) {
    assert.ok(parseEasing(value), value);
  }
});

test("keyframe serialization preserves nearby offsets and exported jump timing", () => {
  const source = "from { transform: translateX(0px); } 49.9999% { transform: translateX(100px); } 50% { transform: translateX(0px); } to { transform: translateX(100px); }";
  const saved = serializeKeyframes(parseKeyframes(source)!);
  const points = (css: string) => parseKeyframes(css)!.map(({ offset, x }) => [offset, x]);
  assert.deepEqual(points(saved), points(source));
  assert.equal(serializeKeyframes(parseKeyframes(saved)!), saved);
  const generated = motionCss([{ id: "jump", trigger: "load", keyframes: "custom", customKeyframes: saved, duration: 1, delay: 0, easing: "linear" }], "run", "box");
  assert.equal(generated.customKeyframes.length, 1);
  assert.deepEqual(points(generated.customKeyframes[0].css), points(source));
  assert.ok(keyframesCss(generated.usedKeyframes, generated.customKeyframes).includes("49.9999%"));
});

test("keyframe serialization retains small and high-precision property values", () => {
  const source = "0.0000001% { opacity: 0.0001; transform: translate(0.0000001px, -12.123456789px) rotate(0.0001deg) scale(0.0001); }";
  const values = (css: string) => parseKeyframes(css)!.map(({ id, ...value }) => value);
  const saved = serializeKeyframes(parseKeyframes(source)!);
  assert.deepEqual(values(saved), values(source));
  assert.equal(serializeKeyframes(parseKeyframes(saved)!), saved);
});

test("unsupported inherited transform names stay raw instead of becoming scale", () => {
  const css = "from { transform: constructor(2); }";
  const frames = parseKeyframes(css)!;
  assert.equal(frames[0].scale, undefined);
  assert.equal(frames[0].extra, "transform: constructor(2);");
  assert.equal(serializeKeyframes(frames), css);
});

test("overflowing keyframe values remain raw and never enter numeric editor fields", () => {
  for (const declaration of [
    "opacity: 1e309;",
    "transform: translateX(1e309px);",
    "transform: translate(1px, -1e309px);",
    "transform: scale(1e309);",
    "transform: rotate(1e309deg);",
    "transform: rotate(1e308turn);",
    "transform: rotate(1e308rad);",
  ]) {
    const css = `from { ${declaration} }`;
    const frames = parseKeyframes(css)!;
    assert.equal(frames[0].extra, declaration);
    for (const key of ["opacity", "x", "y", "scale", "rotate"] as const) assert.equal(frames[0][key], undefined);
    assert.equal(serializeKeyframes(frames), css);
  }
});


test("easing serialization preserves precise and very small coordinates", () => {
  for (const value of ["cubic-bezier(0.000001, 0.12567, 0.987654, 1.234567)", "cubic-bezier(1e-8, -2E-7, 0.9, 1.000001)", "cubic-bezier(0.1, 1e308, 0.9, 1)"]) {
    const parsed = parseEasing(value)!;
    assert.ok(parsed);
    assert.deepEqual(parseEasing(easingValue(parsed)), parsed);
  }
  assert.notEqual(easingValue(parseEasing("cubic-bezier(0.41999, 0, 0.58001, 1)")!), "ease-in-out");
});

test("CSS steps integer syntax is not silently repaired into a different value", () => {
  for (const value of ["steps(2.0)", "steps(2e1)", "steps(.2e1)"]) assert.equal(parseEasing(value), null);
  assert.deepEqual(parseEasing("steps(+2)"), { kind: "steps", n: 2, pos: "jump-end" });
});
});

describe("motion-history-boundary", () => {
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

test("motion CSS editing creates separate undo entries after blur", () => {
  const f = fixture();
  try {
    let h = f.render(); h.set(1, "css-text");
    h.set(2, "css-text");
    assert.equal(f.render().value, 2);
    h.endMerge();
    h.set(3, "css-text");
    h = f.render(); h.undo();
    assert.equal(f.render().value, 2, "undo returns to the previous editing session");
    f.render().undo();
    assert.equal(f.render().value, 0, "same-session keystrokes remain grouped");
    f.render().redo();
    assert.equal(f.render().value, 2);
    f.render().redo();
    assert.equal(f.render().value, 3);
  } finally { f.close(); }
});

test("motion CSS typing after a pause starts a new undo step without losing redo", () => {
  const f = fixture();
  const originalNow = Date.now;
  let now = 10_000;
  try {
    Date.now = () => now;
    let h = f.render();
    h.set(1, "css-text");
    now += 200;
    h.set(2, "css-text");
    now += 2_000;
    h.set(3, "css-text");
    h = f.render(); h.undo();
    assert.equal(f.render().value, 2);
    f.render().undo();
    assert.equal(f.render().value, 0);
  } finally { Date.now = originalNow; f.close(); }
});
});

describe("motion-modal-atomicity", () => {
  before(() => {
    useEditor.setState({
      breakpoint: "base", customWidth: null, styleState: "default", mode: "design",
      pageTheme: "light", selection: null, selectedIds: [], editingComponentId: null, scriptEditor: null,
    });
  });
const current = () => useEditor.getState();
const flatten = (node: any): any[] =>
  Array.isArray(node) ? node.flatMap(flatten) :
  node && typeof node === "object" ? [node, ...flatten(node.props?.children)] : [];

function mount() {
  const doc: SiteDoc = {
    siteName: "Motion modal test", assets: {}, pageOrder: ["p"],
    pages: { p: { id: "p", name: "Home", slug: "", title: "Home", description: "", children: ["a"] } },
    nodes: { a: { ...makeBox(), id: "a", motions: [{
      id: "motion-1", trigger: "load", property: "all", keyframes: "fade-up",
      duration: 0.3, delay: 0, easing: "ease-out", repeat: 1, direction: "normal", fillMode: "both",
    }] } },
  };
  current().replaceDoc(doc);
  current().setActivePage("p");
  current().select("a");

  const path = resolve("components/style-panel/MotionSec.tsx");
  const require = createRequire(path);
  const code = transformSync(readFileSync(path, "utf8"), { loader: "tsx", format: "cjs", jsx: "automatic" }).code;
  const module = { exports: {} as any };
  const cells: unknown[] = [];
  let cursor = 0;
  function KeyframeEditorModal() { return null; }
  function EasingEditorModal() { return null; }
  function EasingCurve() { return null; }
  new Function("require", "module", "exports", code)((id: string) => {
    if (id === "react") return {
      ...require(id),
      useState: (init: unknown) => {
        const n = cursor++;
        if (!(n in cells)) cells[n] = typeof init === "function" ? (init as () => unknown)() : init;
        return [cells[n], (v: any) => { cells[n] = typeof v === "function" ? v(cells[n]) : v; }];
      },
    };
    if (id === "../../lib/store") return {
      useEditor: (selector: (state: ReturnType<typeof useEditor.getState>) => unknown) => selector(current()),
    };
    if (id === "../MotionEditors") return { KeyframeEditorModal, EasingEditorModal, EasingCurve };
    if (id === "../controls") return { Dropdown: "Dropdown", Grp: "Grp", NumField: "NumField" };
    if (id === "./shared") return { Sec: "Sec", I: 12 };
    return require(id);
  }, module, module.exports);
  const render = () => { cursor = 0; return flatten(module.exports.MotionSec({ node: current().doc.nodes.a })); };
  const picker = () => render().find(
    (v) => v.type === "Dropdown" && v.props.options?.some((o: any) => o.value === "custom") &&
      v.props.options?.some((o: any) => o.value === "fade-up")
  );
  const modal = () => render().find((v) => v.type === KeyframeEditorModal);
  return { render, picker, modal };
}

test("selecting custom keyframes and cancelling does not modify the document or history", () => {
  const ui = mount();
  const before = structuredClone({ doc: current().doc, past: current().past, future: current().future });
  const dropdown = ui.picker();
  assert.ok(dropdown, "the actual keyframe dropdown must be rendered");
  dropdown.props.onChange("custom");
  const opened = ui.modal();
  assert.ok(opened, "custom selection must open the keyframe editor");
  assert.match(opened.props.css, /\b(?:from|0%)\s*\{/);
  assert.deepEqual({ doc: current().doc, past: current().past, future: current().future }, before);
  opened.props.onClose();
  assert.equal(ui.modal(), undefined);
  assert.deepEqual({ doc: current().doc, past: current().past, future: current().future }, before);
});

test("applying custom keyframes changes preset and CSS in a single undoable document edit", () => {
  const ui = mount();
  const before = structuredClone(current().doc);
  ui.picker().props.onChange("custom");
  const modal = ui.modal();
  assert.ok(modal);
  const css = "from { opacity: 0.25; } to { opacity: 1; }";
  modal.props.onApply(css);
  assert.equal(ui.modal(), undefined);
  assert.equal(current().doc.nodes.a.motions?.[0].keyframes, "custom");
  assert.equal(current().doc.nodes.a.motions?.[0].customKeyframes, css);
  assert.equal(current().past.length, 1);
  const after = structuredClone(current().doc);
  current().undo();
  assert.deepEqual(current().doc, before);
  current().redo();
  assert.deepEqual(current().doc, after);
});

test("reopening a custom motion edits its saved CSS without changing it on Cancel", () => {
  const ui = mount();
  ui.picker().props.onChange("custom");
  ui.modal().props.onApply("from { opacity: 0.25; }");
  const before = structuredClone({ doc: current().doc, past: current().past, future: current().future });
  const edit = ui.render().find((v) => v.type === "button" && v.props.className === "btn me-open");
  assert.ok(edit);
  edit.props.onClick();
  const modal = ui.modal();
  assert.equal(modal.props.css, "from { opacity: 0.25; }");
  modal.props.onClose();
  assert.deepEqual({ doc: current().doc, past: current().past, future: current().future }, before);
});
});

describe("motion-pointer-drag", () => {
function pointer(type: string, pointerId = 1, x = 10, buttons = 1): PointerEvent {
  return Object.assign(new Event(type), { pointerId, clientX: x, buttons }) as PointerEvent;
}

function fixture() {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  const events = new EventTarget();
  const target = Object.assign(new EventTarget(), {
    captured: null as number | null,
    setPointerCapture(id: number) { this.captured = id; },
    hasPointerCapture(id: number) { return this.captured === id; },
    releasePointerCapture(id: number) {
      this.captured = null;
      this.dispatchEvent(pointer("lostpointercapture", id));
    },
  });
  Object.defineProperty(globalThis, "window", { configurable: true, value: events });
  const moves: number[] = [];
  const ends: (number | null)[] = [];
  const start = () => trackMotionPointer({ pointerId: 1 }, target as unknown as Element,
    (event) => moves.push(event.clientX), (event) => ends.push(event?.clientX ?? null));
  const restore = () => {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  };
  return { events, target, moves, ends, start, restore };
}

test("motion drag ignores other pointers and finishes the initiating pointer once", () => {
  const f = fixture();
  try {
    f.start();
    for (const type of ["pointermove", "pointerup", "pointercancel"]) f.events.dispatchEvent(pointer(type, 2));
    f.target.dispatchEvent(pointer("lostpointercapture", 2));
    assert.deepEqual(f.moves, []);
    assert.deepEqual(f.ends, []);
    f.events.dispatchEvent(pointer("pointermove", 1, 25));
    f.events.dispatchEvent(pointer("pointerup", 1, 30, 0));
    f.events.dispatchEvent(pointer("pointermove", 1, 40));
    assert.deepEqual(f.moves, [25]);
    assert.deepEqual(f.ends, [30]);
    assert.equal(f.target.captured, null);
  } finally { f.restore(); }
});

for (const interruption of ["pointercancel", "lostpointercapture", "blur", "released outside"]) {
  test(`motion ${interruption} ends once, ignores later moves, and allows another drag`, () => {
    const f = fixture();
    try {
      f.start();
      f.events.dispatchEvent(pointer("pointermove", 1, 20));
      if (interruption === "lostpointercapture") f.target.releasePointerCapture(1);
      else if (interruption === "blur") f.events.dispatchEvent(new Event("blur"));
      else if (interruption === "released outside") f.events.dispatchEvent(pointer("pointermove", 1, 80, 0));
      else f.events.dispatchEvent(pointer("pointercancel", 1, 0, 0));
      f.events.dispatchEvent(pointer("pointermove", 1, 50));
      f.events.dispatchEvent(pointer("pointerup", 1, 50, 0));
      assert.deepEqual(f.moves, [20]);
      assert.deepEqual(f.ends, [null]);
      assert.equal(f.target.captured, null);
      f.start();
      f.events.dispatchEvent(pointer("pointermove", 1, 60));
      f.events.dispatchEvent(pointer("pointerup", 1, 70, 0));
      assert.deepEqual(f.moves, [20, 60]);
      assert.deepEqual(f.ends, [null, 70]);
    } finally { f.restore(); }
  });
}

test("disposing a motion editor removes listeners without finalizing discarded edits", () => {
  const f = fixture();
  try {
    const cleanup = f.start();
    f.events.dispatchEvent(pointer("pointermove", 1, 20));
    cleanup();
    cleanup();
    for (const type of ["pointermove", "pointercancel", "pointerup"]) f.events.dispatchEvent(pointer(type));
    f.events.dispatchEvent(new Event("blur"));
    assert.deepEqual(f.moves, [20]);
    assert.deepEqual(f.ends, []);
    assert.equal(f.target.captured, null);
  } finally { f.restore(); }
});
});
