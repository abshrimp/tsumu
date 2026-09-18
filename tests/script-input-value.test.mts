import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { SCRIPT_RUNTIME, scriptsFile } from "../lib/script-runtime";
import { renderLeafNode } from "../components/canvas/render";
import { publishedScriptInputValue, scriptInputValueDoc } from "./helpers/script-input-value";

/** setter の結果は外から渡す。DOM の正規化そのものは、ネイティブの e2e で検証する。 */
function assignments(preview: boolean, initial: string, requested: string[], accepted: string[]) {
  const doc = scriptInputValueDoc({ kind: "input", inputType: "number", defaultValue: initial }, "", "");
  const script = { id: "load", trigger: "load", pos: { x: 0, y: 0 }, steps: requested.map((value, i) => ({ id: `set-${i}`, kind: "set-value", target: "entry", value })) };
  doc.nodes.entry.scripts = [script as any];
  doc.pages.home.children = ["entry"];
  doc.pages.home.pageScripts = undefined;
  const writes: string[] = [], events: string[] = [], patches: string[] = [], timers: Function[] = [];
  let current = initial;
  const input = {
    id: "entry", tagName: "INPUT", type: "number", matches: () => true, closest: () => null,
    getAttribute: (key: string) => key === "data-scripts" ? JSON.stringify([script]) : null,
    get value() { return current; },
    set value(v: string) { current = accepted[writes.length]; writes.push(v); },
    dispatchEvent: (e: Event) => events.push(e.type),
  };
  const root = {
    querySelector: () => null,
    querySelectorAll: (selector: string) => selector === "[data-scripts]" || selector === "#entry" ? [input] : [],
    addEventListener() {}, removeEventListener() {}, contains: () => true,
  };
  runInNewContext(preview ? `(${SCRIPT_RUNTIME})(env).install(document)` : scriptsFile(doc), {
    document: root, CSS: { escape: (v: string) => v }, Event,
    env: { setValue: (_id: string, value: string) => { patches.push(value); return true; } },
    MutationObserver: class { observe() {} disconnect() {} }, requestAnimationFrame() {},
    setTimeout: (fn: Function) => { timers.push(fn); return timers.length; }, clearTimeout() {},
  });
  return { current, writes, events, patches, timers: timers.length };
}

for (const preview of [true, false]) {
  const label = preview ? "preview" : "exported";
  test(`${label}: assignments notify only effective native value changes`, () => {
    const result = assignments(preview, "12", ["invalid", "invalid", "different-invalid", "8", "8"], ["", "", "", "8"]);
    assert.deepEqual(result, {
      current: "8", writes: ["invalid", "invalid", "different-invalid", "8"],
      events: preview ? [] : ["input", "change", "input", "change"],
      patches: preview ? ["", "8"] : [], timers: preview ? 2 : 0,
    });
  });
  test(`${label}: normalization can retain the prior value without notifying`, () => {
    assert.deepEqual(assignments(preview, "20", ["99", "999"], ["20", "20"]), {
      current: "20", writes: ["99", "999"], events: [], patches: [], timers: 0,
    });
  });
  test(`${label}: normalized values are forwarded rather than requested values`, () => {
    assert.deepEqual(assignments(preview, "10", ["99", "14"], ["20", "15"]), {
      current: "15", writes: ["99", "14"],
      events: preview ? [] : ["input", "change", "input", "change"],
      patches: preview ? ["20", "15"] : [], timers: preview ? 2 : 0,
    });
  });
}

test("generated number input includes its assignment scripts", async () => {
  const doc = scriptInputValueDoc({ kind: "input", inputType: "number", defaultValue: "12" }, "invalid", "8");
  const { html } = await publishedScriptInputValue(doc);
  assert.match(html, /type="number"/);
  assert.match(html, /data-scripts=/);
});

for (const kind of ["input", "textarea"] as const) {
  test(`${kind}: Canvas records native input in capture phase before change scripts can rerender it`, () => {
    const doc = scriptInputValueDoc({ kind, defaultValue: "before" }, "assigned", "restored");
    const values = { entry: "before" };
    const render = (interactive = true) => renderLeafNode(doc.nodes.entry, {}, {
      interactive, fieldValues: values,
      onField: (name, value) => { values[name as "entry"] = value; },
    }) as any;
    const leaf = render();
    assert.equal(typeof leaf.props.onInputCapture, "function");
    leaf.props.onInputCapture({ currentTarget: { value: "typed" } });
    // スクリプトによる再描画が bubble の onChange より前でも、入力値を保つ。
    assert.equal(render().props.value, "typed");
    leaf.props.onChange({ target: { value: "typed" } });
    assert.equal(render().props.value, "typed");
    assert.equal(render(false).props.onInputCapture, undefined);
    assert.equal(doc.nodes.entry.field!.defaultValue, "before");
  });
}
