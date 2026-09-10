import assert from "node:assert/strict";
import { test } from "node:test";
import { canPickVariable, localVariableNames, variableChoiceSamples, singleValueReference } from "../lib/variable-choice";
import { setVarSource } from "../lib/data";
import { scriptDataPickerBundle } from "./helpers/script-data-picker";

for (const v of [undefined, null, false, true, 0, "001", [], ["red"], {}, { title: "Nested" }]) {
  test(`raw value picker retains ${JSON.stringify(v)}`, () => assert.equal(canPickVariable(v, "value"), true));
}
test("text keeps boolean, primitive arrays and unknowns but not object insertion", () => {
  for (const v of [undefined, null, false, 0, "", [], ["red", false, null]]) assert.equal(canPickVariable(v, "text"), true);
  for (const v of [{}, { name: "A" }, [{ name: "A" }]]) assert.equal(canPickVariable(v, "text"), false);
});
test("numeric choices retain unknowns and numeric text without accepting objects or booleans", () => {
  for (const v of [undefined, null, 0, -2.5, "001", "1,234", " -2 "]) assert.equal(canPickVariable(v, "number"), true);
  for (const v of [false, true, "", "red", {}, [], [1, 2], Infinity, NaN]) assert.equal(canPickVariable(v, "number"), false);
});
test("reference view preserves the exact meaning of entered variable expressions", () => {
  for (const value of ["{data}", " { data.name } ", "Hello {data}", "\\{data}", "001", "false", "", "{a}{b}"]) {
    assert.equal(singleValueReference(value), setVarSource({ id: "s", kind: "set-var", value, into: "out" }));
  }
});
test("real script editor picker fixture compiles for native CI", async () => {
  const bundle = await scriptDataPickerBundle();
  assert.ok(bundle.includes("dataPickerStore"));
});

test("JSON roundtrip preserves typed samples, expressions and generated project", async () => {
  const { scriptDataPickerDoc } = await import("./helpers/script-data-picker");
  const { generateProject } = await import("../lib/generator");
  const doc = scriptDataPickerDoc();
  const before = JSON.stringify(doc);
  const project = generateProject(doc);
  assert.equal(JSON.stringify(doc), before);
  const saved = JSON.parse(before);
  assert.deepEqual(generateProject(saved), project);
  assert.equal(saved.pages.p.pageScripts[0].steps[0].preview.sample.available, false);
  assert.equal(saved.pages.p.pageScripts[0].steps[0].preview.sample.empty, null);
  assert.equal(saved.pages.p.pageScripts[0].steps[0].preview.sample.code, "001");
});


test("local leaf paths expose roots and shadow all page-level dotted samples", () => {
  assert.deepEqual(localVariableNames(["details.id", "details.tags.0", "empty"]), ["details", "details.id", "details.tags", "details.tags.0", "empty"]);
  const samples = variableChoiceSamples([{ vars: { details: { id: "PAGE" }, "details.id": "PAGE-DOTTED", "details.other": "OTHER", keep: false } }], ["details.id"]);
  assert.equal(samples.details, undefined);
  assert.equal(samples["details.id"], undefined);
  assert.equal(Object.hasOwn(samples, "details.other"), false);
  assert.equal(samples.keep, false);
});

test("nearer groups own their entire root even if a leaf is missing", () => {
  assert.deepEqual(variableChoiceSamples([
    { vars: { price: false, details: {} } },
    { vars: { price: 99, details: { id: "PAGE" }, "details.id": "PAGE-DOTTED", keep: 1 } },
  ]), { price: false, details: {}, keep: 1 });
});

test("real raw chip uses node samples and treats loop roots as runtime values", async () => {
  const React = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { Ctx, ScriptNodeCtx, LoopCtx } = await import("../components/script-editor/context");
  const { loadNestedUi } = await import("./helpers/client-nested-lists");
  const { scriptDataPickerDoc } = await import("./helpers/script-data-picker");
  const { makeBox, makeText } = await import("../lib/presets");
  const { previewDataVars, varGroupsAt } = await import("../lib/data");
  const doc = scriptDataPickerDoc();
  (doc.pages.p.pageScripts![0].steps[0] as any).preview.sample.rows = [{ price: false, details: { id: "LOCAL" } }];
  doc.pages.p.pageScripts![0].steps.push({ id: "global-price", kind: "set-var", value: "{data.price}", into: "price" });
  doc.nodes.list = { ...makeBox(), id: "list", type: "list", list: { from: "data.rows" }, children: ["button"] };
  doc.nodes.button = { ...makeText("Button"), id: "button" };
  doc.pages.p.children = ["list"];
  assert.equal(variableChoiceSamples(varGroupsAt(doc, "p", "button")).price, false);
  const { ValueIn } = loadNestedUi("components/script-editor/inputs.tsx");
  const render = (value: string, loops: any[] = []) => renderToStaticMarkup(React.createElement(Ctx.Provider, { value: {
    doc, pageId: "p", samples: previewDataVars(doc, "p"),
  } as any }, React.createElement(ScriptNodeCtx.Provider, { value: "button" }, React.createElement(LoopCtx.Provider, { value: loops }, React.createElement(ValueIn, { value, onCommit() {} })))));
  const nodeChip = render("{price}");
  assert.match(nodeChip, /Value/);
  assert.doesNotMatch(render("Hello {price}"), /se-value-info/, "a mixed template is not labelled as a raw boolean");
  assert.doesNotMatch(render("\\{price}"), /se-value-info/, "an escaped reference remains literal text");
  const loopChip = render("{details}", [{ fields: ["details.id"], samples: { "details.id": "LOCAL" } }]);
  assert.doesNotMatch(loopChip, /実行時|se-value-info|vx-kind/);
  assert.doesNotMatch(loopChip, /LOCAL/);
});


