import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { transformSync } from "esbuild";
import * as React from "react";
import { fieldInitialValue } from "../lib/fields";
import { renderLeafNode } from "../components/canvas/render";
import { useEditor } from "../lib/store";
import type { FieldContent } from "../lib/types";
import { inputDefaultBundle, inputDefaultDoc, publishedInputDefault } from "./helpers/input-default";

/** DOMの返す値は外から指定する。ブラウザの正規化アルゴリズムを再実装しない。 */
function nativeValues(accepted: () => string, run: (reads: Record<string, string>[]) => void) {
  const old = Object.getOwnPropertyDescriptor(globalThis, "document");
  const oldElement = Object.getOwnPropertyDescriptor(globalThis, "HTMLElement");
  const reads: Record<string, string>[] = [];
  Object.defineProperty(globalThis, "HTMLElement", { configurable: true, value: class {} });
  Object.defineProperty(globalThis, "document", { configurable: true, value: {
    activeElement: null,
    createElement(tag: string) {
      const attrs: Record<string, string> = { tag };
      return {
        set type(value: string) { attrs.type = value; },
        get type() { return attrs.type; },
        setAttribute(name: string, value: string) { attrs[name] = value; },
        set defaultValue(value: string) { attrs.defaultValue = value; },
        get value() { reads.push({ ...attrs }); return accepted(); },
      };
    },
  } });
  try { run(reads); } finally {
    if (old) Object.defineProperty(globalThis, "document", old);
    else Reflect.deleteProperty(globalThis, "document");
    if (oldElement) Object.defineProperty(globalThis, "HTMLElement", oldElement);
    else Reflect.deleteProperty(globalThis, "HTMLElement");
  }
}

/** 実データフックの計算を動かす。ReactのcommitとDOMはnative e2eで確かめる。 */
function canvasData() {
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
  return (mode = "preview") => {
    cursor = 0;
    const doc = useEditor.getState().doc;
    return mod.exports.useCanvasData({ doc, page: doc.pages.home, activePageId: "home", previewIndex: 0, mode, setPreviewIndex() {} });
  };
}

const snapshot = () => {
  const { doc, past, future } = useEditor.getState();
  return structuredClone({ doc, past, future });
};

for (const [name, field, accepted] of [
  ["missing range", { kind: "input", inputType: "range" }, "50"],
  ["missing color", { kind: "input", inputType: "color" }, "#000000"],
  ["invalid number", { kind: "input", inputType: "number", defaultValue: "invalid" }, ""],
  ["invalid date", { kind: "input", inputType: "date", defaultValue: "2026-02-30" }, ""],
  ["single-line text", { kind: "input", defaultValue: "a\nb" }, "ab"],
  ["textarea", { kind: "textarea", defaultValue: "a\r\nb" }, "a\nb"],
] as [string, FieldContent, string][]) test(`native initial-value result reaches preview without a stored edit: ${name}`, () => {
  useEditor.getState().replaceDoc(inputDefaultDoc(field));
  const before = snapshot();
  nativeValues(() => accepted, (reads) => {
    const data = canvasData()();
    assert.equal(data.pageVars.entry, accepted);
    assert.deepEqual(data.fieldValues, {}, "initial normalization never masquerades as user input");
    const leaf = renderLeafNode(before.doc.nodes.entry, {}, { interactive: true, vars: data.pageVars, fieldValues: data.fieldValues }) as any;
    assert.equal(leaf.props.value, accepted);
    assert.ok(reads.length);
    assert.deepEqual(snapshot(), before);
  });
});

test("native initialization receives resolved constraints and the original default attribute as the range step base", () => {
  const field: FieldContent = { kind: "input", inputType: "range", defaultValue: "{initial}", min: "{low}", max: "{high}", step: "{step}" };
  nativeValues(() => "14", (reads) => {
    assert.equal(fieldInitialValue(field, { initial: "14", low: "", high: "99", step: "5" }), "14");
    assert.deepEqual(reads, [{ tag: "input", type: "range", max: "99", step: "5", defaultValue: "14" }]);
  });
  nativeValues(() => "15", (reads) => {
    assert.equal(fieldInitialValue({ kind: "input", inputType: "range", min: "10", max: "20", step: "5" }), "15");
    assert.deepEqual(reads, [{ tag: "input", type: "range", min: "10", max: "20", step: "5", defaultValue: "" }], "set the empty default after bounds so the browser computes the midpoint");
  });
});

test("document edits, undo/redo and remote changes recompute only untouched input defaults", () => {
  useEditor.getState().replaceDoc(inputDefaultDoc({ kind: "input", inputType: "number", defaultValue: "12" }));
  const render = canvasData();
  let accepted = "12";
  nativeValues(() => accepted, () => {
    assert.equal(render().pageVars.entry, "12");
    const edit = (defaultValue: string) => {
      const field = useEditor.getState().doc.nodes.entry.field!;
      useEditor.getState().updateNode("entry", { field: { ...field, defaultValue } });
    };
    edit("invalid"); accepted = "";
    const edited = snapshot();
    assert.equal(render().pageVars.entry, "");
    assert.deepEqual(snapshot(), edited);
    useEditor.getState().undo(); accepted = "12";
    assert.equal(render().pageVars.entry, "12");
    useEditor.getState().redo(); accepted = "";
    assert.equal(render().pageVars.entry, "");
    assert.deepEqual(snapshot(), edited);
    const remote = structuredClone(useEditor.getState().doc);
    remote.nodes.entry.field!.defaultValue = "24";
    useEditor.getState().applyRemoteDoc(remote); accepted = "24";
    assert.equal(render().pageVars.entry, "24");
    const beforeInput = snapshot();
    const data = render();
    const leaf = renderLeafNode(remote.nodes.entry, {}, { interactive: true, fieldValues: data.fieldValues, vars: data.pageVars,
      onField: (name, value) => data.setFieldValues((prev: object) => ({ ...prev, [name]: value })),
    }) as any;
    leaf.props.onChange({ target: { value: "7" } });
    assert.equal(render().pageVars.entry, "7");
    assert.equal(render("design").fieldValues.entry, "7");
    assert.equal(render().pageVars.entry, "7");
    assert.deepEqual(snapshot(), beforeInput);
    edit("30"); accepted = "30";
    assert.equal(render().pageVars.entry, "7", "a later default cannot replace user input");
    render().setFieldValues({ entry: "" });
    assert.equal(render().pageVars.entry, "", "a script-cleared value stays empty");
    assert.deepEqual(render().fieldValues, { entry: "" });
  });
});

for (const source of ["settings", "remote"] as const) test(`manual input is owned before a change script rerenders ${source} defaults`, () => {
  useEditor.getState().replaceDoc(inputDefaultDoc({ kind: "input", inputType: "number", defaultValue: "12" }));
  const render = canvasData();
  const defaultValue = source === "settings" ? "invalid" : "24";
  if (source === "settings") {
    const field = useEditor.getState().doc.nodes.entry.field!;
    useEditor.getState().updateNode("entry", { field: { ...field, defaultValue } });
  } else {
    const remote = structuredClone(useEditor.getState().doc);
    remote.nodes.entry.field!.defaultValue = defaultValue;
    useEditor.getState().applyRemoteDoc(remote);
  }
  const saved = snapshot();
  nativeValues(() => source === "settings" ? "" : "24", () => {
    const data = render();
    const leaf = () => {
      const current = render();
      return renderLeafNode(saved.doc.nodes.entry, {}, {
        interactive: true, fieldValues: current.fieldValues, vars: current.pageVars,
        onField: (name, value) => current.setFieldValues((prev: object) => ({ ...prev, [name]: value })),
      }) as any;
    };
    // ネイティブinputの伝播順をモデル化する。captureの後、フレームの変更スクリプトが
    // Reactへ変数を書き戻す。rootのonChangeより前に再描画されても、入力値を失わない。
    const input = { value: "7" };
    leaf().props.onInputCapture?.({ currentTarget: input });
    data.setClientValues({ changes: 1 });
    input.value = leaf().props.value;
    assert.equal(input.value, "7");
    assert.equal(render().pageVars.entry, "7");
    assert.equal(render().pageVars.changes, 1);
    assert.deepEqual(snapshot(), saved);
    // さらに同じイベントのスクリプトが値を変えた場合も、後続の描画で元へ戻さない。
    render().setFieldValues({ entry: "8" });
    assert.equal(leaf().props.value, "8");
    assert.equal(render().pageVars.entry, "8");
    assert.deepEqual(snapshot(), saved);
  });
});

test("design rendering keeps authored defaults and server imports do not require a DOM", () => {
  const field: FieldContent = { kind: "input", inputType: "number", defaultValue: "invalid" };
  assert.equal(fieldInitialValue(field), "invalid", "without a browser, leave initial markup to the native control");
  nativeValues(() => "", () => {
    const node = inputDefaultDoc(field).nodes.entry;
    const design = renderLeafNode(node, {}, { fieldValues: { entry: "7" } }) as any;
    assert.equal(design.props.value, "invalid");
    assert.equal(design.props.readOnly, true);
  });
});

test("native regression bundles actual SettingsPanel and Canvas; generated defaults remain authored", async () => {
  const doc = inputDefaultDoc({ kind: "input", inputType: "number", defaultValue: "invalid" });
  const bundle = await inputDefaultBundle(doc);
  assert.match(bundle, /function SettingsPanel/);
  assert.match(bundle, /function Canvas/);
  const before = structuredClone(doc);
  const { html } = await publishedInputDefault(doc);
  assert.match(html, /type="number"[^>]*value="invalid"/);
  assert.deepEqual(doc, before);
  const range = await publishedInputDefault(inputDefaultDoc({ kind: "input", inputType: "range", defaultValue: "14", step: "5" }));
  assert.match(range.html, /type="range"[^>]*step="5"[^>]*value="14"/);
  const missing = await publishedInputDefault(inputDefaultDoc({ kind: "input", inputType: "range" }));
  assert.doesNotMatch(missing.html.match(/<input[^>]+>/)![0], /value=/);
});
