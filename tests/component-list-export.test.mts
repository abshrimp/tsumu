import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { transformSync } from "esbuild";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { useEditor } from "../lib/store";
import { pagePlan, previewDataVars } from "../lib/data";
import { lookupVar, interpolate } from "../lib/vars";
import { generateProject } from "../lib/generator";
import { hasScriptsInside } from "../lib/generator/render-helpers";
import { buildClassNames } from "../lib/generator/names";
import { makeBox, makeText } from "../lib/presets";
import type { SiteDoc } from "../lib/types";
import { componentListBundle, componentListDoc, publishedComponentList } from "./helpers/component-list-export";

const require = createRequire(import.meta.url);
const { parse } = require("next/dist/compiled/node-html-parser");
function loadUi(file: string, direct = false) {
  const path = resolve(file), local = createRequire(path), mod = { exports: {} as any };
  new Function("require", "module", "exports", transformSync(readFileSync(path, "utf8"), {
    loader: "tsx", jsx: "automatic", format: "cjs",
  }).code)((id: string) => id.endsWith("/lib/store")
    ? { ...local(id), useEditor: (select: any) => select(useEditor.getState()) }
    : direct && id === "react" ? { ...React, useState: (value: unknown) => [value, () => {}] } : local(id), mod, mod.exports);
  return mod.exports;
}
function convert(doc: SiteDoc, nodeId = "card") {
  useEditor.getState().replaceDoc(doc); useEditor.getState().setActivePage("p"); useEditor.getState().select(nodeId);
  // 設定画面の実際のボタンを取り出し、その onClick から store の操作を呼ぶ。
  const tree = loadUi("components/SettingsPanel.tsx", true).default({ nodeId });
  const find = (el: any): any => {
    if (el?.type === "button" && React.Children.toArray(el.props.children).includes("コンポーネント化")) return el;
    return React.Children.toArray(el?.props?.children).map(find).find(Boolean);
  };
  const button = find(tree); assert.ok(button, "SettingsPanel offers component conversion");
  button.props.onClick();
  return useEditor.getState().doc;
}
function canvas(doc: SiteDoc) {
  useEditor.getState().replaceDoc(doc);
  const { VarsCtx } = require("../components/canvas/render");
  const { NodeView } = loadUi("components/canvas/NodeView.tsx"), plan = pagePlan(doc, "p");
  return renderToStaticMarkup(React.createElement(VarsCtx.Provider, { value: {
    pageVars: previewDataVars(doc, "p"), preview: true, fieldValues: {}, clientVars: plan.clientVars, listOps: plan.listOps,
    setFieldValue() {}, refresh() {}, navigate() {},
  } }, doc.pages.p.children.map(id => React.createElement(NodeView, { id, key: id, isTop: true }))));
}
const details = (html: string) => parse(html).querySelectorAll('[id="detail"]').map((el: any) => el.textContent);

test("SettingsPanel component conversion retains nested list rows in Canvas and executed export, undo and reload", async () => {
  const before = componentListDoc(), original = structuredClone(before);
  assert.deepEqual(details(canvas(before)), details(await publishedComponentList(before)));
  const after = convert(before), instance = after.nodes[after.nodes.products.children[0]];
  assert.equal(instance.type, "instance");
  assert.equal(after.components![instance.componentId!].rootId, "card");
  assert.deepEqual(after.nodes.card, before.nodes.card);
  assert.deepEqual(after.nodes.tags, before.nodes.tags);
  assert.deepEqual(before, original, "conversion never mutates its input");
  assert.deepEqual(details(await publishedComponentList(after)), ["Detail First:red", "Detail First:blue", "Detail Second:green", "Detail Second:yellow"]);
  const past = useEditor.getState().past.length;
  useEditor.getState().undo(); assert.deepEqual(useEditor.getState().doc, before);
  useEditor.getState().redo(); assert.deepEqual(useEditor.getState().doc, after);
  assert.equal(useEditor.getState().past.length, past);
  const reloaded = JSON.parse(JSON.stringify(after));
  assert.deepEqual(details(canvas(reloaded)), details(await publishedComponentList(reloaded)));
  const saved = structuredClone(after);
  assert.deepEqual(generateProject(after), generateProject(after), "deterministic generated output");
  assert.deepEqual(after, saved, "export does not change the saved document");
});

test("nested component instances retain per-item scripts, independent visibility and existing anchor rules", async () => {
  let doc = componentListDoc();
  // 2段の部品と、ルートが参照の部品も store の変換で作る。
  doc.nodes.tagBox = { ...makeBox(), id: "tagBox", children: ["tags"] };
  doc.nodes.card.children = ["name", "tagBox"];
  doc = convert(doc, "tagBox");
  const inner = doc.nodes.card.children[1];
  doc.nodes[inner].hiddenOn = ["lg"]; doc.nodes[inner].attrId = "ignored-nested";
  doc = convert(doc);
  const outer = doc.nodes.products.children[0];
  doc.nodes[outer].hiddenOn = ["sm"]; doc.nodes[outer].attrId = "card-anchor";
  const names = buildClassNames(doc), html = await publishedComponentList(doc), root = parse(html);
  assert.equal(details(html).length, 4);
  assert.equal(root.querySelectorAll('[id="card-anchor"]').length, 2);
  assert.equal(root.querySelectorAll('[id="ignored-nested"]').length, 0);
  assert.equal(root.querySelectorAll(`[data-instance-hidden="${names.get(outer)}"]`).length, 2);
  assert.equal(root.querySelectorAll(`[data-instance-hidden="${names.get(inner)}"]`).length, 2);
  assert.equal(root.querySelectorAll("[data-row]").length, 6, "component-contained scripts retain both row scopes");
  doc.nodes.card.attrId = "master-card";
  const masterHtml = await publishedComponentList(doc);
  assert.match(masterHtml, /id="master-card"/); assert.doesNotMatch(masterHtml, /id="card-anchor"/);
  // ルートが参照の場合はIDを増やさず、2つの非表示条件だけを引き継ぐ。
  doc.components!.alias = { id: "alias", name: "Alias", rootId: inner };
  doc.nodes.card.children = ["alias"];
  doc.nodes.alias = { ...makeBox(), id: "alias", type: "instance", componentId: "alias", hiddenOn: ["sm"], attrId: "ignored-alias" };
  const aliasHtml = await publishedComponentList(doc), aliasNames = buildClassNames(doc);
  assert.equal(details(aliasHtml).length, 4);
  assert.doesNotMatch(aliasHtml, /id="ignored-(?:nested|alias)"/);
  assert.ok(aliasHtml.includes(`data-instance-hidden="${aliasNames.get(inner)} ${aliasNames.get("alias")}"`));
});

test("shared list components resolve each page and each placement's own data and server operations", async () => {
  const doc = convert(componentListDoc()), instance = doc.nodes[doc.nodes.products.children[0]];
  doc.nodes.copy = { ...instance, id: "copy" };
  doc.nodes.products.children.push("copy");
  doc.nodes.secondUse = { ...instance, id: "secondUse" };
  doc.pages.second = { ...structuredClone(doc.pages.p), id: "second", slug: "second", children: ["secondUse"], pageScripts: [{
    id: "second-load", trigger: "load", pos: { x: 0, y: 0 }, steps: [
      { id: "second-fetch", kind: "fetch", url: "https://example.com/data", as: "tags", preview: { sample: [] } },
      { id: "second-sort", kind: "list-display", mode: "sort", array: "tags", field: "label", dir: "desc", op: "eq", value: "" },
    ],
  }] };
  doc.pageOrder.push("second");
  assert.deepEqual(details(await publishedComponentList(doc)), [
    "Detail First:red", "Detail First:blue", "Detail First:red", "Detail First:blue",
    "Detail Second:green", "Detail Second:yellow", "Detail Second:green", "Detail Second:yellow",
  ]);
  assert.deepEqual(details(await publishedComponentList(doc, "app/second/page.tsx", [{ label: "a" }, { label: "z" }])), ["Detail :z", "Detail :a"]);
  doc.nodes.tags.list!.limit = 1;
  doc.pages.second.pageScripts![0].steps.push({ id: "second-filter", kind: "list-display", mode: "filter", array: "tags", field: "label", op: "eq", not: true, value: "zz", dir: "asc" });
  assert.deepEqual(details(await publishedComponentList(doc, "app/second/page.tsx", [{ label: "a" }, { label: "z" }, { label: "zz" }])), ["Detail :z"]);
});

test("exported list template proxies preserve placeholders under own-only lookup", () => {
  const doc = componentListDoc();
  doc.pages.p.children = ["card"];
  doc.pages.p.pageScripts = [{
    id: "load", trigger: "load", pos: { x: 0, y: 0 },
    steps: [{ id: "load-tags", kind: "store-load", key: "tags", into: "tags" }],
  }];
  const source = generateProject(doc).files["app/page.tsx"];
  const helper = source.match(/^function templateVars\(vars: Vars\): Vars \{[\s\S]*?^\}/m)?.[0];
  assert.ok(helper, "client-list pages must include the templateVars helper");
  const code = transformSync(helper + "\nexport { templateVars };", {
    loader: "ts", format: "cjs",
  }).code;
  const output = { exports: {} as { templateVars?: (vars: Record<string, unknown>) => Record<string, unknown> } };
  new Function("module", "exports", code)(output, output.exports);
  const templateVars = output.exports.templateVars;
  assert.ok(templateVars);
  const scope = templateVars(Object.create(null));
  assert.equal(lookupVar(scope, "row.meta.name"), "{row.meta.name}");
  assert.equal(interpolate("Hello {row.meta.name}", scope), "Hello {row.meta.name}");
  const present = Object.assign(Object.create(null), { name: "real" });
  assert.equal(lookupVar(templateVars(present), "name"), "real");
  assert.equal(lookupVar({}, "constructor"), undefined,
    "plain JSON must still reject inherited properties");
});

test("client-list templates retain placeholders and raw content through conversion", async () => {
  const doc = componentListDoc();
  doc.pages.p.children = ["card"];
  doc.pages.p.pageScripts = [{ id: "load", trigger: "load", pos: { x: 0, y: 0 }, steps: [
    { id: "load-tags", kind: "store-load", key: "tags", into: "tags" },
  ] }];
  doc.nodes.row.children.push("raw");
  doc.nodes.raw = { ...makeBox(), id: "raw", type: "code", code: { html: "<b>{label}</b>" } };
  doc.nodes.hide.scripts![0].steps.push({ id: "template-url", kind: "open-url", url: "/tags/{label}?literal=\\{label}" });
  const before = await publishedComponentList(doc), after = await publishedComponentList(convert(doc));
  assert.deepEqual(details(after), details(before));
  assert.match(after, /data-client-list/); assert.match(after, /data-tpl/);
  assert.match(after, /data-raw/);
  assert.match(after, /<b>\{label\}<\/b>/, "custom code must remain literal");
  const templateDetail = parse(after).querySelector('[data-tpl] [id="detail"]');
  assert.ok(templateDetail, "the client-list template retains its detail node");
  const parts = JSON.parse(templateDetail.getAttribute("data-text-parts") ?? "[]") as Array<string | { name: string; fallback?: string }>;
  assert.deepEqual(parts.map((part) => typeof part === "string" ? part : { name: part.name }),
    ["Detail ", { name: "name" }, ":", { name: "label" }, ""],
    "text placeholders remain structured, with optional server-side fallback text");
  assert.ok(parts.every((part) =>
    typeof part === "string" || part.fallback === undefined || typeof part.fallback === "string"));
  const templateScripts = (html: string) => parse(html).querySelectorAll("[data-tpl] [data-scripts]")
    .map((el: any) => JSON.parse(el.getAttribute("data-scripts")));
  assert.deepEqual(templateScripts(after), templateScripts(before));
  assert.match(JSON.stringify(templateScripts(after)), /tags.*label.*literal/);
});

test("list-bearing component cycles terminate, while ordinary static component files stay unchanged", async () => {
  const doc = convert(componentListDoc()), instance = doc.nodes[doc.nodes.products.children[0]];
  doc.nodes.cycle = { ...instance, id: "cycle" };
  doc.nodes.card.children.push("cycle");
  const saved = structuredClone(doc);
  assert.equal(details(await publishedComponentList(doc)).length, 4);
  assert.deepEqual(doc, saved);
  doc.nodes.static = { ...makeText("Static content"), id: "static" };
  doc.components!.static = { id: "static", rootId: "static", name: "Static" };
  doc.nodes.staticUse = { ...makeBox(), id: "staticUse", type: "instance", componentId: "static", attrId: "static-anchor" };
  doc.pages.p.children.push("staticUse");
  const mixed = generateProject(doc).files;
  const plain = structuredClone(doc); plain.pages.p.children = ["staticUse"];
  assert.equal(mixed["components/Static.tsx"], generateProject(plain).files["components/Static.tsx"]);
  assert.match(mixed["app/page.tsx"], /<Static instanceId="static-anchor" \/>/);
});

test("static nested components and form boundaries keep their standalone behavior", async () => {
  const doc = convert(componentListDoc()), instance = doc.nodes[doc.nodes.products.children[0]];
  doc.nodes.static = { ...makeText("Static {name}"), id: "static" };
  doc.components!.static = { id: "static", rootId: "static", name: "Static" };
  doc.nodes.staticUse = { ...makeBox(), id: "staticUse", type: "instance", componentId: "static", attrId: "ignored-static-anchor", hiddenOn: ["lg"] };
  doc.nodes.card.children.push("staticUse", "inside-button");
  doc.nodes["inside-button"] = { ...makeText("Inside"), id: "inside-button", semantic: "button" };
  doc.nodes["outside-button"] = { ...makeText("Outside"), id: "outside-button", semantic: "button" };
  doc.nodes.form = { ...makeBox(), id: "form", semantic: "form", children: ["products", "outside-button"] };
  doc.pages.p.children = ["form"];
  instance.attrId = 'card"<&';
  const { files } = generateProject(doc), names = buildClassNames(doc);
  assert.ok(files["app/page.tsx"].includes(`className="${names.get("inside-button")}" type="button"`));
  assert.ok(files["app/page.tsx"].includes(`className="${names.get("outside-button")}" type="submit"`));
  // 検索フォームのルーターはこの描画テストの対象外。
  doc.nodes.form.semantic = "div";
  const html = await publishedComponentList(doc);
  assert.doesNotMatch(html, /ignored-static-anchor/);
  assert.match(html, /id="card&quot;&lt;&amp;"/);
  assert.match(html, /data-toggle-show="flex"/);
  assert.match(files["app/page.tsx"], /<Static hiddenClassName="[^"]+" \/>/);
  assert.match(files["components/Static.tsx"], /interpolate\("Static \{name\}", \{\}\)/);
  const standalone = structuredClone(doc); standalone.pages.p.children = ["staticUse"];
  assert.equal(files["components/Static.tsx"], generateProject(standalone).files["components/Static.tsx"]);
});

test("script discovery preserves an instance's own scripts without expanding static components", () => {
  const doc = componentListDoc();
  doc.nodes.staticUse = { ...makeBox(), id: "staticUse", type: "instance", componentId: "missing", scripts: structuredClone(doc.nodes.hide.scripts) };
  assert.equal(hasScriptsInside(doc, "staticUse", new Set()), true);
});

test("converted server and client list projects typecheck", () => {
  const doc = convert(componentListDoc());
  doc.nodes.clientUse = { ...doc.nodes[doc.nodes.products.children[0]], id: "clientUse" };
  doc.pages.client = { ...structuredClone(doc.pages.p), id: "client", slug: "client", children: ["clientUse"], pageScripts: [{
    id: "load", trigger: "load", pos: { x: 0, y: 0 }, steps: [
      { id: "load-raw", kind: "store-load", key: "raw-tags", into: "rawTags" },
      { id: "split-tags", kind: "transform", source: "rawTags", into: "tags", transform: { kind: "split", separator: "," } },
    ],
  }] };
  doc.pageOrder.push("client");
  const { files } = generateProject(doc), dir = mkdtempSync(join(tmpdir(), "tsumu-component-list-types-"));
  try {
    symlinkSync(resolve("node_modules"), join(dir, "node_modules"), "dir");
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true }); writeFileSync(join(dir, path), content);
    }
    execFileSync(process.execPath, [join(dirname(require.resolve("typescript/package.json")), "bin/tsc"), "--project", join(dir, "tsconfig.json"), "--noEmit", "--incremental", "false"], { cwd: dir, stdio: "pipe" });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("native conversion regression bundles actual SettingsPanel, Canvas and store", async () => {
  const bundle = await componentListBundle();
  for (const name of ["SettingsPanel", "Canvas", "GhostView"]) assert.match(bundle, new RegExp(`function ${name}`));
  assert.match(bundle, /createComponent/);
});
