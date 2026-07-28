import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { SCRIPT_RUNTIME, scriptsFile } from "../lib/script-runtime";
import { makeBox } from "../lib/presets";
import type { ScriptStep, SiteDoc } from "../lib/types";

const hide: ScriptStep = { id: "hide", kind: "hide", target: "banner" };

function mount(steps: ScriptStep[], generated: boolean) {
  const doc: SiteDoc = {
    siteName: "Runtime budget", assets: {}, pageOrder: ["p"],
    pages: { p: { id: "p", name: "Page", slug: "", title: "", description: "", children: ["node"] } },
    nodes: { node: { ...makeBox(), id: "node", scripts: [
      { id: "script", trigger: "click", pos: { x: 0, y: 0 }, steps },
    ] } },
  };
  let writes = 0;
  let display = "";
  const target = {
    matches: () => false,
    style: {
      get display() { return display; },
      set display(value: string) { writes++; display = value; },
    },
  };
  const events = new Map<string, (event: unknown) => void>();
  const element = {
    nodeType: 1, parentElement: null,
    getAttribute: () => JSON.stringify([{ trigger: "click", steps }]),
    closest: (selector: string) => selector === "[data-scripts]" ? element : null,
  };
  const page = { getAttribute: () => "p" };
  const document = {
    querySelector: (selector: string) => selector === "[data-page-body]" ? page : null,
    querySelectorAll: (selector: string) =>
      selector === "[data-scripts]" ? [element] : selector === "#banner" ? [target] : [],
    contains: () => true,
    addEventListener: (name: string, listener: (event: unknown) => void) => events.set(name, listener),
    removeEventListener: () => {},
  };
  const globals = {
    document, CSS: { escape: (name: string) => name },
    MutationObserver: class { observe() {} disconnect() {} },
    requestAnimationFrame: () => {},
    setTimeout, clearTimeout,
  };
  runInNewContext(generated ? scriptsFile(doc) : `(${SCRIPT_RUNTIME})({}).install(document);`, globals);
  return {
    click() { events.get("click")!({ target: element }); },
    get writes() { return writes; },
    get display() { return display; },
  };
}

for (const generated of [false, true]) {
  const variant = generated ? "published" : "preview";
  test(`${variant} runtime bounds deeply nested conditional scripts`, async () => {
    let steps: ScriptStep[] = [hide];
    for (let i = 0; i < 256; i++) {
      steps = [{
        id: `if-${i}`, kind: "if",
        cond: { subject: "var", target: "", left: "true", op: "eq", value: "true" },
        then: steps,
      }];
    }
    const h = mount(steps, generated);
    h.click();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(h.writes, 0, "nested scripts must stop beyond the runtime depth budget");
  });

  test(`${variant} runtime bounds high-volume finite loop work per event`, async () => {
    const steps: ScriptStep[] = [{
      id: "outer", kind: "repeat", times: 30,
      then: [{ id: "inner", kind: "repeat", times: 1000, then: [hide] }],
    }];
    const h = mount(steps, generated);
    h.click();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.ok(h.writes > 0, "the script should still execute valid steps");
    assert.ok(h.writes <= 20_000, `event exceeded execution budget: ${h.writes} writes`);
  });
}
