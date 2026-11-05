import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { SCRIPT_RUNTIME, scriptsFile } from "../lib/script-runtime";
import { makeBox } from "../lib/presets";
import type { SiteDoc } from "../lib/types";
import { publishedScriptFileValue, scriptFileValueBundle } from "./helpers/script-file-value";

/** DOMの正規化を模倣せず、runtimeからsetter・preview状態・通知への呼び出しだけを記録する。 */
function runAssignment(initial: string, value: string, preview: boolean, type = "file") {
  const script = { id: "load", trigger: "load" as const, pos: { x: 0, y: 0 }, steps: [{ id: "set", kind: "set-value" as const, target: "upload", value }] };
  const doc: SiteDoc = {
    siteName: "File assignment", assets: {}, pageOrder: ["home"],
    pages: { home: { id: "home", name: "Home", title: "Home", description: "", slug: "", children: ["start"] } },
    nodes: { start: { ...makeBox(), id: "start", scripts: [script] } },
  };
  const writes: string[] = [], events: string[] = [], patches: [string, string][] = [];
  const timers: Function[] = [];
  let current = initial;
  const input = {
    id: "upload", type, matches: () => true, closest: () => null,
    get value() { return current; },
    set value(v: string) { writes.push(v); current = v; },
    dispatchEvent: (event: Event) => events.push(event.type),
  };
  const start = { getAttribute: () => JSON.stringify([script]), closest: () => null };
  const root = {
    querySelector: () => null,
    querySelectorAll: (selector: string) => selector === "[data-scripts]" ? [start] : selector === "#upload" ? [input] : [],
    addEventListener() {}, removeEventListener() {}, contains: () => true,
  };
  runInNewContext(preview ? `(${SCRIPT_RUNTIME})(env).install(document)` : scriptsFile(doc), {
    document: root, CSS: { escape: (s: string) => s }, Event,
    env: { setValue: (id: string, v: string) => { patches.push([id, v]); return true; } },
    MutationObserver: class { observe() {} disconnect() {} },
    requestAnimationFrame() {}, setTimeout: (fn: Function) => { timers.push(fn); return timers.length; }, clearTimeout() {},
  });
  return { current, writes, events, patches, timers: timers.length };
}

for (const preview of [true, false]) {
  const context = preview ? "preview" : "exported";
  test(`${context} nonempty file assignments do not change values, notify, or write preview state`, () => {
    for (const initial of ["", "C:\\fakepath\\selected.txt"]) {
      for (const value of ["photo.png", " ", "false"]) {
        assert.deepEqual(runAssignment(initial, value, preview), { current: initial, writes: [], events: [], patches: [], timers: 0 });
      }
    }
  });

  test(`${context} file clearing still writes an empty value only when needed`, () => {
    assert.deepEqual(runAssignment("", "", preview), { current: "", writes: [], events: [], patches: [], timers: 0 });
    assert.deepEqual(runAssignment("C:\\fakepath\\selected.txt", "", preview), {
      current: "", writes: [""], events: preview ? [] : ["input", "change"],
      patches: preview ? [["upload", ""]] : [], timers: preview ? 1 : 0,
    });
  });

  test(`${context} ordinary text assignment is unchanged`, () => {
    assert.deepEqual(runAssignment("", "Ada", preview, "text"), {
      current: "Ada", writes: ["Ada"], events: preview ? [] : ["input", "change"],
      patches: preview ? [["upload", "Ada"]] : [], timers: preview ? 1 : 0,
    });
  });
}

test("the file regression uses the real preview and generated page", async () => {
  assert.match(await scriptFileValueBundle(), /fileEditor/);
  const { html } = await publishedScriptFileValue();
  assert.match(html, /type="file"/);
  assert.match(html, /assign-file/);
  assert.match(html, /data-scripts=/);
});
