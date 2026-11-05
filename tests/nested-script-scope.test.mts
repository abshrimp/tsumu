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
import { nestedScopeBundle, nestedScopeDoc, publishedNestedScope } from "./helpers/nested-script-scope";

function render(preview = true) {
  const doc = nestedScopeDoc(); useEditor.getState().replaceDoc(doc);
  const file = resolve("components/canvas/NodeView.tsx"), require = createRequire(file), mod = { exports: {} as any };
  const code = transformSync(readFileSync(file, "utf8"), { loader: "tsx", jsx: "automatic", format: "cjs" }).code;
  new Function("require", "module", "exports", code)((id: string) => id.endsWith("/lib/store")
    ? { ...require(id), useEditor: (select: any) => select(useEditor.getState()) } : require(id), mod, mod.exports);
  const { VarsCtx } = require("./render"), plan = pagePlan(doc, "p");
  return renderToStaticMarkup(React.createElement(VarsCtx.Provider, { value: {
    pageVars: previewDataVars(doc, "p"), preview, fieldValues: {}, clientVars: plan.clientVars, listOps: plan.listOps,
    setFieldValue() {}, refresh() {}, navigate() {},
  } }, React.createElement(mod.exports.NodeView, { id: "products", isTop: true })));
}

test("each inner row has its own script scope, including ghost-rendered outer rows", () => {
  const html = render();
  assert.equal((html.match(/data-item=/g) ?? []).length, 6, "two outer scopes and four inner scopes");
  for (const label of ["red", "blue", "green", "yellow"]) {
    assert.ok(html.includes(`data-item="{&quot;label&quot;:&quot;${label}&quot;}"`), label);
  }
  assert.equal((html.match(/id="detail"/g) ?? []).length, 4);
  assert.equal((html.match(/data-scripts=/g) ?? []).length, 8);
});

test("design retains the same unwrapped editable list contents", () => {
  const html = render(false);
  assert.doesNotMatch(html, /data-item=|data-scripts=/);
  assert.equal((html.match(/id="detail"/g) ?? []).length, 4);
});

test("generated nested scripts already scope every repeated row", async () => {
  const html = await publishedNestedScope();
  assert.equal((html.match(/data-row=/g) ?? []).length, 6);
  for (const label of ["red", "blue", "green", "yellow"]) assert.match(html, new RegExp(`hide ${label}`));
  assert.equal((html.match(/id="detail"/g) ?? []).length, 4);
});

test("native regression bundles the real Canvas and production runtime", async () => {
  const bundle = await nestedScopeBundle();
  assert.match(bundle, /function Canvas/);
  assert.match(bundle, /function GhostView/);
  assert.match(bundle, /function createScriptRuntime/);
});
