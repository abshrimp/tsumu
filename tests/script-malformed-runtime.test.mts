import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { SCRIPT_RUNTIME } from "../lib/script-runtime";

function mount(raw: string) {
  const target = { style: { display: "" }, matches: () => false };
  const element = {
    nodeType: 1, parentElement: null,
    getAttribute: () => raw,
    closest: (selector: string): unknown => selector === "[data-scripts]" ? element : null,
  };
  const listeners = new Map<string, (event: any) => void>();
  const marker = { getAttribute: () => "p" };
  const document = {
    querySelector: (selector: string) => selector === "[data-page-body]" ? marker : null,
    querySelectorAll: (selector: string) => selector === "[data-scripts]"
      ? [element] : selector === "#banner" ? [target] : [],
    contains: () => true,
    addEventListener: (name: string, fn: (event: any) => void) => listeners.set(name, fn),
    removeEventListener: () => {},
  };
  const globals = {
    document, CSS: { escape: (name: string) => name },
    MutationObserver: class { observe() {} disconnect() {} },
    requestAnimationFrame: () => {},
    setTimeout, clearTimeout,
  };
  runInNewContext(`(${SCRIPT_RUNTIME})({}).install(document);`, globals);
  return {
    click: () => listeners.get("click")!({ target: element }),
    target,
  };
}

test("unexpected JSON data-scripts shapes do not crash the runtime scanner", () => {
  for (const raw of ["null", "{}", "42", '"text"', '{"trigger":"click","steps":[]}',
      '[null,3,{"trigger":"click","steps":null}]']) {
    assert.doesNotThrow(() => mount(raw), raw);
  }
});

test("corrupt steps and conditions are skipped without losing later valid actions", () => {
  const steps = [
    null, false, 123,
    { kind: "if", cond: null, then: [{ kind: "hide", target: "banner" }] },
    { kind: "transform", source: "x", into: "x" },
    { kind: "list-display", mode: "filter", array: "rows", conds: [null] },
    { kind: "hide", target: "banner" },
  ];
  const h = mount(JSON.stringify([{ trigger: "click", steps }]));
  assert.doesNotThrow(() => h.click());
  assert.equal(h.target.style.display, "none");
});
