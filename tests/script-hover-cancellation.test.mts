import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { SCRIPT_RUNTIME, scriptsFile } from "../lib/script-runtime";
import { makeBox } from "../lib/presets";
import type { ScriptStep, SiteDoc } from "../lib/types";

const hide: ScriptStep = { id: "hide", kind: "hide", target: "banner" };
function mount(generated: boolean) {
  const steps = [hide];
  const scripts = [{ trigger: "hover-end", keep: true, steps }];
  const doc: SiteDoc = {
    siteName: "Hover cancellation", assets: {}, pageOrder: ["a", "b"],
    pages: {
      a: { id: "a", name: "A", slug: "", title: "", description: "", children: ["node"] },
      b: { id: "b", name: "B", slug: "b", title: "", description: "", children: [] },
    },
    nodes: { node: { ...makeBox(), id: "node", scripts: [{
      id: "hover", trigger: "hover-end", keepOnShown: true, pos: { x: 0, y: 0 }, steps,
    }] } },
  };
  let pageId = "a";
  let display = "";
  const target = { style: { get display() { return display; }, set display(s: string) { display = s; } }, matches: () => false };
  const element = {
    nodeType: 1, parentElement: null,
    getAttribute: () => JSON.stringify(scripts),
    closest: (selector: string): unknown => selector === "[data-scripts]" ? element : null,
    matches: () => false,
  };
  const events = new Map<string, (event: unknown) => void>();
  let observer: () => void = () => {};
  const frames: Array<() => void> = [];
  const timers = new Map<number, () => void>();
  let seq = 0;
  const marker = { getAttribute: () => pageId };
  const document = {
    querySelector: (selector: string) => selector === "[data-page-body]" ? marker : null,
    querySelectorAll: (selector: string) => selector === "[data-scripts]"
      ? pageId === "a" ? [element] : [] : selector === "#banner" ? [target] : [],
    contains: (value: unknown) => value !== element || pageId === "a",
    addEventListener: (name: string, listener: (event: unknown) => void) => events.set(name, listener),
    removeEventListener: () => {},
  };
  const globals = {
    document, CSS: { escape: (name: string) => name },
    MutationObserver: class { constructor(fn: () => void) { observer = fn; } observe() {} disconnect() {} },
    requestAnimationFrame: (fn: () => void) => frames.push(fn),
    setTimeout: (fn: () => void) => { timers.set(++seq, fn); return seq; },
    clearTimeout: (id: number) => timers.delete(id),
  };
  runInNewContext(generated ? scriptsFile(doc) : `(${SCRIPT_RUNTIME})({}).install(document);`, globals);
  return {
    beginHoverExit() {
      events.get("mouseover")!({ target: element, relatedTarget: null });
      events.get("mouseout")!({ target: element, relatedTarget: null });
    },
    navigate() { pageId = "b"; observer(); while (frames.length) frames.shift()!(); },
    changePageWithoutScan() { pageId = "b"; },
    get pending() { return timers.size; },
    tick() { const timer = timers.entries().next().value; if (timer) { timers.delete(timer[0]); timer[1](); } },
    get display() { return display; },
  };
}

for (const generated of [false, true]) {
  test(`${generated ? "published" : "preview"} hover-end cannot run after its element was removed by navigation`, () => {
    const h = mount(generated);
    h.beginHoverExit();
    assert.equal(h.pending, 1);
    h.changePageWithoutScan();
    h.tick();
    assert.equal(h.display, "", "the old page's hover-end must not mutate the new page");
  });
}

test("hover exit timeouts are cleared immediately after a preview page transition", () => {
  const h = mount(false);
  h.beginHoverExit();
  assert.equal(h.pending, 1);
  h.navigate();
  assert.equal(h.pending, 0);
  assert.equal(h.display, "");
});
