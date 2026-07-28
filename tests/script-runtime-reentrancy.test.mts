import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { SCRIPT_RUNTIME, scriptsFile } from "../lib/script-runtime";
import { makeBox } from "../lib/presets";
import type { ScriptStep, SiteDoc } from "../lib/types";

for (const generated of [false, true]) {
  const variant = generated ? "published" : "preview";
  test(`${variant} change handler does not recursively trigger itself through set-value`, () => {
    const steps: ScriptStep[] = [
      { id: "a", kind: "set-value", target: "field", value: "a" },
      { id: "b", kind: "set-value", target: "field", value: "b" },
    ];
    const doc: SiteDoc = {
      siteName: "Script input", assets: {}, pageOrder: ["p"],
      pages: { p: { id: "p", name: "P", slug: "", title: "", description: "", children: ["node"] } },
      nodes: { node: { ...makeBox(), id: "node", scripts: [{
        id: "script", trigger: "change", pos: { x: 0, y: 0 }, steps,
      }] } },
    };
    const listeners = new Map<string, Array<(event: any) => void>>();
    const subscribe = (name: string, fn: (event: any) => void) =>
      listeners.set(name, [...(listeners.get(name) ?? []), fn]);
    let dispatches = 0;
    const input = {
      nodeType: 1, tagName: "INPUT", type: "text", name: "", disabled: false,
      value: "initial", checked: false,
      matches: (selector: string) => selector === "input,select,textarea",
      closest: (selector: string): unknown => selector === "[data-scripts]" ? input : null,
      parentElement: null,
      getAttribute: () => JSON.stringify([{ trigger: "change", steps }]),
      dispatchEvent: (event: { type: string }) => {
        if (++dispatches > 20) throw new Error("recursive change event loop");
        for (const listener of listeners.get(event.type) ?? []) listener({ target: input, isTrusted: false });
      },
    };
    const page = { getAttribute: () => "p" };
    const document = {
      querySelector: (selector: string) => selector === "[data-page-body]" ? page : null,
      querySelectorAll: (selector: string) =>
        selector === "[data-scripts]" || selector === "#field" ? [input] : [],
      contains: () => true,
      addEventListener: subscribe,
      removeEventListener: () => {},
    };
    const globals = {
      document, window: {}, CSS: { escape: (name: string) => name },
      Event: class { constructor(public type: string) {} },
      MutationObserver: class { observe() {} disconnect() {} },
      requestAnimationFrame: () => {},
      setTimeout, clearTimeout,
    };
    runInNewContext(generated ? scriptsFile(doc) : `(${SCRIPT_RUNTIME})({}).install(document);`, globals);
    for (const listener of listeners.get("input") ?? []) listener({ target: input, isTrusted: true });
    assert.equal(input.value, "b");
    assert.equal(dispatches, 4, "only the two intentional changes may send input/change notifications");
  });
}
