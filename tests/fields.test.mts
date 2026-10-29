import assert from "node:assert/strict";
import { test, describe } from "node:test";
import { fieldDefaults, fieldStateValues, fieldValuePatch, fieldInitialValue } from "../lib/fields";
import { makeBox, createInitialDoc, makeField } from "../lib/presets";
import { type DocNode, type SiteDoc, type FieldContent } from "../lib/types";
import { previewDynamicRadioDoc, publishedDynamicRadio } from "./helpers/preview-dynamic-radio";
import { useEditor } from "../lib/store";
import { renderLeafNode } from "../components/canvas/render";
import { generateExportProject } from "../lib/export-formats";
import { EXPORT_FRAMEWORK_OPTIONS } from "../lib/generator/export-options";
import { publishedSelectDefault, selectDefaultDoc } from "./helpers/select-default";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { transformSync } from "esbuild";
import * as React from "react";
import { inputDefaultDoc, publishedInputDefault } from "./helpers/input-default";

describe("field-prototype-names", () => {
  const field = (name: string, kind: "input" | "select" | "radio" = "input"): DocNode => ({
    ...makeBox(), id: `node-${name}`, type: "field", attrId: name,
    field: kind === "radio" ? { kind, group: "choice", label: "Selected", checked: true }
      : { kind, defaultValue: "Selected", options: [{ label: "Selected", value: "Selected" }] },
  });
  for (const name of ["constructor", "toString", "__proto__"]) {
    test(`field defaults preserve an own value for the valid ID ${name}`, () => {
      const values = fieldDefaults([field(name)]);
      assert.equal(Object.hasOwn(values, name), true);
      assert.equal(values[name], "Selected");
      assert.equal(Object.getPrototypeOf(values), Object.prototype);
    });
  }
  test("radio item and select state variables preserve a __proto__ ID", () => {
    for (const kind of ["radio", "select"] as const) {
      const values = kind === "radio" ? { choice: "Selected" } : { ["__proto__"]: "Selected" };
      const result = fieldStateValues([field("__proto__", kind)], values);
      assert.equal(Object.hasOwn(result, "__proto__"), true);
      assert.equal(result.__proto__, kind === "radio" ? "true" : "Selected");
      assert.equal(Object.getPrototypeOf(result), Object.prototype);
    }
  });

  test("missing field values do not read inherited object members", () => {
    for (const name of ["constructor", "toString", "__proto__"]) {
      assert.equal(fieldStateValues([field(name)], {})[`${name}.length`], "0");
    }
  });
});

describe("preview-dynamic-radio", () => {
  for (const source of ["query", "data"] as const) {
    test(`preview radio item scripts use resolved ${source} labels for selection and clearing`, () => {
      const fields = Object.values(previewDynamicRadioDoc(source).nodes).filter((node) => node.type === "field");
      for (const labels of [{ smallLabel: "S", mediumLabel: "M" }, { smallLabel: "Small & new", mediumLabel: "Medium" }]) {
        const vars = source === "query" ? labels : { response: labels };
        let values = fieldDefaults(fields, vars);
        assert.deepEqual(values, { size: labels.mediumLabel });
        const set = (id: string, value: string) => {
          const patch = fieldValuePatch(fields, id, value, values, vars);
          assert.notEqual(patch, null);
          values = { ...values, ...patch };
          return fieldStateValues(fields, values, vars);
        };
        assert.equal(set("medium", "false").medium, "false", "clear the resolved initial selection");
        assert.deepEqual(values, { size: "" });
        assert.equal(set("small", "true").small, "true");
        assert.deepEqual(values, { size: labels.smallLabel });
        assert.equal(set("medium", "false").small, "true", "clearing a different item preserves selection");
        assert.equal(set("small", "off").small, "false");
        assert.deepEqual(values, { size: "" });
        assert.equal(set("size", labels.mediumLabel).medium, "true", "group assignments keep working");
        assert.equal(set("size", "")["size.index"], "");
        assert.equal(set("large", "yes").large, "true", "literal labels keep working");
        assert.equal(values.size, "L");
        assert.equal(set("large", "0").large, "false");
        assert.equal(values.size, "");
      }
    });

    test(`the actual exported page resolves ${source} radio labels identically`, async () => {
      const { html } = await publishedDynamicRadio(source);
      assert.match(html, /type="radio" name="size" value="S"/);
      assert.match(html, /type="radio" name="size" checked="" value="M"|type="radio" name="size" value="M" checked=""/);
      assert.doesNotMatch(html, /value="\{(?:response\.)?(?:small|medium)Label\}"/);
    });
  }
});

describe("radio-default-order", () => {
  test("duplicating a checked radio and editing its label selects the last checked item in preview", () => {
    const doc = createInitialDoc();
    const first = makeField("radio");
    first.attrId = "first";
    first.field = { kind: "radio", group: "choice", checked: true, label: "First" };
    doc.nodes[first.id] = first;
    const page = doc.pages[doc.pageOrder[0]];
    page.children = [first.id];
    useEditor.getState().replaceDoc(doc);
    useEditor.getState().setActivePage(page.id);
    useEditor.getState().duplicateNode(first.id);
    const copyId = useEditor.getState().selection!;
    const copied = useEditor.getState().doc.nodes[copyId];
    useEditor.getState().updateNode(copyId, { field: { ...copied.field!, label: "Second" } });
    const current = useEditor.getState().doc;
    const fields = current.pages[page.id].children.map(id => current.nodes[id]);
    assert.equal(fields.filter(n => n.field?.checked).length, 2);
    const before = structuredClone(fields);
    const values = fieldDefaults(fields);
    assert.equal(values.choice, "Second");
    const states = fieldStateValues(fields, values);
    assert.equal(states["choice.index"], "2");
    assert.equal(states.first, "false");
    assert.equal(states[copied.attrId!], "true");
    assert.deepEqual(fields, before, "reading defaults must not rewrite saved checked flags");
  });

  test("unchecked later radios do not clear the winner and independent groups stay independent", () => {
    const radio = (id: string, group: string, checked: boolean, label: string) =>
      ({ ...makeField("radio"), id, attrId: id, field: { kind: "radio" as const, group, checked, label } });
    const fields = [
      radio("a", "choice", true, "Old"),
      radio("b", "other", true, "Other"),
      radio("c", "choice", true, "{latest}"),
      radio("d", "choice", false, "Unchecked"),
    ];
    assert.deepEqual(fieldDefaults(fields, { latest: "New" }), { choice: "New", other: "Other" });
  });
});

describe("submit-disabled", () => {
  function submit(disabled?: boolean): DocNode {
    return { ...makeBox(), id: "send", attrId: "send", type: "field",
      field: { kind: "submit", label: "Send", disabled } };
  }
  function document(disabled?: boolean): SiteDoc {
    return { schemaVersion: 1, siteName: "Submit", assets: {}, nodes: { send: submit(disabled) },
      pageOrder: ["home"], pages: { home: { id: "home", name: "Home", slug: "", title: "Home",
        description: "", children: ["send"] } } };
  }

  for (const disabled of [true, false, undefined]) {
    for (const interactive of [true, false]) {
      test(`canvas submit disabled=${disabled} interactive=${interactive}`, () => {
        const button = renderLeafNode(submit(disabled), {}, { interactive }) as any;
        assert.equal(button.type, "button");
        assert.equal(button.props.disabled, disabled || undefined);
      });
    }
    for (const { value: framework } of EXPORT_FRAMEWORK_OPTIONS) {
      test(`${framework} preserves submit disabled=${disabled}`, () => {
        const { files } = generateExportProject(document(disabled), framework);
        const buttons = Object.values(files).flatMap((source) => [...source.matchAll(/<button\b[^>]*>/g)])
          .map((match) => match[0]).filter((tag) => /\bid=(?:"send"|\{"send"\})/.test(tag));
        assert.ok(buttons.length, "export includes the send button");
        for (const button of buttons) assert.equal(/\sdisabled(?:\s|=|>)/.test(button), disabled === true, button);
      });
    }
  }

  test("enabled submit keeps existing click and repeated refresh callbacks in order", () => {
    const calls: string[] = [];
    const button = renderLeafNode(submit(false), { onClick: () => calls.push("common") },
      { interactive: true, onSubmit: () => calls.push("refresh") }) as any;
    button.props.onClick({});
    button.props.onClick({});
    assert.deepEqual(calls, ["common", "refresh", "common", "refresh"]);
  });
});

describe("select-default", () => {
  test("renaming the default option uses the first remaining choice without rewriting the document", () => {
    useEditor.getState().replaceDoc(selectDefaultDoc());
    const original = useEditor.getState().doc.nodes.choice;
    // 設定の欄と同じ変更。初期値は消さず、「元に戻す」で元の選択肢に戻せる。
    useEditor.getState().updateNode("choice", { field: { ...original.field!, options: ["A", "C"].map(value => ({ label:value,value })) } });
    const edited = structuredClone(useEditor.getState().doc);
    const read = () => fieldDefaults([useEditor.getState().doc.nodes.choice]).choice;
    assert.equal(read(), "A");
    assert.deepEqual(useEditor.getState().doc, edited);
    assert.equal(edited.nodes.choice.field!.defaultValue, "B");
    useEditor.getState().undo();
    assert.equal(read(), "B");
    useEditor.getState().redo();
    assert.equal(read(), "A");
  });

  for (const [name, options, defaultValue, vars, expected, index] of [
    ["valid default", ["A", "B"], "B", {}, "B", "2"],
    ["missing default", ["A", "B"], undefined, {}, "A", "1"],
    ["blank setting omits default", ["A", "{empty}"], "", { empty: "" }, "A", "1"],
    ["removed default", ["A", "C"], "B", {}, "A", "1"],
    ["no choices", [], "B", {}, "", "0"],
    ["resolved valid default", ["{a}", "{b}"], "{selected}", { a: "A", b: "B", selected: "B" }, "B", "2"],
    ["resolved removed default", ["{a}", "{b}"], "{selected}", { a: "A", b: "C", selected: "B" }, "A", "1"],
    ["resolved empty first choice", ["{empty}", "B"], "C", { empty: "" }, "", "1"],
    ["resolved empty default", ["A", "{empty}"], "{empty}", { empty: "" }, "", "2"],
  ] as const) {
    test(`select initial state matches native selection: ${name}`, () => {
      const doc = selectDefaultDoc({ options: [...options].map(value => ({label:value,value})), defaultValue });
      const node = doc.nodes.choice;
      const field = node.field!;
      assert.equal(fieldInitialValue(field, vars), expected);
      const values = fieldDefaults([node], vars);
      assert.equal(values.choice, expected);
      assert.equal(fieldStateValues([node], values, vars)["choice.index"], index);
      const leaf = renderLeafNode(node, {}, { interactive: true, vars, fieldValues: values }) as any;
      assert.equal(leaf.props.value, expected);
      const unbound = renderLeafNode({ ...node, attrId: undefined }, {}, { interactive: true, vars }) as any;
      assert.equal(unbound.props.value, expected);
    });
  }

  test("generated select preserves the remaining options in order", async () => {
    const { html } = await publishedSelectDefault(selectDefaultDoc({ options: ["A", "C"].map(value => ({ label:value,value })) }));
    assert.match(html, /<select[^>]*id="choice"/);
    assert.match(html, /<option[^>]*value="A"[^>]*>A<\/option><option[^>]*value="C"[^>]*>C<\/option>/);
    assert.doesNotMatch(html, /<option[^>]*>B<\/option>/);
  });
});

describe("input-default", () => {
  /** DOM が返す値は外から指定する。ブラウザの正規化のアルゴリズムは再実装しない。 */
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

  /** 実際のデータのフックの計算を動かす。React の commit と DOM は、ネイティブの e2e で確かめる。 */
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
      // ネイティブの input での伝播の順序を再現する。capture の後、フレームの変更のスクリプトが
      // React へ変数を書き戻す。root の onChange より前に再描画されても、入力値を失わない。
      const input = { value: "7" };
      leaf().props.onInputCapture?.({ currentTarget: input });
      data.setClientValues({ changes: 1 });
      input.value = leaf().props.value;
      assert.equal(input.value, "7");
      assert.equal(render().pageVars.entry, "7");
      assert.equal(render().pageVars.changes, 1);
      assert.deepEqual(snapshot(), saved);
      // さらに同じイベントのスクリプトが値を変えた場合も、続く描画で元に戻さない。
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

  test("generated input defaults preserve authored number and range values", async () => {
    const doc = inputDefaultDoc({ kind: "input", inputType: "number", defaultValue: "invalid" });
    const before = structuredClone(doc);
    const { html } = await publishedInputDefault(doc);
    assert.match(html, /type="number"[^>]*value="invalid"/);
    assert.deepEqual(doc, before);
    const range = await publishedInputDefault(inputDefaultDoc({ kind: "input", inputType: "range", defaultValue: "14", step: "5" }));
    assert.match(range.html, /type="range"[^>]*step="5"[^>]*value="14"/);
    const missing = await publishedInputDefault(inputDefaultDoc({ kind: "input", inputType: "range" }));
    assert.doesNotMatch(missing.html.match(/<input[^>]+>/)![0], /value=/);
  });
});
