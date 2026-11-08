import { stripMarkup } from "./helpers/strip-markup";
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { transformSync } from "esbuild";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { findItemsCandidates, pagePlan, previewDataVars, scopeAt } from "../lib/data";
import { useEditor } from "../lib/store";
import { generateProject } from "../lib/generator";
import { nestedListProducts, nestedListSourcesBundle, nestedListSourcesDoc } from "./helpers/nested-list-sources";

const state = () => useEditor.getState();
function nodes(tree: any): any[] {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}
function load(filename: string, hooks = false) {
  const require = createRequire(resolve(filename));
  const mod = { exports: {} as any };
  const code = transformSync(readFileSync(filename, "utf8"), { loader: "tsx", jsx: "automatic", format: "cjs" }).code;
  new Function("require", "module", "exports", code)((id: string) =>
    id.endsWith("/lib/store") ? { ...require(id), useEditor: (select: any) => select(state()) } :
    id === "react" && hooks ? { ...React, useState: () => [false, () => {}] } : require(id), mod, mod.exports);
  return mod.exports;
}
function fixture() {
  state().replaceDoc(nestedListSourcesDoc()); state().setActivePage("p"); state().select("tag");
  const { default: SettingsPanel } = load("components/SettingsPanel.tsx", true);
  const render = () => SettingsPanel({ nodeId: state().selection });
  nodes(render()).find(n => n.type === "button" && Array.isArray(n.props.children) && n.props.children.includes("リスト表示にする"))!.props.onClick();
  const id = state().selection!;
  const dropdown = () => {
    const row = nodes(render()).find(n => n.props?.className === "row" && nodes(n).some(x => x.type === "label" && x.props.children === "表示するリスト"));
    return nodes(row).find(n => n.props?.options && n.props?.placeholder === "選択してください").props;
  };
  const { NodeView } = load("components/canvas/NodeView.tsx");
  const require = createRequire(resolve("components/canvas/NodeView.tsx"));
  const { VarsCtx } = require("./render");
  const preview = () => {
    const plan = pagePlan(state().doc, "p");
    const html = renderToStaticMarkup(React.createElement(VarsCtx.Provider, { value: {
      pageVars: previewDataVars(state().doc, "p"), preview: true, fieldValues: {},
      clientVars: plan.clientVars, listOps: plan.listOps, setFieldValue() {}, refresh() {}, navigate() {},
    } }, React.createElement(NodeView, { id: "products", isTop: true })));
    return stripMarkup(html);
  };
  return { id, dropdown, preview };
}

test("nested source candidates include renderable primitive arrays and empty arrays", () => {
  const input = { strings: ["red", "blue"], numbers: [0, 2], flags: [false, true], records: [{ name: "A" }],
    empty: [], mixed: [null, "x", false, 3], nulls: [null], arrays: [["nested"]], text: "plain", object: { tags: ["deep"] } };
  const before = structuredClone(input);
  assert.deepEqual(findItemsCandidates(input), [
    { path: "strings", count: 2 }, { path: "numbers", count: 2 }, { path: "flags", count: 2 },
    { path: "records", count: 1 }, { path: "empty", count: 0 }, { path: "mixed", count: 4 },
    { path: "nulls", count: 1 }, { path: "arrays", count: 1 }, { path: "object.tags", count: 1 },
  ]);
  assert.deepEqual(input, before);
  assert.deepEqual(findItemsCandidates({ a: { b: { c: { tags: ["deep"] } } } }), [], "the existing depth bound remains");
});

for (const [from, expected] of [
  ["tags", "First productredblueSecond productgreen"],
  ["scores", "First product03Second product2"],
  ["flags", "First productfalsetrueSecond producttrue"],
  ["info.tags", "First productdeepSecond productother"],
  ["empty", "First productSecond product"],
]) test(`settings can select ${from}, render each outer item, persist and undo/redo without changing other nodes`, () => {
  const f = fixture();
  const options = f.dropdown().options;
  assert.ok(options.some((o: any) => o.value === from), `${from} must be offered by the actual settings panel`);
  assert.ok(options.some((o: any) => o.value === "details"), "object list choices remain");
  const before = structuredClone(state().doc), past = state().past.length;
  f.dropdown().onChange(from);
  assert.equal(state().doc.nodes[f.id].list?.from, from);
  assert.equal(f.preview(), expected);
  assert.equal(state().past.length, past + 1);
  assert.deepEqual(state().doc.nodes.other, before.nodes.other);
  assert.deepEqual(state().doc.nodes.products, before.nodes.products);
  const saved = JSON.parse(JSON.stringify(state().doc));
  state().undo(); assert.deepEqual(state().doc, before);
  state().redo(); assert.equal(f.preview(), expected);
  state().replaceDoc(saved); assert.equal(f.preview(), expected);
});

test("outer item paths remain distinct from page arrays and changing the source is one undo step", () => {
  const f = fixture();
  f.dropdown().onChange("tags");
  const before = structuredClone(state().doc);
  const scope = scopeAt(before, "p", f.id, { inside: false });
  assert.deepEqual(scope.item?.tags, ["red", "blue"]);
  f.dropdown().onChange("scores"); assert.equal(f.preview(), "First product03Second product2");
  state().undo(); assert.deepEqual(state().doc, before); assert.equal(f.preview(), "First productredblueSecond productgreen");
});

test("the actual settings and NodeView fixture bundles for Chromium", async () => {
  assert.match(await nestedListSourcesBundle(), /nestedListStore/);
});

async function publishedText() {
  const { files } = generateProject(state().doc);
  const require = createRequire(import.meta.url);
  const cache = new Map<string, any>();
  const load = (file: string): any => {
    if (cache.has(file)) return cache.get(file);
    const mod = { exports: {} as any };
    const code = transformSync(files[file], { loader: "tsx", jsx: "automatic", format: "cjs" }).code;
    new Function("require", "module", "exports", code)((id: string) => {
      if (id === "@/lib/safe-fetch") return {
        fetchPublic: async () => Response.json(nestedListProducts), readTextLimited: (res: Response) => res.text(),
      };
      if (id.startsWith("@/lib/")) return load(id.replace("@/", "") + ".ts");
      return require(id);
    }, mod, mod.exports);
    cache.set(file, mod.exports); return mod.exports;
  };
  return stripMarkup(renderToStaticMarkup(await load("app/page.tsx").default()));
}

for (const [from, expected] of [
  ["tags", "First productredblueSecond productgreenUnchanged"],
  ["scores", "First product03Second product2Unchanged"],
  ["flags", "First productfalsetrueSecond producttrueUnchanged"],
  ["empty", "First productSecond productUnchanged"],
]) test(`the saved ${from} binding renders the same items in generated Next.js output`, async () => {
  const f = fixture(); f.dropdown().onChange(from);
  state().replaceDoc(JSON.parse(JSON.stringify(state().doc)));
  assert.equal(await publishedText(), expected);
});
