import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { pageArrays, pagePlan, previewDataVars } from "../lib/data";
import { SCRIPT_RUNTIME, scriptsFile } from "../lib/script-runtime";
import { useEditor } from "../lib/store";
import type { SiteDoc } from "../lib/types";
import { ArraySelect } from "../components/script-editor/arrays";
import { Ctx, type EdCtx } from "../components/script-editor/context";
import { nestedOperationsDoc, publishedNestedOperations } from "./helpers/nested-list-operations";

const require = createRequire(import.meta.url);
const { parse } = require("next/dist/compiled/node-html-parser");

function canvasMarkup(doc: SiteDoc, preview = true) {
  useEditor.getState().replaceDoc(doc);
  const file = resolve("components/canvas/NodeView.tsx"), local = createRequire(file), mod = { exports: {} as any };
  const code = transformSync(readFileSync(file, "utf8"), { loader: "tsx", jsx: "automatic", format: "cjs" }).code;
  new Function("require", "module", "exports", code)((id: string) => id.endsWith("/lib/store")
    ? { ...local(id), useEditor: (select: any) => select(useEditor.getState()) } : local(id), mod, mod.exports);
  const { VarsCtx } = local("./render"), plan = pagePlan(doc, "p");
  return renderToStaticMarkup(createElement(VarsCtx.Provider, { value: {
    pageVars: previewDataVars(doc, "p"), preview, fieldValues: {}, clientVars: plan.clientVars, listOps: plan.listOps,
    setFieldValue() {}, refresh() {}, navigate() {},
  } }, doc.pages.p.children.map(id => createElement(mod.exports.NodeView, { id, key: id, isTop: true }))));
}

// 実際の React の出力を読み、ランタイムが使う DOM の操作だけを再現する。
// 実際のブラウザでのキャンバス・スクリプトの画面・イベントは、e2e/ で確かめる。
class Element {
  attrs: Record<string, string>;
  children: Element[];
  nodeType = 1;
  style: { display: string };
  handlers = new Map<string, Function[]>();
  constructor(node: any, public parentElement: Element | null = null) {
    this.attrs = node.attributes;
    this.style = { display: /display:([^;]+)/.exec(this.attrs.style ?? "")?.[1] ?? "" };
    this.children = node.childNodes.filter((n: any) => n.nodeType === 1).map((n: any) => new Element(n, this));
  }
  getAttribute(name: string) { return this.attrs[name] ?? null; }
  hasAttribute(name: string) { return name in this.attrs; }
  matches(selector: string): boolean {
    return selector.split(",").some(s => {
      if (s.startsWith("#")) return this.attrs.id === s.slice(1);
      const attr = /^\[([^=\]]+)(?:="([^"]*)")?\]$/.exec(s);
      return !!attr && (attr[2] === undefined ? this.hasAttribute(attr[1]) : this.attrs[attr[1]] === attr[2]);
    });
  }
  querySelectorAll(selector: string): Element[] {
    return this.children.flatMap(c => [...(c.matches(selector) ? [c] : []), ...c.querySelectorAll(selector)]);
  }
  querySelector(selector: string) { return this.querySelectorAll(selector)[0] ?? null; }
  closest(selector: string): Element | null { return this.matches(selector) ? this : this.parentElement?.closest(selector) ?? null; }
  contains(el: Element): boolean { return el === this || this.children.some(c => c.contains(el)); }
  appendChild(el: Element) {
    if (el.parentElement) el.parentElement.children = el.parentElement.children.filter(c => c !== el);
    this.children.push(el); el.parentElement = this;
  }
  addEventListener(type: string, fn: Function, capture = false) {
    if (!capture) this.handlers.set(type, [...(this.handlers.get(type) ?? []), fn]);
  }
  removeEventListener() {}
}

function runtime(html: string, source: string) {
  const root = new Element(parse(html));
  const dispose = runInNewContext(source, {
    document: root, CSS: { escape: (v: string) => v }, Event,
    MutationObserver: class { observe() {} disconnect() {} },
    requestAnimationFrame() {}, setTimeout() {}, clearTimeout() {},
  });
  return {
    rows: () => root.querySelectorAll('[id="tags-list"]').map(list => list.children
      .filter(row => row.hasAttribute("data-item") && row.style.display !== "none")
      .map(row => JSON.parse(row.getAttribute("data-item")!).label)),
    async click(id: string) {
      const target = root.querySelector(`#${id}`); assert.ok(target, id);
      for (const handler of root.handlers.get("click") ?? []) handler({ target, preventDefault() {} });
      await new Promise<void>(done => setImmediate(done));
    },
    dispose,
  };
}

test("the nested source is a real named page array offered by ScriptEditor's ArraySelect", () => {
  const doc = nestedOperationsDoc();
  const html = renderToStaticMarkup(createElement(Ctx.Provider, { value: { arrays: pageArrays(doc, "p") } as EdCtx },
    createElement(ArraySelect, { value: "", onChange() {} })));
  assert.match(html, /class="[^"]*se-list-choice/);
  assert.match(html, /aria-haspopup="listbox"/);
  assert.doesNotMatch(html, /見つかりません/);
});

test("list candidates expand only the first sampled array item, including nested arrays", () => {
  const doc = nestedOperationsDoc();
  const fetch = doc.pages.p.pageScripts![0].steps[0];
  assert.equal(fetch.kind, "fetch");
  if (fetch.kind !== "fetch") return;
  fetch.preview = {
    sample: Array.from({ length: 20 }, (_, index) => ({
      name: "Row " + index,
      tags: [{ label: "Tag " + index }],
      details: { labels: ["Label " + index] },
    })),
  };
  const candidates = pageArrays(doc, "p").map(({ name }) => name);
  for (const name of ["response", "response.0", "response.0.tags", "response.0.tags.0",
    "response.0.details", "response.0.details.labels"]) {
    assert.ok(candidates.includes(name), name);
  }
  assert.ok(!candidates.some((name) => /^response\.[1-9]\d*(?:\.|$)/.test(name)),
    "only the first list record should be expanded into candidate paths");
});

for (const component of [false, true]) test(`${component ? "component" : "nested"} lists: runtime sort, filter and clear affect every rendered list`, async () => {
  const doc = nestedOperationsDoc(component), before = structuredClone(doc);
  const exported = runtime(await publishedNestedOperations(doc), scriptsFile(doc));
  const canvas = runtime(canvasMarkup(doc), `(${SCRIPT_RUNTIME})({}).install(document)`);
  const expected: Array<[string, string[][]]> = [
    ["descending", [["red", "blue"], ["yellow", "green"]]],
    ["descending", [["red", "blue"], ["yellow", "green"]]],
    ["filter", [["red"], ["green"]]],
    ["filter", [["red"], ["green"]]],
    ["empty", [[], []]],
    ["clear", [["red", "blue"], ["yellow", "green"]]],
    ["ascending", [["blue", "red"], ["green", "yellow"]]],
    ["filter", [["red"], ["green"]]],
    ["clear", [["blue", "red"], ["green", "yellow"]]],
  ];
  assert.deepEqual(canvas.rows(), [["red", "blue"], ["green", "yellow"]]);
  assert.deepEqual(canvas.rows(), exported.rows());
  for (const [action, rows] of expected) {
    await exported.click(action); assert.deepEqual(exported.rows(), rows, `generated ${action}`);
    await canvas.click(action);
    assert.deepEqual(canvas.rows(), rows, `Canvas ${action}`);
  }
  canvas.dispose();
  const restarted = runtime(canvasMarkup(doc), `(${SCRIPT_RUNTIME})({}).install(document)`);
  assert.deepEqual(restarted.rows(), [["red", "blue"], ["green", "yellow"]], "new preview resets temporary list operations");
  restarted.dispose();
  assert.doesNotMatch(canvasMarkup(doc, false), /data-array=|data-item=|data-scripts=/);
  assert.deepEqual(doc, before, "runtime operations never change the saved document");
});
