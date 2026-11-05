import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
import * as React from "react";
import { fieldDefaults, fieldStateValues, fieldValuePatch } from "../lib/fields";
import { renderLeafNode } from "../components/canvas/render";
import { SCRIPT_RUNTIME, scriptsFile } from "../lib/script-runtime";
import { useEditor } from "../lib/store";
import { publishedScriptSelectValue, scriptSelectValueBundle, scriptSelectValueDoc } from "./helpers/script-select-value";

/** 実Canvasデータフックの状態・変数を読む。DOMの選択・イベントはnative e2eで確かめる。 */
function canvasData(doc = scriptSelectValueDoc()) {
  const slots: any[] = [];
  let cursor = 0;
  const hooks = { ...React,
    useMemo: (fn: () => unknown) => fn(), useCallback: (fn: unknown) => fn, useEffect() {},
    useRef: (value: unknown) => ({ current: value }),
    useState(initial: unknown) {
      const at = cursor++;
      if (!(at in slots)) slots[at] = typeof initial === "function" ? initial() : initial;
      return [slots[at], (next: any) => { slots[at] = typeof next === "function" ? next(slots[at]) : next; }];
    },
  };
  const file = resolve("components/canvas/useCanvasData.ts");
  const require = createRequire(file), mod = { exports: {} as any };
  const code = transformSync(readFileSync(file, "utf8"), { loader: "ts", format: "cjs" }).code;
  new Function("require", "module", "exports", code)((id: string) => id === "react" ? hooks : id === "../../lib/store" ? { useEditor: Object.assign((pick: any) => pick(useEditor.getState()), useEditor) } : require(id), mod, mod.exports);
  return () => {
    cursor = 0;
    return mod.exports.useCanvasData({ doc, page: doc.pages.home, activePageId: "home", previewIndex: 0, mode: "preview", setPreviewIndex() {} });
  };
}

for (const [name, options, requested, expected, index] of [
  ["absent option", ["A", "B"], "C", null, "0"],
  ["empty assignment without an empty option", ["A", "B"], "", null, "0"],
  ["valid option", ["A", "B"], "A", "A", "1"],
  ["actual empty option", ["A", "{empty}", "B"], "", "", "2"],
  ["missing beside an empty option", ["A", "{empty}", "B"], "C", null, "0"],
  ["no options", [], "C", null, "0"],
] as const) test(`script select assignment: ${name}`, () => {
  const doc = scriptSelectValueDoc([...options]);
  useEditor.getState().replaceDoc(doc);
  const before = structuredClone({ doc: useEditor.getState().doc, past: useEditor.getState().past, future: useEditor.getState().future });
  const renderData = canvasData(doc);
  let data = renderData();
  const fields = data.fieldVarNodes;
  const patch = fieldValuePatch(fields, "choice", requested, fieldDefaults(fields, data.pageVars), data.pageVars);
  assert.deepEqual(patch, { choice: expected });
  data.setFieldValues(patch);
  data = renderData();
  assert.equal(data.pageVars.choice, expected ?? "");
  assert.equal(data.pageVars["choice.index"], index);
  const leaf = renderLeafNode(doc.nodes.choice, {}, { interactive: true, vars: data.pageVars, fieldValues: data.fieldValues }) as any;
  assert.equal(leaf.props.value, expected ?? "");
  assert.equal(leaf.props.children.length, options.length, "never insert a synthetic option");
  if (expected === null) {
    const element = { selectedIndex: 0 };
    leaf.props.ref(element);
    assert.equal(element.selectedIndex, -1, "React's first-option fallback is cleared after commit");
  }
  assert.deepEqual({ doc: useEditor.getState().doc, past: useEditor.getState().past, future: useEditor.getState().future }, before);
});

test("no-selection and an empty option have different preview indices", () => {
  const fields = [scriptSelectValueDoc(["A", "{empty}"]).nodes.choice];
  assert.equal(fieldStateValues(fields, { choice: null }, { empty: "" })["choice.index"], "0");
  assert.equal(fieldStateValues(fields, { choice: "" }, { empty: "" })["choice.index"], "2");
});

/** nativeのvalue setter後の結果を返す最小の入力欄。通知とpreviewへの呼び出しだけを検証する。 */
function runtimeAssignments(preview: boolean, options: string[], initial: number, values: string[]) {
  const doc = scriptSelectValueDoc(options);
  const script = { id: "load", trigger: "load", pos: { x: 0, y: 0 }, steps: values.map((value, i) => ({ id: `set-${i}`, kind: "set-value", target: "choice", value })) };
  doc.pages.home.pageScripts = undefined;
  doc.nodes = { choice: { ...doc.nodes.choice, scripts: [script as any] } };
  doc.pages.home.children = ["choice"];
  const events: string[] = [], patches: string[] = [], timers: Function[] = [];
  let selectedIndex = initial;
  const input = {
    id: "choice", tagName: "SELECT", type: "select-one", matches: () => true, closest: () => null,
    getAttribute: (key: string) => key === "data-scripts" ? JSON.stringify([script]) : null,
    get selectedIndex() { return selectedIndex; },
    get value() { return options[selectedIndex] ?? ""; },
    set value(v: string) { selectedIndex = options.indexOf(v); },
    dispatchEvent: (e: Event) => events.push(e.type),
  };
  const root = {
    querySelector: () => null,
    querySelectorAll: (selector: string) => selector === "[data-scripts]" || selector === "#choice" ? [input] : [],
    addEventListener() {}, removeEventListener() {}, contains: () => true,
  };
  runInNewContext(preview ? `(${SCRIPT_RUNTIME})(env).install(document)` : scriptsFile(doc), {
    document: root, CSS: { escape: (v: string) => v }, Event,
    env: { setValue: (_id: string, value: string) => { patches.push(value); return true; } },
    MutationObserver: class { observe() {} disconnect() {} }, requestAnimationFrame() {},
    setTimeout: (fn: Function) => { timers.push(fn); return timers.length; }, clearTimeout() {},
  });
  return { selectedIndex, events, patches, timers: timers.length };
}
for (const preview of [true, false]) {
  const label = preview ? "preview" : "exported";
  for (const [name, options, initial, values, expected, changes] of [
    ["repeated missing values", ["A", "B"], 1, ["C", "C", "D"], -1, 1],
    ["repeated clear", ["A", "B"], 1, ["", ""], -1, 1],
    ["missing then actual empty", ["A", "", "B"], 2, ["C", "", ""], 1, 2],
    ["empty then missing", ["A", "", "B"], 1, ["C", "C"], -1, 1],
    ["no choices", [], -1, ["C", ""], -1, 0],
    ["valid changes", ["A", "B"], 1, ["A", "A", "B"], 1, 2],
  ] as const) test(`${label}: ${name} only notifies effective selection changes`, () => {
    const got = runtimeAssignments(preview, [...options], initial, [...values]);
    assert.equal(got.selectedIndex, expected);
    assert.equal(got.events.length, preview ? 0 : changes * 2);
    assert.equal(got.patches.length, preview ? changes : 0);
    assert.equal(got.timers, preview ? changes : 0);
  });
}

test("native regression bundles the actual ScriptEditor, Canvas and generated page", async () => {
  const bundle = await scriptSelectValueBundle();
  assert.match(bundle, /function ScriptEditorInner/);
  assert.match(bundle, /function Canvas/);
  const { html } = await publishedScriptSelectValue(scriptSelectValueDoc());
  assert.match(html, /data-scripts=/);
  assert.match(html, /<option>A<\/option><option selected="">B<\/option>/);
});
