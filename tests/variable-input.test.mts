import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { transformSync } from "esbuild";
import * as React from "react";
import * as dataHelpers from "../lib/data";
const { scriptInputDoc, varNamesAt, varGroupsAt } = dataHelpers;
import { variableChoiceSamples } from "../lib/variable-choice";
import { scriptDataPickerDoc } from "./helpers/script-data-picker";
import { makeText } from "../lib/presets";
import * as contexts from "../components/script-editor/context";
const { Ctx, ScriptNodeCtx, ScriptStepCtx, LoopCtx } = contexts;
import { isVarListShortcut } from "../lib/vars";

function candidates(doc = scriptDataPickerDoc(), local: string[] = [], valueContext = "value") {
  const require = createRequire(resolve("components/script-editor/inputs.tsx"));
  const mod = { exports: {} as any };
  const hooks = { ...React, useMemo: (fn: any) => fn(),
    // Candidate tests model an activated input (production inputs load this lazily).
    useState: () => [true, () => {}],
    useContext: (ctx: any) =>
    ctx === Ctx ? { doc, pageId: "p" } : ctx === ScriptStepCtx ? "value" : ctx === ScriptNodeCtx ? "" :
    ctx === LoopCtx ? [{ fields: local, samples: {} }] : ctx._currentValue };
  new Function("require", "module", "exports", transformSync(readFileSync("components/script-editor/inputs.tsx", "utf8"), {
    loader: "tsx", jsx: "automatic", format: "cjs",
  }).code)((id: string) => id === "react" ? hooks : require(id), mod, mod.exports);
  const text = mod.exports.TextIn({ value: "", onCommit() {}, vars: true, valueContext });
  return text.type(text.props).props;
}

test("real input excludes its new output from both names and Explorer extras without editing the document", () => {
  const doc = scriptDataPickerDoc(), before = JSON.stringify(doc);
  assert.ok(varNamesAt(doc, "p", "").includes("chosen"));
  const input = candidates(doc);
  assert.ok(!input.names.includes("chosen")); assert.ok(!input.extraNames.includes("chosen"));
  assert.equal(input.sourceStepId, "value");
  assert.equal(JSON.stringify(doc), before);
  assert.ok(!Object.hasOwn(variableChoiceSamples(varGroupsAt(scriptInputDoc(doc, "value"), "p", "")), "chosen"));
});

test("existing variable updates retain a prior producer and its old sample", () => {
  const doc = scriptDataPickerDoc();
  doc.pages.p.pageScripts![0].steps.splice(1, 0, { id: "prior", kind: "set-var", value: "{data.name}", into: "chosen" });
  assert.ok(candidates(doc).names.includes("chosen"));
  assert.equal(variableChoiceSamples(varGroupsAt(scriptInputDoc(doc, "value"), "p", "")).chosen, "Product");
});

test("same-name form and loop bindings remain available to an assignment", () => {
  const doc = scriptDataPickerDoc();
  doc.nodes.field = { ...makeText(""), id: "field", type: "field", attrId: "chosen", field: { kind: "input" } };
  doc.pages.p.children = ["field"];
  assert.ok(candidates(doc).names.includes("chosen"));
  assert.ok(candidates(scriptDataPickerDoc(), ["chosen.detail"]).names.includes("chosen"));
  assert.ok(candidates(scriptDataPickerDoc(), ["chosen.detail"]).names.includes("chosen.detail"));
});

test("nested current producers are removed without losing enclosing or other branch bindings", () => {
  const doc = scriptDataPickerDoc();
  const step = doc.pages.p.pageScripts![0].steps.splice(1, 1)[0];
  doc.pages.p.pageScripts![0].steps.push({ id: "loop", kind: "repeat", times: 2, then: [
    { id: "prior", kind: "set-var", value: "{data.name}", into: "chosen" }, step,
  ] });
  const candidate = scriptInputDoc(doc, "value");
  assert.ok(varNamesAt(candidate, "p", "").includes("chosen"));
  assert.equal(JSON.stringify(candidate).includes('"id":"value"'), false);
  assert.equal(JSON.stringify(doc).includes('"id":"value"'), true);
});

test("unified value candidates retain object roots while text still excludes them", () => {
  assert.ok(candidates().names.includes("data"));
  assert.ok(!candidates(scriptDataPickerDoc(), [], "text").names.includes("data"));
});

function mountInput(eager: boolean) {
  const slots: any[] = []; let cursor = 0;
  const frames: (() => void)[] = [];
  const hooks = { ...React, useEffect() {}, useRef(initial: any) { return slots[cursor++] ??= { current: initial }; },
    useState(initial: any) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial;
      return [slots[i], (next: any) => { slots[i] = typeof next === "function" ? next(slots[i]) : next; }]; } };
  const require = createRequire(resolve("components/controls.tsx")); const mod = { exports: {} as any };
  new Function("require", "module", "exports", "window", "requestAnimationFrame", transformSync(readFileSync("components/controls.tsx", "utf8"), {
    loader: "tsx", jsx: "automatic", format: "cjs",
  }).code)((id: string) => id === "react" ? hooks : require(id), mod, mod.exports, { innerWidth: 1000, innerHeight: 800 }, (fn: any) => frames.push(fn));
  const el = { value: "", selectionStart: 0, selectionEnd: 0, focus() {}, setSelectionRange() {}, getBoundingClientRect: () => ({ left: 0, top: 0, bottom: 20, width: 150 }) };
  const render = () => { cursor = 0; return mod.exports.VarInput({ value: "", onCommit() {}, names: ["alpha", "beta"], nodeId: "", eager, valueContext: "value" }).props.children; };
  const input = () => { const props = render()[0].props; props.ref.current = el; return props; };
  const press = (key: string, extra = {}) => input().onKeyDown({ key, ctrlKey: true, metaKey: false, altKey: false,
    preventDefault() {}, nativeEvent: {}, ...extra });
  return { input, press, render, el, flushFrames: () => { while (frames.length) frames.shift()!(); }, menu: () => render().find((v: any) => v?.type?.name === "VarSuggestMenu"),
    explorer: () => render().find((v: any) => v?.type?.name === "VarExplorer") };
}

test("eager focus opens suggestions; Cmd+/ opens a distinct unfiltered explorer instead of reopening the same list", () => {
  const h = mountInput(true); h.input().onFocus(); assert.ok(h.menu());
  assert.equal(h.menu().props.exploreShortcut, true);
  h.press("/", { ctrlKey: false, metaKey: true }); assert.ok(h.explorer()); assert.equal(h.menu(), undefined);
});

test("non-eager Cmd+/ and eager Ctrl+Space keep inline completion and IME opens neither", () => {
  for (const [eager, key] of [[false, "/"], [true, " "]] as const) {
    const h = mountInput(eager); h.press(key); assert.ok(h.menu()); assert.equal(h.explorer(), undefined);
  }
  const h = mountInput(true); h.press("/", { nativeEvent: { isComposing: true, keyCode: 229 } });
  assert.equal(h.menu(), undefined); assert.equal(h.explorer(), undefined);
  for (const key of ["/", " "]) assert.equal(isVarListShortcut({ key, ctrlKey: true, metaKey: false, altKey: false }), true);
});

test("exploring a whole raw reference replaces it, while selecting text replaces only the selection", () => {
  const h = mountInput(true); h.el.value = "{alpha}"; h.el.selectionStart = h.el.selectionEnd = 7;
  h.press("/"); h.explorer().props.onPick("beta"); assert.equal(h.el.value, "{beta}");
  const mixed = mountInput(true); mixed.el.value = "Hello alpha!"; mixed.el.selectionStart = 6; mixed.el.selectionEnd = 11;
  mixed.press("/"); mixed.explorer().props.onPick("beta"); assert.equal(mixed.el.value, "Hello {beta}!");
});


test("inline suggestions replace a whole raw reference instead of appending another reference", () => {
  const h = mountInput(true); h.el.value = "{alpha}"; h.el.selectionStart = h.el.selectionEnd = 7;
  h.input().onFocus(); h.menu().props.onPick("beta"); assert.equal(h.el.value, "{beta}");
  const mixed = mountInput(true); mixed.el.value = "Hello alpha!"; mixed.el.selectionStart = 6; mixed.el.selectionEnd = 11;
  mixed.input().onFocus(); mixed.menu().props.onPick("beta"); assert.equal(mixed.el.value, "Hello {beta}!");
});

test("selecting only the name inside a raw reference still replaces the whole reference", () => {
  for (const explorer of [false, true]) {
    const h = mountInput(true); h.el.value = "{alpha}"; h.el.selectionStart = 1; h.el.selectionEnd = 6;
    if (explorer) { h.press("/"); h.explorer().props.onPick("beta"); }
    else { h.input().onFocus(); h.menu().props.onPick("beta"); }
    assert.equal(h.el.value, "{beta}");
  }
});


test("focus cannot reopen stale suggestions after filling a complete value or blurring", () => {
  for (const value of ["{alpha}", "literal", "\\{alpha}"]) {
    const h = mountInput(true); h.input().onFocus();
    h.el.value = value; h.el.selectionStart = h.el.selectionEnd = value.length;
    h.input().onInput({ nativeEvent: {} }); h.flushFrames();
    assert.equal(h.menu(), undefined);
    h.press("Tab", { ctrlKey: false }); assert.equal(h.el.value, value);
  }
  const h = mountInput(true); h.input().onFocus();
  h.input().onBlur({ target: h.el }); h.flushFrames(); assert.equal(h.menu(), undefined);
});

test("inline value choices include nested arrays and objects without leaking shadowed roots", () => {
  const input = candidates();
  for (const name of ["data.tags", "data.detail", "data.detail.title", "data.rows"]) assert.ok(input.names.includes(name), name);
  const local = candidates(scriptDataPickerDoc(), ["data.local"]);
  assert.ok(local.names.includes("data.local"));
  assert.ok(!local.names.includes("data.tags"));
  assert.ok(!local.names.includes("data.detail.title"));
  assert.ok(!candidates(scriptDataPickerDoc(), [], "text").names.includes("data.detail"));
});
