import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { SCRIPT_RUNTIME, scriptsFile } from "../lib/script-runtime";
import { makeBox } from "../lib/presets";
import type { Script, ScriptStep, SiteDoc } from "../lib/types";

function script(trigger: Script["trigger"], steps: ScriptStep[]): Script {
  return { id: trigger, trigger, pos: { x: 0, y: 0 }, steps };
}

const assignments: ScriptStep[] = [
  { id: "a", kind: "set-value", target: "field", value: "a" },
  { id: "b", kind: "set-value", target: "field", value: "b" },
];

function mount(scripts: Script[], mode: "published" | "preview" | "preview form") {
  const doc: SiteDoc = {
    siteName: "Script input", assets: {}, pageOrder: ["p"],
    pages: { p: { id: "p", name: "P", slug: "", title: "", description: "", children: ["node"] } },
    nodes: { node: { ...makeBox(), id: "node", scripts } },
  };
  const listeners = new Map<string, Array<(event: any) => void>>();
  const timers = new Map<number, () => void>();
  let timerId = 0;
  let dispatches = 0;
  let previewWrites = 0;
  const input = {
    nodeType: 1, tagName: "INPUT", type: "text", name: "", disabled: false,
    value: "initial", checked: false, parentElement: null,
    matches: (selector: string) => selector === "input,select,textarea",
    closest: (selector: string): unknown => selector === "[data-scripts]" ? input : null,
    getAttribute: () => JSON.stringify(scripts),
    dispatchEvent: (event: { type: string }) => {
      if (++dispatches > 20) throw new Error("recursive change event loop");
      emit(event.type, false);
    },
  };
  const marker = {
    getAttribute: (name: string) => name === "data-page-body" ? "p" : null,
  };
  const queries: string[] = [];
  const document = {
    querySelector: (selector: string) => selector === "[data-page-body]" ? marker : null,
    querySelectorAll: (selector: string) => {
      queries.push(selector);
      return selector === "[data-scripts]" || selector === "#field" ? [input] : [];
    },
    contains: () => true,
    addEventListener: (name: string, fn: (event: any) => void) =>
      listeners.set(name, [...(listeners.get(name) ?? []), fn]),
    removeEventListener: () => {},
  };
  function emit(type: string, isTrusted: boolean) {
    for (const listener of listeners.get(type) ?? []) listener({ target: input, isTrusted });
  }
  const env = mode === "preview form" ? { setValue: () => { previewWrites++; return true; } } : {};
  runInNewContext(mode === "published" ? scriptsFile(doc) : `(${SCRIPT_RUNTIME})(env).install(document);`, {
    document, window: {}, env, CSS: { escape: (name: string) => name },
    Event: class { constructor(public type: string) {} },
    MutationObserver: class { observe() {} disconnect() {} },
    requestAnimationFrame: () => {},
    setTimeout: (fn: () => void) => { timers.set(++timerId, fn); return timerId; },
    clearTimeout: (id: number) => timers.delete(id),
  });
  return {
    input, queries,
    get writes() { return mode === "preview form" ? previewWrites : dispatches / 2; },
    get pending() { return timers.size; },
    change: () => emit("input", true),
    click: () => emit("click", true),
    async tick() {
      const current = Array.from(timers.entries());
      for (const [id, fn] of current) { timers.delete(id); fn(); }
      await new Promise<void>((resolve) => setImmediate(resolve));
    },
  };
}

for (const mode of ["preview", "preview form", "published"] as const) {
  test(`${mode} change handler does not recursively trigger itself through set-value`, async () => {
    const h = mount([script("change", assignments)], mode);
    h.change();
    await h.tick();
    assert.equal(h.input.value, "b");
    assert.equal(h.writes, 2, "only the two intentional changes may send notifications");
    assert.equal(h.pending, 0);
  });

  test(`${mode} changes after waits keep their causal chain while independent inputs still run`, async () => {
    const h = mount([script("change", [{ id: "wait", kind: "wait", seconds: 0 }, ...assignments])], mode);
    h.change();
    h.change();
    assert.equal(h.pending, 2, "both independent inputs can start while waiting");
    await h.tick();
    await h.tick();
    assert.equal(h.writes, 4);
    assert.equal(h.pending, 0, "the delayed actions must not start the same change handler again");
  });

  test(`${mode} form changes triggered by the initial load reach their change handler`, async () => {
    const h = mount([
      script("load", [assignments[0]]), script("change", [assignments[1]]),
    ], mode);
    await h.tick();
    await h.tick();
    assert.equal(h.input.value, "b");
    assert.equal(h.writes, 2);
    assert.equal(h.pending, 0);
  });
}

test("published variable-only scripts do not query the document for absent live bindings", () => {
  const h = mount([script("click", [{ id: "write", kind: "set-var", into: "count", value: "1" }])], "published");
  h.click();
  assert.equal(h.queries.some((query) => query.startsWith("[data-live")), false);
});
