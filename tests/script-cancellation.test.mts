import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { SCRIPT_RUNTIME, scriptsFile } from "../lib/script-runtime";
import { makeBox } from "../lib/presets";
import type { ScriptStep, ScriptTrigger, SiteDoc } from "../lib/types";

const wait: ScriptStep = { id: "wait", kind: "wait", seconds: 10 };
const hide: ScriptStep = { id: "hide", kind: "hide", target: "banner" };

function harness(steps: ScriptStep[], opts: { trigger?: ScriptTrigger; preview?: boolean } = {}) {
  const trigger = opts.trigger ?? "load";
  const doc: SiteDoc = {
    siteName: "Script navigation", pageOrder: ["a", "b"], assets: {},
    pages: Object.fromEntries(["a", "b"].map((id) => [id, {
      id, name: id, slug: id === "a" ? "" : "second", title: id, description: "", children: id === "a" ? ["start"] : [],
    }])),
    nodes: { start: { ...makeBox(), id: "start", scripts: [{ id: "script", trigger, pos: { x: 0, y: 0 }, steps }] } },
  };
  let pageId = "a";
  const pageMarker = () => ({ getAttribute: (name: string) => name === "data-page-body" ? pageId : null });
  let marker = opts.preview ? null : pageMarker();
  const timers = new Map<number, () => void>();
  let seq = 0;
  let triggerRemoved = false;
  const frames: Array<() => void> = [];
  let mutation: () => void = () => {};
  const events = new Map<string, Function>();
  const target = { style: { display: "" }, matches: () => false };
  const starter = {
    nodeType: 1, parentElement: null,
    getAttribute: () => JSON.stringify([{ trigger, steps }]),
    closest: (selector: string): unknown => selector === "[data-scripts]" ? starter : null,
  };
  const root = {
    querySelector: () => marker,
    querySelectorAll: (selector: string) => selector === "[data-scripts]" ? (pageId === "a" && !triggerRemoved ? [starter] : []) : selector === "#banner" ? [target] : [],
    contains: () => true,
    addEventListener: (name: string, fn: Function, capture = false) => events.set(`${name}:${capture}`, fn),
    removeEventListener: () => {},
  };
  const dispose = runInNewContext(opts.preview ? `(${SCRIPT_RUNTIME})({}).install(document)` : scriptsFile(doc), {
    document: root, CSS: { escape: (s: string) => s },
    MutationObserver: class { constructor(fn: () => void) { mutation = fn; } observe() {} disconnect() {} },
    requestAnimationFrame: (fn: () => void) => frames.push(fn),
    setTimeout: (fn: () => void) => { timers.set(++seq, fn); return seq; },
    clearTimeout: (id: number) => timers.delete(id),
  }) as () => void;
  return {
    target,
    pending: () => timers.size,
    click: () => events.get("click:false")!({ target: starter }),
    scan() { mutation(); while (frames.length) frames.shift()!(); },
    navigate(id: string, replaceMarker = false) {
      pageId = id;
      if (replaceMarker) marker = pageMarker();
    },
    removeTrigger() { triggerRemoved = true; },
    async tick() {
      const next = timers.entries().next().value;
      if (next) { timers.delete(next[0]); next[1](); }
      await new Promise<void>((done) => setImmediate(done));
    },
    dispose,
  };
}

test("a page's delayed action cannot change the next page", async () => {
  const h = harness([wait, hide]);
  assert.equal(h.pending(), 1);
  h.navigate("b"); h.scan();
  await h.tick();
  assert.equal(h.target.style.display, "");
  assert.equal(h.pending(), 0);
});

test("a click-only delayed action stops before the navigation scan has run", async () => {
  const h = harness([wait, hide], { trigger: "click" });
  h.click();
  assert.equal(h.pending(), 1);
  h.navigate("b");
  await h.tick();
  assert.equal(h.target.style.display, "");
});

test("a pending action does not resume after leaving and returning to the same page", async () => {
  const h = harness([wait, hide], { trigger: "click" });
  h.click();
  h.navigate("b"); h.scan();
  h.navigate("a"); h.scan();
  await h.tick();
  assert.equal(h.target.style.display, "");
  // 戻った後でも、新しく始めた動作は動く。
  h.click(); await h.tick();
  assert.equal(h.target.style.display, "none");
});

test("a new-page action started before the navigation scan is not canceled", async () => {
  const h = harness([
    { id: "set", kind: "set-var", into: "status", value: "fresh" },
    wait,
    { id: "if", kind: "if", cond: { subject: "var", target: "", left: "{status}", op: "eq", value: "fresh" }, then: [hide] },
  ], { trigger: "click" });
  h.navigate("b");
  h.click();
  h.scan(); await h.tick();
  assert.equal(h.target.style.display, "none", "the scan must keep the new page's action and variables");
});

test("replacing a page with another instance of the same page cancels old work", async () => {
  const h = harness([wait, hide], { trigger: "click" });
  h.click();
  h.navigate("a", true);
  await h.tick();
  assert.equal(h.target.style.display, "");
});

test("a fresh instance of a page without seeds starts with fresh script variables", () => {
  const h = harness([
    { id: "check", kind: "if", cond: { subject: "var", target: "", left: "{count}", op: "eq", value: "1" }, then: [hide] },
    { id: "write", kind: "set-var", into: "count", value: "1" },
  ], { trigger: "click" });
  h.click();
  h.navigate("a", true);
  h.scan();
  h.click();
  assert.equal(h.target.style.display, "");
  h.click();
  assert.equal(h.target.style.display, "none");
});

test("a reused element runs its load script once per page visit", () => {
  const h = harness([wait]);
  assert.equal(h.pending(), 1);
  h.navigate("b"); h.scan();
  assert.equal(h.pending(), 0);
  h.navigate("a"); h.scan(); h.scan();
  assert.equal(h.pending(), 1);
});

test("unrelated mutations and removal of the trigger do not cancel same-page actions", async () => {
  const h = harness([wait, hide]);
  // ページの印はそのまま残る。関係の無い DOM の走査は、ページの移動ではない。
  h.removeTrigger(); h.scan(); await h.tick();
  assert.equal(h.target.style.display, "none");
});

test("waits nested in if and repeat blocks cannot continue on another page", async () => {
  const h = harness([
    { id: "if", kind: "if", cond: { subject: "var", target: "", left: "yes", op: "eq", value: "yes" }, then: [
      { id: "repeat", kind: "repeat", times: 0, then: [wait, hide] },
    ] },
    hide,
  ]);
  assert.equal(h.pending(), 1);
  h.navigate("b"); h.scan(); await h.tick();
  assert.equal(h.target.style.display, "");
  assert.equal(h.pending(), 0, "the infinite repeat must not schedule another timer");
});

test("for-each continuations and their following steps stop after navigation", async () => {
  const h = harness([
    { id: "items-input", kind: "set-var", value: "a,b", into: "items" },
    { id: "split", kind: "transform", source: "items", into: "items", transform: { kind: "split", separator: "," } },
    { id: "each", kind: "for-each", array: "items", then: [wait, hide] },
    hide,
  ], { trigger: "click" });
  h.click();
  assert.equal(h.pending(), 1);
  h.navigate("b"); h.scan(); await h.tick();
  assert.equal(h.target.style.display, "");
  assert.equal(h.pending(), 0);
});

test("preview without a page marker keeps working and disposal cancels pending work", async () => {
  const h = harness([wait, hide], { preview: true });
  await h.tick();
  assert.equal(h.target.style.display, "none");
  const disposed = harness([wait, hide], { preview: true });
  disposed.dispose(); await disposed.tick();
  assert.equal(disposed.target.style.display, "");
});

test("navigating away releases outstanding script timers without waiting for the delay", () => {
  const h = harness([wait, hide], { trigger: "click" });
  h.click();
  assert.equal(h.pending(), 1);
  h.navigate("b");
  h.scan();
  assert.equal(h.pending(), 0, "page transition should clear stale timers immediately");
});

test("disposing the script runtime releases outstanding script timers immediately", () => {
  const h = harness([wait, hide], { preview: true });
  assert.equal(h.pending(), 1);
  h.dispose();
  assert.equal(h.pending(), 0, "unmount should not keep a pending timeout alive");
});
