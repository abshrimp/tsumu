import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { transformSync } from "esbuild";
import * as React from "react";
import { useEditor } from "../lib/store";
import { commitFieldsBundle, commitFieldsDoc, commitPageFieldsBundle } from "./helpers/commit-fields";

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

test("commit-field browser fixtures bundle real controls, page settings and store", async () => {
  assert.match(await commitFieldsBundle(), /function CommitTextarea/);
  assert.match(await commitPageFieldsBundle(), /function PagePanel/);
});
