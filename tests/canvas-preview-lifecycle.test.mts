import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import { transformSync } from "esbuild";
import * as React from "react";
import { useEditor } from "../lib/store";
import { SCRIPT_RUNTIME } from "../lib/script-runtime";
import { ListDomNode } from "./helpers/list-runtime-dom";
import type { SiteDoc } from "../lib/types";

function fixtureDoc(): SiteDoc {
  return {
    schemaVersion: 1, siteName: "Preview visits", assets: {}, nodes: {},
    pageOrder: ["a", "b", "html", "redirect", "rewrite"],
    pages: Object.fromEntries(["a", "b", "html", "redirect", "rewrite"].map(id => [id, {
      id, name: id, slug: id, title: "", description: "", children: [],
      ...(id === "html" ? { rawHtml: "<p>HTML</p>" } : {}),
      ...(id === "redirect" ? { redirectTo: "/a" } : {}),
      ...(id === "rewrite" ? { rewriteTo: "https://example.test/" } : {}),
      pageScripts: [{ id: `${id}-load`, trigger: "load", pos: { x: 0, y: 0 }, steps: [
        { id: `${id}-now`, kind: "open-url", url: `/${id}-load` },
        { id: `${id}-wait`, kind: "wait", seconds: 1 },
        { id: `${id}-late`, kind: "open-url", url: `/${id}-late` },
      ] }],
    }])),
  };
}

// Canvas の実際の描画・effect と、実際のスクリプトのランタイムを実行する。ここで制御するのは、
// React のスケジュール、データの取得、ホストの DOM だけ。React の差分の反映と
// ネイティブのイベントの配信は、ブラウザのテストで確かめる。
function mount(initialPage = "a", doc = fixtureDoc()) {
  useEditor.getState().replaceDoc(doc);
  useEditor.getState().setActivePage(initialPage);
  useEditor.getState().setMode("preview");
  useEditor.getState().setBreakpoint("base");
  let cursor = 0;
  const slots: any[] = [], effects: (() => void)[] = [];
  const hooks = {
    ...React,
    useState(initial: any) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = initial;
      return [slots[i], (next: any) => { slots[i] = typeof next === "function" ? next(slots[i]) : next; }];
    },
    useRef(initial: any) { return slots[cursor++] ??= { current: initial }; },
    useMemo(fn: () => any, deps: unknown[]) {
      const i = cursor++, previous = slots[i];
      if (!previous || deps.some((dep, j) => !Object.is(dep, previous.deps[j]))) slots[i] = { deps, value: fn() };
      return slots[i].value;
    },
    useCallback(fn: any, deps: unknown[]) { return hooks.useMemo(() => fn, deps); },
    useEffect(fn: () => void | (() => void), deps: unknown[]) {
      const i = cursor++, previous = slots[i];
      if (!previous || deps.some((dep, j) => !Object.is(dep, previous.deps[j]))) effects.push(() => {
        previous?.cleanup?.();
        slots[i] = { deps, cleanup: fn() };
      });
    },
  };
  const calls: string[] = [];
  const timers = new Map<number, () => void>();
  let timerId = 0;
  const observers = new Set<() => void>();
  let installs = 0, disposals = 0;
  const runtime = runInNewContext(`(${SCRIPT_RUNTIME})`, {
    MutationObserver: class {
      constructor(private callback: () => void) {}
      observe() { observers.add(this.callback); }
      disconnect() { observers.delete(this.callback); }
    },
    requestAnimationFrame: (fn: () => void) => fn(),
    setTimeout: (fn: () => void) => { timers.set(++timerId, fn); return timerId; },
    clearTimeout: (id: number) => timers.delete(id),
    CSS: { escape: (value: string) => value },
  });
  const noop = () => {};
  const data = {
    fieldValues: {}, pageVars: {}, fieldVarNodes: [],
    setFieldValues: noop, setClientValues: noop, setLiveSamples: noop,
    setLiveTotals: noop, setFullData: noop, refreshData: noop,
    navigateTo: (url: string) => calls.push(url), setActivePage: useEditor.getState().setActivePage,
    plan: { clientVars: new Set(), listOps: {}, serverIds: new Set() },
  };
  const require = createRequire(resolve("components/Canvas.tsx"));
  const mod = { exports: {} as any };
  const code = transformSync(readFileSync("components/Canvas.tsx", "utf8"), { loader: "tsx", jsx: "automatic", format: "cjs" }).code;
  new Function("require", "module", "exports", code)((id: string) => {
    if (id === "react") return hooks;
    if (id === "../lib/store") return { useEditor: Object.assign((select: any) => select(useEditor.getState()), useEditor) };
    if (id === "./canvas/useCanvasData") return { useCanvasData: () => data };
    if (id === "./canvas/useHtmlPreview") return { useHtmlPreview: () => ({ html: "" }) };
    if (id === "./canvas/useCanvasDrag") return { useCanvasDrag: () => ({ dropHandlers: {} }) };
    if (id === "../lib/script-runtime") return { createScriptRuntime: (env: unknown) => ({
      install(root: ListDomNode) {
        installs++;
        const dispose = runtime(env).install(root);
        return () => { disposals++; dispose(); };
      },
    }) };
    return require(id);
  }, mod, mod.exports);
  let root: ListDomNode | null = null, frameRef: { current: unknown } | null = null;
  const walk = (element: any, visit: (element: any) => void) => {
    if (!element || typeof element !== "object") return;
    if (Array.isArray(element)) { element.forEach(child => walk(child, visit)); return; }
    visit(element); walk(element.props?.children, visit);
  };
  const render = () => {
    cursor = 0;
    const tree = mod.exports.default();
    let frame: any;
    walk(tree, el => { if (el.props?.ref && el.props?.className?.startsWith("canvas-frame")) frame = el; });
    if (frameRef) frameRef.current = null;
    if (frame) {
      root ??= new ListDomNode(1, "DIV");
      let marker = root.children[0];
      walk(frame, el => {
        if (!el.props?.["data-scripts"]) return;
        if (!marker) { marker = new ListDomNode(1, "SPAN"); root!.appendChild(marker); }
        marker.setAttribute("data-scripts", el.props["data-scripts"]);
        if (el.props["data-page-body"]) marker.setAttribute("data-page-body", el.props["data-page-body"]);
      });
      frameRef = frame.props.ref; frameRef!.current = root;
    } else root = null;
    effects.splice(0).forEach(effect => effect());
    observers.forEach(callback => callback());
  };
  render();
  return {
    calls, render, counts: () => ({ installs, disposals }),
    page(id: string) { useEditor.getState().setActivePage(id); render(); },
    async finishWaits() {
      const pending = [...timers.values()]; timers.clear(); pending.forEach(fn => fn());
      await new Promise<void>(done => setImmediate(done));
    },
    close() { slots.forEach(slot => slot?.cleanup?.()); },
  };
}

test("each visual page visit runs its load scripts, including a return visit", () => {
  const m = mount();
  try {
    const before = useEditor.getState();
    assert.deepEqual(m.calls, ["/a-load"]);
    m.page("b"); m.page("a");
    assert.deepEqual(m.calls, ["/a-load", "/b-load", "/a-load"]);
    assert.equal(useEditor.getState().doc, before.doc);
    assert.equal(useEditor.getState().past, before.past);
    assert.equal(useEditor.getState().future, before.future);
  } finally { m.close(); }
});

test("a delayed script cannot navigate after its preview page was left", async () => {
  const m = mount();
  try {
    m.page("b"); await m.finishWaits();
    assert.ok(!m.calls.includes("/a-late"), "old page's wait must be cancelled");
    assert.ok(m.calls.includes("/b-late"));
  } finally { m.close(); }
});

for (const special of ["html", "redirect", "rewrite"]) {
  test(`${special}: remove the old runtime and install on the replacement frame`, () => {
    const m = mount();
    try {
      m.page(special);
      assert.deepEqual(m.counts(), { installs: 1, disposals: 1 });
      m.page("a");
      assert.deepEqual(m.calls, ["/a-load", "/a-load"]);
      assert.deepEqual(m.counts(), { installs: 2, disposals: 1 });
    } finally { m.close(); }
  });
  test(`${special}: entering preview there does not disable a later visual page`, () => {
    const m = mount(special);
    try { m.page("a"); assert.deepEqual(m.calls, ["/a-load"]); }
    finally { m.close(); }
  });
}

test("same-page document, viewport and selection changes do not replay load scripts", () => {
  const m = mount();
  try {
    useEditor.getState().updatePage("a", { title: "Edited title" }); m.render();
    useEditor.getState().setBreakpoint("sm"); m.render();
    useEditor.getState().select(null); m.render();
    assert.deepEqual(m.calls, ["/a-load"]);
    assert.deepEqual(m.counts(), { installs: 1, disposals: 0 });
  } finally { m.close(); }
});

test("same-page conversion to HTML and undo replace the runtime owner", () => {
  const m = mount();
  try {
    useEditor.getState().updatePage("a", { rawHtml: "<p>HTML</p>" }); m.render();
    assert.deepEqual(m.counts(), { installs: 1, disposals: 1 });
    useEditor.getState().undo(); m.render();
    assert.deepEqual(m.calls, ["/a-load", "/a-load"]);
  } finally { m.close(); }
});

test("Canvas preview dispatches a variable change to the active page script", () => {
  const doc = fixtureDoc();
  doc.pages.a.pageScripts = [
    { id: "init", trigger: "load", pos: { x: 0, y: 0 },
      steps: [{ id: "set", kind: "set-var", into: "count", value: "1" }] },
    { id: "watch", trigger: "change", changeVariable: "count", pos: { x: 0, y: 0 },
      steps: [{ id: "open", kind: "open-url", url: "/changed" }] },
  ];
  const m = mount("a", doc);
  try { assert.deepEqual(m.calls, ["/changed"]); }
  finally { m.close(); }
});
