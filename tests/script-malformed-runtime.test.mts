import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { SCRIPT_RUNTIME } from "../lib/script-runtime";

function mount(raw: string) {
  let currentRaw = raw;
  const maps: Map<unknown, unknown>[] = [];
  class TrackedMap<K, V> extends Map<K, V> {
    constructor(...args: ConstructorParameters<typeof Map<K, V>>) {
      super(...args);
      maps.push(this);
    }
  }
  const target = { style: { display: "" }, matches: () => false };
  const element = {
    nodeType: 1, parentElement: null,
    getAttribute: () => currentRaw,
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
    document, Map: TrackedMap, CSS: { escape: (name: string) => name },
    MutationObserver: class { observe() {} disconnect() {} },
    requestAnimationFrame: () => {},
    setTimeout, clearTimeout,
  };
  runInNewContext(`(${SCRIPT_RUNTIME})({}).install(document);`, globals);
  return {
    click: () => listeners.get("click")!({ target: element }),
    setScript: (next: string) => { currentRaw = next; },
    get parsedCache() { return maps[0] as Map<string, unknown>; },
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
    { kind: "set-var", into: 99, value: "malformed" },
    { kind: "list-display", mode: "filter", array: "rows", conds: [null] },
    { kind: "hide", target: "banner" },
  ];
  const h = mount(JSON.stringify([{ trigger: "click", steps }]));
  assert.doesNotThrow(() => h.click());
  assert.equal(h.target.style.display, "none");
});

test("malformed variable references and non-coercible values cannot abort later steps", () => {
  const brokenText = { toString: null };
  const steps = [
    { kind: "set-var", into: "fromRef", rawRef: { name: 42 } },
    { kind: "set-var", into: "missingRef", rawRef: { fallback: "x" } },
    { kind: "set-var", into: "fromParts", value: { scriptParts: [null, { name: false }] } },
    { kind: "set-var", into: "broken", value: brokenText },
    { kind: "set-value", target: "absent", value: brokenText },
    { kind: "open-url", url: brokenText },
    { kind: "wait", seconds: brokenText },
    { kind: "repeat", times: brokenText, then: [{ kind: "hide", target: "banner" }] },
    { kind: "if", cond: { subject: "var", left: brokenText, op: "eq", value: "x" }, then: [{ kind: "hide", target: "banner" }] },
    { kind: "if", cond: { subject: "visible", target: brokenText }, then: [{ kind: "hide", target: "banner" }] },
    { kind: "hide", target: "banner" },
  ];
  const h = mount(JSON.stringify([{ trigger: "click", steps }]));
  assert.doesNotThrow(() => h.click());
  assert.equal(h.target.style.display, "none");
});

test("parsed script cache remains bounded while live script attributes change", () => {
  const h = mount(JSON.stringify([{ trigger: "click", steps: [] }]));
  for (let i = 0; i < 400; i++) {
    h.setScript(JSON.stringify([{ id: `edition-${i}`, trigger: "click",
      steps: [{ kind: "hide", target: "banner" }] }]));
    h.click();
  }
  assert.ok(h.parsedCache.size <= 256, "old script revisions must be evicted");
  h.target.style.display = "";
  h.click();
  assert.equal(h.target.style.display, "none", "the most recent script is still runnable");
  const latest = [...h.parsedCache.keys()].at(-1)!;
  assert.match(latest, /edition-399/, "the active script should be retained");
});
