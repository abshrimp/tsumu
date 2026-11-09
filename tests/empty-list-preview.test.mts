import { stripMarkup } from "./helpers/strip-markup";
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { transformSync } from "esbuild";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { pagePlan, previewDataVars } from "../lib/data";
import { useEditor } from "../lib/store";
import { emptyListBundle, emptyListDoc, publishedEmptyList } from "./helpers/empty-list-preview";

const state = () => useEditor.getState();
function nodes(tree: any): any[] {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}
function load(filename: string, hooks = false) {
  const require = createRequire(resolve(filename)), mod = { exports: {} as any };
  const code = transformSync(readFileSync(filename, "utf8"), { loader: "tsx", jsx: "automatic", format: "cjs" }).code;
  new Function("require", "module", "exports", code)((id: string) =>
    id.endsWith("/lib/store") ? { ...require(id), useEditor: (select: any) => select(state()) } :
    id === "react" && hooks ? { ...React, useState: () => [false, () => {}] } : require(id), mod, mod.exports);
  return mod.exports;
}
const plain = stripMarkup;
function fixture(sample: readonly unknown[]) {
  const doc = emptyListDoc(sample);
  state().replaceDoc(doc); state().setActivePage("p"); state().select("tag");
  const { default: SettingsPanel } = load("components/SettingsPanel.tsx", true);
  const panel = () => SettingsPanel({ nodeId: state().selection });
  nodes(panel()).find(n => n.type === "button" && Array.isArray(n.props.children) && n.props.children.includes("リスト表示にする"))!.props.onClick();
  const row = nodes(panel()).find(n => n.props?.className === "row" && nodes(n).some(x => x.type === "label" && x.props.children === "表示するリスト"));
  const dropdown = nodes(row).find(n => n.props?.options && n.props?.placeholder === "選択してください").props;
  assert.ok(dropdown.options.some((o: any) => o.value === "tags"));
  dropdown.onChange("tags");
  const { NodeView } = load("components/canvas/NodeView.tsx");
  const require = createRequire(resolve("components/canvas/NodeView.tsx"));
  const { VarsCtx } = require("./render");
  const render = (preview = true) => {
    const plan = pagePlan(state().doc, "p");
    return renderToStaticMarkup(React.createElement(VarsCtx.Provider, { value: {
      pageVars: previewDataVars(state().doc, "p"), preview, fieldValues: {},
      clientVars: plan.clientVars, listOps: plan.listOps, setFieldValue() {}, refresh() {}, navigate() {},
    } }, React.createElement(NodeView, { id: "products", isTop: true })));
  };
  return { render };
}
for (const [name, sample, expected] of [
  ["first row empty", [{ name: "First", tags: [] }, { name: "Second", tags: ["green"] }], "FirstSecondTag: green"],
  ["later row empty", [{ name: "First", tags: ["red"] }, { name: "Second", tags: [] }], "FirstTag: redSecond"],
  ["all rows empty", [{ name: "First", tags: [] }, { name: "Second", tags: [] }], "FirstSecond"],
  ["later row missing source", [{ name: "First", tags: ["red"] }, { name: "Second" }], "FirstTag: redSecond"],
] as const) test(`preview omits empty nested rows after settings selects their source: ${name}`, async () => {
  const f = fixture(structuredClone(sample));
  const saved = structuredClone(state().doc), past = state().past.length;
  assert.equal(plain(f.render()), expected);
  assert.doesNotMatch(f.render(), /cv-placeholder/);
  assert.equal(plain(await publishedEmptyList(state().doc, structuredClone(sample))), expected + "Unchanged");
  state().undo(); state().redo();
  assert.deepEqual(state().doc, saved); assert.equal(state().past.length, past);
  assert.equal(plain(f.render()), expected);
  state().replaceDoc(JSON.parse(JSON.stringify(saved)));
  assert.equal(plain(f.render()), expected);
});
test("design retains empty-list guidance and templates without saving a preview change", () => {
  const f = fixture([{ name: "First", tags: [] }, { name: "Second", tags: [] }]);
  const before = structuredClone({ doc: state().doc, past: state().past });
  assert.match(f.render(false), /cv-placeholder/);
  assert.match(plain(f.render(false)), /Tag: /);
  assert.equal(plain(f.render(true)), "FirstSecond");
  assert.deepEqual({ doc: state().doc, past: state().past }, before);
});

test("an empty outer array adds no preview row and recovers when data returns", async () => {
  const sample = [{ name: "First", tags: ["red"] }, { name: "Second", tags: [] }];
  const f = fixture(sample), saved = structuredClone(state().doc);
  state().updateDoc((doc) => { (doc.pages.p.pageScripts![0].steps[0] as any).preview.sample = []; });
  assert.equal(plain(f.render()), "");
  assert.doesNotMatch(f.render(), /cv-placeholder/);
  assert.match(f.render(false), /cv-placeholder/);
  assert.equal(plain(await publishedEmptyList(state().doc, [])), "Unchanged");
  state().undo(); assert.deepEqual(state().doc, saved);
  assert.equal(plain(f.render()), "FirstTag: redSecond");
});
test("native regression bundles the actual settings panel and production list renderers", async () => {
  const bundle = await emptyListBundle([{ name: "First", tags: [] }, { name: "Second", tags: [] }]);
  assert.match(bundle, /function SettingsPanel/);
  assert.match(bundle, /function NodeView/);
  assert.match(bundle, /function GhostView/);
});
