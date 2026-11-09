import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { SCRIPT_RUNTIME } from "../lib/script-runtime";
import type { ScriptStep } from "../lib/types";

const changeSteps: ScriptStep[] = [{ id: "hide", kind: "hide", target: "banner" }];
const clickSteps: ScriptStep[] = [{ id: "set", kind: "set-value", target: "field", value: "changed" }];

function harness() {
  let pageId = "a";
  let display = "";
  let clock = 0;
  const pending = new Map<number, () => void>();
  const listeners = new Map<string, (event: { target: unknown }) => void>();
  const source = {
    nodeType: 1, parentElement: null,
    getAttribute: () => JSON.stringify([{ trigger: "click", steps: clickSteps }]),
    closest: (selector: string): unknown => selector === "[data-scripts]" ? source : null,
    matches: () => false,
  };
  const field = {
    nodeType: 1, parentElement: null,
    type: "text", tagName: "INPUT", value: "initial", name: "", checked: false,
    getAttribute: () => JSON.stringify([{ trigger: "change", steps: changeSteps }]),
    closest: (selector: string): unknown => selector === "[data-scripts]" ? field : null,
    matches: (selector: string) => selector === "input,select,textarea",
  };
  const banner = {
    style: {
      get display() { return display; },
      set display(v: string) { display = v; },
    },
    matches: () => false,
  };
  const marker = { getAttribute: () => pageId };
  const root = {
    querySelector: (selector: string) => selector === "[data-page-body]" ? marker : null,
    querySelectorAll: (selector: string) =>
      selector === "[data-scripts]" ? [source, field] :
        selector === "#field" ? [field] :
          selector === "#banner" ? [banner] : [],
    contains: () => true,
    addEventListener: (name: string, fn: (event: { target: unknown }) => void, capture = false) =>
      listeners.set(name + ":" + capture, fn),
    removeEventListener: () => {},
  };
  const globals = {
    document: root, window: {}, CSS: { escape: (name: string) => name },
    MutationObserver: class { observe() {} disconnect() {} },
    requestAnimationFrame: () => {},
    setTimeout: (fn: () => void) => { pending.set(++clock, fn); return clock; },
    clearTimeout: (id: number) => pending.delete(id),
  };
  const dispose = runInNewContext(
    "(" + SCRIPT_RUNTIME + ")({ setValue: function () { return true; } }).install(document);",
    globals
  ) as () => void;
  return {
    click() { listeners.get("click:false")!({ target: source }); },
    navigate(id: string) { pageId = id; },
    tick() {
      const task = pending.entries().next().value;
      if (task) { pending.delete(task[0]); task[1](); }
    },
    pending: () => pending.size,
    get display() { return display; },
    dispose,
  };
}

test("preview ignores delayed change notifications from the previous page", () => {
  const h = harness();
  h.click();
  assert.equal(h.pending(), 1);
  h.navigate("b");
  h.tick();
  assert.equal(h.display, "", "old input scripts must not hide the next page's target");
  h.dispose();
});

test("preview still dispatches delayed changes on the original page", () => {
  const h = harness();
  h.click();
  assert.equal(h.pending(), 1);
  h.tick();
  assert.equal(h.display, "none", "change handlers remain usable on the same page");
  h.dispose();
});
