import { describe, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { transformSync } from "./helpers/bundle";
import * as React from "react";
import { useEditor } from "../lib/store";
import { commitFieldsDoc } from "./helpers/commit-fields";
import { runInNewContext } from "node:vm";
import { isEscapeKey } from "../lib/keys";
import { fieldDefaults, fieldStateValues, fieldValuePatch, fieldInitialValue } from "../lib/fields";
import { makeBox, createInitialDoc, makeField } from "../lib/presets";
import { type DocNode, type SiteDoc, type FieldContent } from "../lib/types";
import { previewDynamicRadioDoc, publishedDynamicRadio } from "./helpers/preview-dynamic-radio";
import { renderLeafNode } from "../components/canvas/render";
import { generateExportProject } from "../lib/export-formats";
import { EXPORT_FRAMEWORK_OPTIONS } from "../lib/generator/export-options";
import { publishedSelectDefault, selectDefaultDoc } from "./helpers/select-default";
import { inputDefaultDoc, publishedInputDefault } from "./helpers/input-default";
import { SCRIPT_RUNTIME, scriptsFile } from "../lib/script-runtime";
import { radioClearDoc } from "./helpers/radio-clear-bindings";
import { SEARCH_FORM_COMPONENT } from "../lib/generator/templates";
import { searchFormFiles } from "./helpers/search-form-navigation";
import { REACT_SEARCH_FORM } from "../lib/generator/react-form";

describe("commit-fields", () => {
  before(() => {
    useEditor.setState({
      breakpoint: "base", customWidth: null, styleState: "default", mode: "design",
      pageTheme: "light", selection: null, selectedIds: [], editingComponentId: null, scriptEditor: null,
    });
  });
// 実際のソースの入力・確定のハンドラーとフックを動かす。ブラウザのフォーカスと defaultValue は、e2e で確かめる。
function mount(kind: "input" | "textarea", extra: Record<string, unknown> = {}) {
  useEditor.getState().replaceDoc(commitFieldsDoc());
  const field = kind === "input" ? "title" : "description";
  const slots: any[] = [];
  const effects: (() => void)[] = [];
  const frames: (() => void)[] = [];
  let cursor = 0;
  const element = { value: useEditor.getState().doc.pages.p[field] };
  const document = { activeElement: element as typeof element | null };
  const hooks = {
    ...React,
    useId() { const i = cursor++; return slots[i] ??= `test-field-${i}`; },
    useRef(initial: unknown) { return slots[cursor++] ??= { current: initial }; },
    useEffect(effect: () => void, deps: unknown[]) {
      const i = cursor++;
      if (!slots[i] || deps.some((value, n) => !Object.is(value, slots[i][n]))) {
        slots[i] = deps;
        effects.push(effect);
      }
    },
  };
  const mod = { exports: {} as any };
  const require = createRequire(resolve("components/controls.tsx"));
  const source = transformSync(readFileSync("components/controls.tsx", "utf8"), {
    loader: "tsx", jsx: "automatic", format: "cjs",
  }).code;
  new Function("require", "module", "exports", "document", "requestAnimationFrame", source)(
    (id: string) => id === "react" ? hooks : require(id), mod, mod.exports, document,
    (fn: () => void) => { frames.push(fn); },
  );
  const writes: string[] = [];
  const render = () => {
    cursor = 0;
    const view = mod.exports[kind === "input" ? "CommitInput" : "CommitTextarea"]({
      ...extra, value: useEditor.getState().doc.pages.p[field],
      onCommit(value: string) {
        writes.push(value);
        useEditor.getState().updatePage("p", { [field]: value.trim() || "Original " + field });
      },
    });
    view.props.ref.current = element;
    effects.splice(0).forEach(effect => effect());
    return view.props;
  };
  render();
  return {
    element, writes, field, render,
    type(value: string) {
      element.value = value;
      render().onInput?.({ target: element, currentTarget: element });
    },
    blur() {
      document.activeElement = null;
      render().onBlur({ target: element, currentTarget: element });
      render();
      frames.splice(0).forEach(frame => frame());
    },
    focus() { document.activeElement = element; render().onFocus?.({ target: element, currentTarget: element }); },
    remote(value: string) {
      const doc = structuredClone(useEditor.getState().doc);
      doc.pages.p[field] = value;
      useEditor.getState().applyRemoteDoc(doc);
      render();
    },
    snapshot() {
      const { doc, past, future } = useEditor.getState();
      return structuredClone({ doc, past, future });
    },
  };
}

for (const kind of ["input", "textarea"] as const) {
  for (const editedBefore of [false, true]) test(`${kind}: idle blur preserves remote changes${editedBefore ? " after an earlier commit" : ""}`, () => {
    const field = mount(kind);
    if (editedBefore) { field.type("Earlier local edit"); field.blur(); field.focus(); }
    field.remote("Collaborator value");
    const before = field.snapshot();
    const writes = field.writes.length;
    field.blur();
    assert.deepEqual(field.snapshot(), before);
    assert.equal(field.writes.length, writes);
    assert.equal(field.element.value, "Collaborator value");
  });

  test(`${kind}: pending typing survives remote updates and commits once`, () => {
    const field = mount(kind);
    field.type("  Local draft  ");
    field.remote("Collaborator value");
    assert.equal(field.element.value, "  Local draft  ");
    const before = field.snapshot();
    field.blur();
    assert.equal(useEditor.getState().doc.pages.p[field.field], "Local draft");
    assert.equal(field.element.value, "Local draft");
    assert.deepEqual(field.writes, ["  Local draft  "]);
    assert.equal(useEditor.getState().past.length, before.past.length + 1);
    useEditor.getState().undo();
    assert.equal(useEditor.getState().doc.pages.p[field.field], "Collaborator value");
    useEditor.getState().redo();
    assert.equal(useEditor.getState().doc.pages.p[field.field], "Local draft");
    field.focus(); field.blur();
    assert.equal(field.writes.length, 1);
  });

  for (const operation of ["undo", "redo"] as const) test(`${kind}: an idle focused field does not reverse ${operation}`, () => {
    const field = mount(kind);
    field.type("Local edit"); field.blur();
    if (operation === "redo") useEditor.getState().undo();
    field.render(); field.focus();
    useEditor.getState()[operation](); field.render();
    const before = field.snapshot();
    field.blur();
    assert.deepEqual(field.snapshot(), before);
  });

  test(`${kind}: forwards caller handlers and resets rejected input even without a value change`, () => {
    let inputEvents = 0;
    const onFocus = () => {};
    const onChange = () => {};
    const onKeyDown = () => {};
    const onCompositionStart = () => {};
    const field = mount(kind, { onInput: () => { inputEvents++; }, onFocus, onChange, onKeyDown, onCompositionStart });
    const props = field.render();
    assert.equal(props.onFocus, onFocus);
    assert.equal(props.onChange, onChange);
    assert.equal(props.onKeyDown, onKeyDown);
    assert.equal(props.onCompositionStart, onCompositionStart);
    field.type(""); field.blur();
    assert.equal(inputEvents, 1);
    assert.equal(field.element.value, `Original ${field.field}`);
    field.focus(); field.type(""); field.blur();
    assert.equal(field.element.value, `Original ${field.field}`);
    assert.equal(inputEvents, 2);
  });

  for (const flag of ["disabled", "readOnly"]) test(`${kind}: ${flag} stays native and idle blur cannot write stale values`, () => {
    const field = mount(kind, { [flag]: true });
    assert.equal(field.render()[flag], true);
    field.remote("Remote value");
    const before = field.snapshot();
    field.blur();
    assert.deepEqual(field.snapshot(), before);
    assert.deepEqual(field.writes, []);
  });
}
});

describe("field-key-picker-ime", () => {
function mountPicker() {
  const source = readFileSync("components/script-editor/ValueTransformSettings.tsx", "utf8");
  const picker = source.slice(source.indexOf("function fieldSuggestions("), source.indexOf("function RecipeStepSettings("));
  const slots: any[] = [];
  let cursor = 0, value = "商品";
  const changes: string[] = [];
  const context: any = {
    useRef(initial: any) { return slots[cursor++] ??= { current: initial }; },
    useId() { cursor++; return "field-key"; },
    useState(initial: any) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], (next: any) => { slots[index] = typeof next === "function" ? next(slots[index]) : next; }];
    },
    useMemo: (fn: () => unknown) => fn(), useEffect() {}, tr: (text: string) => text, isEscapeKey,
    ChevronDown() {}, createPortal: (child: unknown) => child,
    React: { createElement: (type: unknown, props: any, ...children: unknown[]) => ({ type, props: { ...props, children } }) },
  };
  runInNewContext(transformSync(picker + "\nglobalThis.picker = FieldKeyPicker;", { loader: "tsx", jsx: "transform" }).code, context);
  const input = () => {
    cursor = 0;
    return context.picker({ value, options: ["商品名", "商品番号"], onChange(next: string) { value = next; changes.push(next); } }).props.children[0].props;
  };
  input().onFocus();
  return { input, changes, press(key: string, nativeEvent = {}) {
    let prevented = 0, stopped = 0;
    input().onKeyDown({ key, nativeEvent, preventDefault() { prevented++; }, stopPropagation() { stopped++; } });
    return { prevented, stopped };
  } };
}

for (const nativeEvent of [{ isComposing: true }, { keyCode: 229 }]) {
  for (const key of ["Enter", "ArrowDown", "ArrowUp", "Escape"]) {
    test(`field picker leaves ${key} to IME (${JSON.stringify(nativeEvent)})`, () => {
      const picker = mountPicker();
      const before = picker.input();
      assert.deepEqual(picker.press(key, nativeEvent), { prevented: 0, stopped: 0 });
      const after = picker.input();
      assert.equal(after.value, before.value);
      assert.equal(after["aria-expanded"], true);
      assert.equal(after["aria-activedescendant"], before["aria-activedescendant"]);
      assert.deepEqual(picker.changes, []);
    });
  }
}

test("field picker supports ordinary arrows, Enter and Escape after composition", () => {
  const picker = mountPicker();
  assert.equal(picker.press("ArrowDown").prevented, 1);
  assert.equal(picker.press("Enter").prevented, 1);
  assert.deepEqual(picker.changes, ["商品番号"]);
  assert.equal(picker.input()["aria-expanded"], false);
  picker.input().onFocus();
  assert.deepEqual(picker.press("Escape"), { prevented: 1, stopped: 1 });
  assert.equal(picker.input()["aria-expanded"], false);
  assert.equal(picker.input().value, "商品番号");
  assert.deepEqual(picker.changes, ["商品番号"]);
});
});

describe("fields", () => {
  before(() => {
    useEditor.setState({
      breakpoint: "base", customWidth: null, styleState: "default", mode: "design",
      pageTheme: "light", selection: null, selectedIds: [], editingComponentId: null, scriptEditor: null,
    });
  });
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
});

describe("radio-clear-bindings", () => {
/** DOM の入力の状態と通知だけを用意し、書き出した実際のランタイムを実行する。 */
function harness(options: { preview?: boolean; clearOnChange?: boolean; live?: boolean; configure?: (doc: SiteDoc) => void } = {}) {
  const doc = radioClearDoc(options.clearOnChange);
  if (options.live === false) {
    delete doc.nodes.result.text;
    delete doc.nodes.counts.text;
    delete doc.nodes.dependent.field;
  }
  options.configure?.(doc);
  const listeners = new Map<string, Array<(event: any) => void>>();
  const events: string[] = [];
  const elements: Element[] = [];
  class Element {
    nodeType = 1;
    parentElement: Element | null = null;
    firstChild: { nodeType: number; nodeValue: string } | null = null;
    attrs = new Map<string, string>();
    input?: Element;
    type = "";
    name = "";
    value = "";
    placeholder = "";
    disabled = false;
    private selected = false;
    constructor(public id: string, public tagName = "DIV") { elements.push(this); }
    get checked() { return this.selected; }
    set checked(on: boolean) {
      this.selected = on;
      // 同じフォーム・グループのラジオボタンを選ぶと、元の選択はネイティブの DOM が外す。
      if (on && this.type === "radio" && this.name) {
        for (const other of elements) if (other !== this && other.type === "radio" && other.name === this.name && other.form === this.form) other.selected = false;
      }
    }
    get form(): Element | null { return this.tagName === "FORM" ? this : this.parentElement?.form ?? null; }
    getAttribute(key: string) { return this.attrs.get(key) ?? null; }
    setAttribute(key: string, value: string) { this.attrs.set(key, value); }
    hasAttribute(key: string) { return this.attrs.has(key); }
    matches(selector: string) { return selector.split(",").some((tag) => tag.toUpperCase() === this.tagName); }
    querySelector() { return this.input ?? null; }
    getRootNode() { return root; }
    closest(selector: string): Element | null {
      if (selector === "[data-scripts]") return this.hasAttribute("data-scripts") ? this : this.parentElement?.closest(selector) ?? null;
      return null;
    }
    dispatchEvent(event: Event) {
      events.push(`${this.parentElement?.id ?? this.id}:${event.type}`);
      emit(event.type, this);
      return true;
    }
  }
  const byId = new Map<string, Element>();
  for (const node of Object.values(doc.nodes)) {
    const el = new Element(node.attrId ?? node.id, node.semantic === "button" ? "BUTTON" : node.semantic === "form" ? "FORM" : "DIV");
    byId.set(node.id, el);
    if (node.scripts) el.setAttribute("data-scripts", JSON.stringify(node.scripts));
    if (node.text) {
      el.setAttribute("data-live", node.text.content);
      el.firstChild = { nodeType: 3, nodeValue: "" };
    }
    if (node.field) {
      const input = new Element("", "INPUT");
      input.parentElement = el;
      el.input = input;
      input.type = node.field.kind === "radio" ? "radio" : "text";
      input.name = node.field.group ?? "";
      input.value = node.field.kind === "radio" ? node.field.label ?? "" : "";
      input.checked = !!node.field.checked;
      if (node.field.defaultValue) input.setAttribute("data-live-value", node.field.defaultValue);
      if (node.field.placeholder) input.setAttribute("data-live-placeholder", node.field.placeholder);
    }
  }
  for (const node of Object.values(doc.nodes)) for (const child of node.children ?? []) byId.get(child)!.parentElement = byId.get(node.id)!;
  function query(selector: string) {
    if (selector.startsWith("#")) return elements.filter((el) => el.id === selector.slice(1));
    const named = /^\[name="([^"]+)"\]$/.exec(selector);
    if (named) return elements.filter((el) => el.name === named[1]);
    const group = /^input\[type="radio"\]\[name="([^"]+)"\]$/.exec(selector);
    if (group) return elements.filter((el) => el.type === "radio" && el.name === group[1]);
    const attr = /^\[([^\]]+)\]$/.exec(selector);
    return attr ? elements.filter((el) => el.hasAttribute(attr[1])) : [];
  }
  const root = {
    querySelector: (selector: string) => query(selector)[0] ?? null,
    querySelectorAll: query, contains: () => true,
    addEventListener: (name: string, fn: (event: any) => void) => listeners.set(name, [...listeners.get(name) ?? [], fn]),
    removeEventListener: () => {},
  };
  function emit(type: string, target: Element) {
    for (const fn of listeners.get(type) ?? []) fn({ target, isTrusted: false });
  }
  const dispose = runInNewContext(options.preview ? `(${SCRIPT_RUNTIME})({}).install(document)` : scriptsFile(doc), {
    document: root, CSS: { escape: (value: string) => value }, Event,
    MutationObserver: class { observe() {} disconnect() {} },
    setTimeout, clearTimeout,
  });
  return {
    click: (id: string) => emit("click", byId.get(id)!),
    input: (id: string) => byId.get(id)!.input!,
    text: (id: string) => byId.get(id)!.firstChild!.nodeValue,
    select(id: string) { const input = byId.get(id)!.input!; input.checked = true; emit("input", input); },
    events, dispose,
  };
}

function assertCleared(h: ReturnType<typeof harness>) {
  assert.equal(h.input("small").checked, false);
  assert.equal(h.input("medium").checked, false);
  assert.equal(h.input("red").checked, true);
  assert.equal(h.text("result"), "size=; small=false; medium=false; index=; color=red");
  assert.equal(h.input("dependent").value, "Selected: ");
  assert.equal(h.input("dependent").placeholder, "Index: ");
}

for (const preview of [false, true]) {
  for (const button of ["clear-item-0", "clear-item-1", "clear-item-2", "clear-item-3", "clear-item-4", "clear-group", "unknown-group"]) {
    test(`${preview ? "full" : "published"} runtime refreshes live bindings for ${button} without firing change scripts`, () => {
      const h = harness({ preview });
      assert.equal(h.text("result"), "size=S; small=true; medium=false; index=1; color=red");
      h.click(button);
      assertCleared(h);
      assert.equal(h.text("counts"), "||");
      assert.deepEqual(h.events, [], "a deselected radio must not fire input/change");
      h.click(button);
      assertCleared(h);
      assert.deepEqual(h.events, [], "clearing again must remain a no-op");
      h.dispose();
    });
  }
}

test("toggling a named radio group changes each control once and preserves unrelated controls", () => {
  for (const preview of [false, true]) {
    const h = harness({ preview });
    h.input("medium").disabled = true;
    h.click("toggle-sizes");
    assert.equal(h.input("small").disabled, true);
    assert.equal(h.input("medium").disabled, false);
    assert.equal(h.input("red").disabled, false);
    h.click("toggle-sizes");
    assert.equal(h.input("small").disabled, false);
    assert.equal(h.input("medium").disabled, true);
    assert.deepEqual(h.events, []);
    h.dispose();
  }
});

test("changing the selection fires only the newly selected radio, in either DOM order", () => {
  const h = harness();
  h.click("select-medium");
  assert.equal(h.text("result"), "size=M; small=false; medium=true; index=2; color=red");
  assert.equal(h.text("counts"), "|1|");
  h.click("select-medium");
  assert.equal(h.text("counts"), "|1|");
  h.click("select-small");
  assert.equal(h.text("result"), "size=S; small=true; medium=false; index=1; color=red");
  assert.equal(h.text("counts"), "1|1|");
  assert.deepEqual(h.events, ["medium:input", "medium:change", "small:input", "small:change"]);
  h.click("clear-group");
  assertCleared(h);
  assert.equal(h.text("counts"), "1|1|");
  h.dispose();
});

test("a change script can clear its own radio without recursion or stale bindings", () => {
  const h = harness({ clearOnChange: true });
  h.click("select-medium");
  h.click("select-small");
  assertCleared(h);
  assert.equal(h.text("counts"), "1|1|");
  assert.deepEqual(h.events, ["medium:input", "medium:change", "small:input", "small:change"]);
  h.dispose();
});

test("normal user selection still refreshes bindings and runs exactly one change script", () => {
  const h = harness();
  h.click("clear-group");
  h.select("medium");
  assert.equal(h.text("result"), "size=M; small=false; medium=true; index=2; color=red");
  assert.equal(h.text("counts"), "|1|");
  h.click("clear-item-0");
  assert.equal(h.input("medium").checked, true, "clearing an unselected item does not clear the group");
  assert.equal(h.text("counts"), "|1|");
  h.dispose();
});

test("the pruned runtime also clears radios when no live bindings are present", () => {
  const h = harness({ live: false });
  h.click("clear-group");
  assert.equal(h.input("small").checked, false);
  assert.deepEqual(h.events, []);
  h.dispose();
});


test("a set-only bundle works without live fields or change handlers", () => {
  const h = harness({ live: false, configure(doc) {
    for (const node of Object.values(doc.nodes)) if (node.field?.kind === "radio") delete node.scripts;
  } });
  h.click("clear-group");
  assert.equal(h.input("small").checked, false);
  h.click("select-medium");
  assert.equal(h.input("medium").checked, true);
  h.click("unknown-group");
  assert.equal(h.input("medium").checked, false);
  assert.deepEqual(h.events, ["medium:input", "medium:change"]);
  h.dispose();
});

test("conditions after clearing read the new individual, group and index values", () => {
  const h = harness({ configure(doc) {
    doc.nodes["clear-group"].scripts![0].steps.push({
      id: "read-item", kind: "if", cond: { subject: "value", target: "small", op: "eq", value: "false" }, then: [{
        id: "read-group", kind: "if", cond: { subject: "var", target: "", left: "{size}|{small}|{size.index}", op: "eq", value: "|false|" }, then: [{
          id: "confirmed", kind: "set-var", into: "smallChanges", value: "cleared",
        }],
      }],
    });
  } });
  h.click("clear-group");
  assertCleared(h);
  assert.equal(h.text("counts"), "cleared||");
  assert.deepEqual(h.events, []);
  h.dispose();
});

test("bare radio IDs address individual controls and group operations stay in their owning form", () => {
  const h = harness();
  for (const key of ["small", "medium"]) {
    const input = h.input(key);
    input.parentElement!.id = "";
    input.id = key;
  }
  const other = h.input("red");
  other.parentElement!.tagName = "FORM";
  other.name = "size";
  h.click("select-medium");
  assert.equal(h.text("result"), "size=M; small=false; medium=true; index=2; color=");
  h.click("clear-group");
  assert.equal(h.text("result"), "size=; small=false; medium=false; index=; color=");
  assert.equal(other.checked, true);
  h.dispose();
});

test("an imported text input uses its name only while it has no ID", () => {
  const h = harness({ configure(doc) {
    doc.nodes.dependent.field = { kind: "input" };
    doc.nodes["select-medium"].scripts![0].steps = [
      { id: "write", kind: "set-value", target: "customer", value: "One" },
      { id: "read", kind: "set-var", into: "smallChanges", value: "{customer}" },
    ];
  } });
  const input = h.input("dependent");
  input.name = "customer";
  h.click("select-medium");
  assert.equal(input.value, "One");
  assert.equal(h.text("counts"), "One||");
  input.id = "contact";
  input.value = "Two";
  h.click("select-medium");
  assert.equal(input.value, "Two");
  assert.equal(h.text("counts"), "||");
  h.dispose();
});
});

describe("search-form-navigation", () => {
const require = createRequire(import.meta.url);
function evaluate(source: string, overrides: Record<string, unknown> = {}) {
  const mod = { exports: {} as any };
  const code = transformSync(source, { loader: "tsx", jsx: "automatic", format: "cjs" }).code;
  new Function("require", "module", "exports", code)(
    (id: string) => id in overrides ? overrides[id] : require(id), mod, mod.exports
  );
  return mod.exports;
}

// 型・キー・位置が同じフォームは使い回される。入力の現在値と ref を、描画の間で保つ。
function mount() {
  const ref = { current: null as any };
  let effect: (() => void) | undefined;
  let previousDeps: unknown[] | undefined;
  let element: any;
  const window = { location: { pathname: "/search", search: "" }, addEventListener() {}, removeEventListener() {} };
  const hooks = {
    ...React,
    useRef: () => ref,
    useEffect(fn: typeof effect, deps: unknown[]) {
      if (!previousDeps || deps.some((value, index) => value !== previousDeps![index])) {
        effect = fn;
        previousDeps = deps;
      }
    },
  };
  const field = { name: "q", type: "text", value: "", defaultValue: "default" };
  const textarea = { name: "note", type: "textarea", value: "", defaultValue: "initial note" };
  const checkbox = { name: "stock", type: "checkbox", value: "true", checked: true, defaultChecked: true };
  const radios = ["S", "M"].map((value) => ({ name: "size", type: "radio", value, checked: value === "M", defaultChecked: value === "M" }));
  class Select {
    name = "sort";
    options = ["A", "B", "C"].map((value) => ({ value, defaultSelected: value === "B", selected: value === "B" }));
  }
  const select = new Select();
  // 実際の DOM と同じく、選択の状態は1つだけにする。
  for (const option of select.options) {
    let selected = option.selected;
    Object.defineProperty(option, "selected", {
      get: () => selected,
      set: (value) => { selected = value; if (value) for (const other of select.options) if (other !== option) other.selected = false; },
    });
  }
  const events: Event[] = [];
  const form = { elements: [field, textarea, checkbox, ...radios, select], dispatchEvent: (event: Event) => events.push(event) };
  const replacements: string[] = [];
  class FormData {
    constructor(private form: typeof form) {}
    *entries() {
      for (const input of this.form.elements) {
        if (input instanceof Select) yield [input.name, input.options.find((o) => o.selected)?.value ?? ""];
        else if (!("checked" in input) || input.checked) yield [input.name, input.value];
      }
    }
  }
  const source = SEARCH_FORM_COMPONENT.replace('"use client";', '"use client";\nconst { window, HTMLSelectElement, FormData } = require("test-dom");');
  const Component = evaluate(source, {
    react: hooks,
    "next/navigation": {
      useRouter: () => ({ replace: (url: string) => replacements.push(url) }),
      usePathname: () => window.location.pathname,
      useSearchParams: () => new URLSearchParams(window.location.search),
    },
    "test-dom": { window, HTMLSelectElement: Select, FormData },
  }).default;
  function render(search: string, pathname = "/search") {
    effect = undefined;
    window.location = { search, pathname };
    element = Component({ children: React.createElement("input", { name: "q" }) });
    element.props.ref.current = form;
    const visit = (node: any) => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) return node.forEach(visit);
      if (typeof node.type === "function") visit(node.type(node.props));
      else visit(node.props?.children);
    };
    visit(element.props.children);
    effect?.();
  }
  return { render, field, textarea, checkbox, radios, select, events, replacements,
    submit: () => element.props.onSubmit({ preventDefault() {}, currentTarget: form }),
  };
}

test("generated search results reuse the same SearchForm on query navigation", async () => {
  const files = searchFormFiles();
  const Form = () => null;
  const Page = evaluate(files["app/search/page.tsx"], {
    "@/components/SearchForm": Form,
    "next/link": () => null,
    "@/lib/vars": require("../lib/vars"),
    "@/lib/safe-fetch": {
      fetchPublic: async (url: string) => new Response(JSON.stringify({ q: new URL(url).searchParams.get("q") })),
      readTextLimited: (response: Response) => response.text(),
    },
  }).default;
  const first = await Page({ searchParams: Promise.resolve({ q: "first" }) });
  const next = await Page({ searchParams: Promise.resolve({ q: "next" }) });
  assert.equal(first.props.children[2].props.children, "API: first");
  assert.equal(next.props.children[2].props.children, "API: next");
  assert.equal(first.props.children[1].type, Form);
  assert.equal(next.props.children[1].type, Form);
  assert.equal(first.props.children[1].key, next.props.children[1].key);
});

test("search fields follow query links repeatedly without a popstate event", () => {
  const mounted = mount();
  for (const q of ["first", "next", "日本語 & +", "first"]) {
    mounted.render(`?q=${encodeURIComponent(q)}`);
    assert.equal(mounted.field.value, q);
  }
});

test("Back/Forward restores all field types and retains unrelated query parameters", () => {
  const mounted = mount();
  const first = "?tab=products&q=first&note=one&stock=true&size=S&sort=C";
  const second = "?tab=products&q=second&note=two&size=M&sort=A";
  for (const search of [first, second, first, second]) {
    mounted.render(search);
    const params = new URLSearchParams(search);
    assert.equal(mounted.field.value, params.get("q"));
    assert.equal(mounted.textarea.value, params.get("note"));
    assert.equal(mounted.checkbox.checked, params.has("stock"));
    assert.equal(mounted.radios.find((r) => r.checked)?.value, params.get("size"));
    assert.equal(mounted.select.options.find((o) => o.selected)?.value, params.get("sort"));
  }
  mounted.field.value = "日本語 & +";
  mounted.submit();
  const submitted = new URLSearchParams(mounted.replacements.at(-1));
  assert.equal(submitted.get("tab"), "products");
  assert.equal(submitted.get("q"), "日本語 & +");
  assert.equal(submitted.get("note"), "two");
  assert.equal(submitted.get("size"), "M");
  assert.equal(submitted.get("sort"), "A");
  assert.equal(submitted.has("stock"), false);
});

test("same-query renders and submissions do not erase in-progress edits", () => {
  const mounted = mount();
  const query = "?q=first&note=initial+note&stock=true&size=M&sort=B";
  mounted.render(query);
  mounted.submit();
  assert.equal(mounted.replacements[0], query);
  mounted.field.value = "still typing";
  mounted.render(query);
  assert.equal(mounted.field.value, "still typing");
  assert.equal(mounted.events.length, 1);
});

test("URL changes without a field value restore the current form defaults", () => {
  const mounted = mount();
  mounted.render("?q=first&note=typed&size=S&sort=C");
  mounted.field.defaultValue = "changed default";
  mounted.textarea.defaultValue = "changed note";
  mounted.render("?tab=other");
  assert.equal(mounted.field.value, "changed default");
  assert.equal(mounted.textarea.value, "changed note");
  assert.equal(mounted.checkbox.checked, true);
  assert.equal(mounted.radios.find((r) => r.checked)?.value, "M");
  assert.equal(mounted.select.options.find((o) => o.selected)?.value, "B");
});


test("changing paths with the same query restores the destination form", () => {
  const mounted = mount();
  mounted.render("?q=first", "/search");
  mounted.field.value = "unfinished edit";
  mounted.render("?q=first", "/other-search");
  assert.equal(mounted.field.value, "first");
});
});

describe("search-form-values", () => {
describe("search-form-values", () => {
  const require = createRequire(import.meta.url);
  function mount(source: string) {
    const ref = { current: null as any };
    let effect: (() => void) | undefined;
    let element: any;
    const navigations: string[] = [];
    const window = {
      location: { pathname: "/search", search: "", hash: "", assign: (url: string) => navigations.push(url) },
      addEventListener() {}, removeEventListener() {},
    };
    const field = { name: "q", type: "text", value: "seed", defaultValue: "seed" };
    const checkboxes = ["a", "b", "on"].map((value) => ({ name: "tag", type: "checkbox", value, checked: value === "a", defaultChecked: value === "a" }));
    const radios = ["S", "M"].map((value) => ({ name: "size", type: "radio", value, checked: value === "M", defaultChecked: value === "M" }));
    class Select {
      name = "color";
      multiple = true;
      options = ["red", "green", "blue"].map((value) => ({ value, defaultSelected: value === "red", selected: value === "red" }));
    }
    const select = new Select();
    const upload = { name: "upload", type: "file", get value() { return ""; }, set value(_: string) { throw new Error("File input must not be restored"); } };
    const form = { elements: [field, ...checkboxes, ...radios, select, upload], dispatchEvent() {} };
    class FormData {
      constructor(private form: typeof form) {}
      *entries() {
        for (const input of this.form.elements) {
          if (input instanceof Select) {
            for (const option of input.options) if (option.selected) yield [input.name, option.value];
          } else if (input.type === "file") yield [input.name, new File(["fixture"], "fixture.txt")];
          else if (!("checked" in input) || input.checked) yield [input.name, input.value];
        }
      }
    }
    const overrides: Record<string, unknown> = {
      react: { ...React, useRef: () => ref, useEffect: (fn: typeof effect) => { effect = fn; } },
      "next/navigation": {
        useRouter: () => ({ replace: (url: string) => navigations.push(url) }),
        usePathname: () => window.location.pathname,
        useSearchParams: () => new URLSearchParams(window.location.search),
      },
    };
    const mod = { exports: {} as any };
    const code = transformSync(source, { loader: "tsx", jsx: "automatic", format: "cjs" }).code;
    new Function("require", "module", "exports", "window", "HTMLSelectElement", "FormData", code)(
      (id: string) => overrides[id] ?? require(id), mod, mod.exports, window, Select, FormData
    );
    function render(search: string) {
      window.location.search = search;
      element = mod.exports.default({});
      element.props.ref.current = form;
      const visit = (node: any) => {
        if (!node || typeof node !== "object") return;
        if (Array.isArray(node)) return node.forEach(visit);
        if (typeof node.type === "function") visit(node.type(node.props));
        else visit(node.props?.children);
      };
      visit(element.props.children);
      effect?.();
    }
    return { render, field, checkboxes, radios, select,
      selected: () => select.options.filter((option) => option.selected).map((option) => option.value),
      checked: () => checkboxes.filter((input) => input.checked).map((input) => input.value),
      submit: () => {
        element.props.onSubmit({ preventDefault() {}, currentTarget: form });
        return new URL(navigations.at(-1)!, "https://example.test/search").searchParams;
      },
    };
  }

  for (const [format, source] of [["Next.js", SEARCH_FORM_COMPONENT], ["React", REACT_SEARCH_FORM]]) {
    test(`${format} preserves empty fields and repeated checkbox/select values on submission`, () => {
      const view = mount(source);
      view.render("?tab=products&tab=offers&q=old&tag=old&color=old&upload=old");
      view.field.value = "";
      view.checkboxes.forEach((input) => { input.checked = input.value !== "on"; });
      view.select.options.forEach((option) => { option.selected = option.value !== "green"; });
      const params = view.submit();
      assert.deepEqual(params.getAll("tab"), ["products", "offers"]);
      assert.deepEqual(params.getAll("tag"), ["a", "b"]);
      assert.deepEqual(params.getAll("color"), ["red", "blue"]);
      assert.equal(params.get("q"), "");
      assert.equal(params.has("upload"), false);
      view.render("?" + params);
      assert.equal(view.field.value, "");
      assert.deepEqual(view.checked(), ["a", "b"]);
      assert.deepEqual(view.selected(), ["red", "blue"]);
    });

    test(`${format} restores repeated choices exactly and clears stale selections`, () => {
      const view = mount(source);
      for (const [query, checked, selected] of [
        ["?q=&tag=a&tag=b&color=red&color=blue", ["a", "b"], ["red", "blue"]],
        ["?q=&tag=on&color=green", ["on"], ["green"]],
        ["?q=&tag=b&color=blue", ["b"], ["blue"]],
        ["?q=&color=missing", [], []],
        ["?tab=products", ["a"], ["red"]],
      ] as const) {
        view.render(query);
        assert.deepEqual(view.checked(), checked);
        assert.deepEqual(view.selected(), selected);
      }
      assert.equal(view.field.value, "seed");
    });
  }
});

describe("search-form-radio-values", () => {
  const require = createRequire(import.meta.url);
  for (const [framework, source] of [["nextjs", SEARCH_FORM_COMPONENT], ["react", REACT_SEARCH_FORM]]) {
    for (const selected of ["on", "off", "missing"]) {
      test(`${framework} restores only the radio matching query value ${selected}`, () => {
        const radios = ["on", "off"].map(value => ({ name: "mode", type: "radio", value, checked: false, defaultChecked: false }));
        for (const radio of radios) {
          let checked = false;
          Object.defineProperty(radio, "checked", { get: () => checked, set(value) { checked = value; if (value) for (const other of radios) if (other !== radio) other.checked = false; } });
        }
        const form = { elements: radios, dispatchEvent() {} };
        const ref = { current: form };
        const effects: (() => void)[] = [];
        const hooks = { ...React, useRef: () => ref, useEffect: (fn: () => void) => effects.push(fn) };
        const window = { location: { pathname: "/", search: `?mode=${selected}` }, addEventListener() {}, removeEventListener() {} };
        const module = { exports: {} as any };
        const compiled = transformSync(source, { loader: "tsx", jsx: "automatic", format: "cjs" }).code;
        new Function("require", "module", "exports", "window", "HTMLSelectElement", compiled)(
          (id: string) => id === "react" ? hooks : id === "next/navigation" ? {
            usePathname: () => "/", useSearchParams: () => new URLSearchParams(window.location.search), useRouter: () => ({}),
          } : require(id), module, module.exports, window, class Select {},
        );
        const node = module.exports.default({ children: null });
        const visit = (item: any): void => {
          if (!item) return;
          if (Array.isArray(item)) return item.forEach(visit);
          if (typeof item.type === "function") visit(item.type(item.props));
          else visit(item.props?.children);
        };
        visit(node);
        for (const effect of effects) effect();
        assert.deepEqual(radios.filter(radio => radio.checked).map(radio => radio.value), selected === "missing" ? [] : [selected]);
      });
    }
  }
});
});
