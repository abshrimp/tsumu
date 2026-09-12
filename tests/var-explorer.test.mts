import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { transformSync } from "esbuild";
import * as React from "react";
import { useEditor } from "../lib/store";
import { varExplorerBundle, varExplorerDoc } from "./helpers/var-explorer";

const state = () => useEditor.getState();
const snapshot = () => structuredClone({ doc: state().doc, past: state().past, future: state().future });
function nodes(tree: any): any[] {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}

// 実際のソースのフックとイベントを実行する。DOM のキーボードの伝播とフォーカスは、e2e で確かめる。
function mount() {
  state().replaceDoc(varExplorerDoc()); state().setActivePage("p");
  const root = { slots: [] as any[], effects: [] as (() => void)[], changed: false };
  let current = root;
  let cursor = 0;
  const hooks = {
    ...React,
    useState(initial: any) {
      const i = cursor++, instance = current;
      if (!(i in instance.slots)) instance.slots[i] = typeof initial === "function" ? initial() : initial;
      return [instance.slots[i], (next: any) => {
        const value = typeof next === "function" ? next(instance.slots[i]) : next;
        if (!Object.is(value, instance.slots[i])) { instance.slots[i] = value; instance.changed = true; }
      }];
    },
    useRef(initial: any) { return current.slots[cursor++] ??= { current: initial }; },
    useMemo(fn: () => any, deps: any[]) {
      const i = cursor++, previous = current.slots[i];
      if (!previous || deps.some((v, n) => !Object.is(v, previous.deps[n]))) current.slots[i] = { deps, value: fn() };
      return current.slots[i].value;
    },
    useEffect(fn: () => void, deps: any[]) {
      const i = cursor++, previous = current.slots[i];
      if (!previous || deps.some((v, n) => !Object.is(v, previous[n]))) {
        current.slots[i] = deps; current.effects.push(fn);
      }
    },
  };
  const require = createRequire(resolve("components/VarExplorer.tsx"));
  const mod = { exports: {} as any };
  const code = transformSync(readFileSync("components/VarExplorer.tsx", "utf8"), { loader: "tsx", jsx: "automatic", format: "cjs" }).code;
  new Function("require", "module", "exports", "document", code)((id: string) =>
    id === "react" ? hooks : id === "react-dom" ? { createPortal: (tree: any) => tree } :
    id === "../lib/store" ? { useEditor: (select: any) => select(state()) } : require(id),
  mod, mod.exports, { body: {} });
  const picks: string[] = [];
  const props = { nodeId: "target", onClose() {}, onPick(name: string) {
    picks.push(name); state().updateNode("target", { field: { kind: "input", defaultValue: `{${name}}` } });
  } };
  function draw(instance: typeof root, component: any, props: any) {
    let tree: any;
    do {
      current = instance; cursor = 0; instance.changed = false;
      tree = component(props); instance.effects.splice(0).forEach(fn => fn());
    } while (instance.changed);
    return tree;
  }
  const render = () => draw(root, mod.exports.default, props);
  const input = () => nodes(render()).find(n => n.type === "input").props;
  const rows = () => nodes(render()).filter(n => n.props?.className?.startsWith("vx-row"));
  const key = (key: string, extra: any = {}) => input().onKeyDown({ key, preventDefault() {}, ...extra });
  const query = (value: string) => { input().onChange({ target: { value } }); render(); };
  const toggle = () => { nodes(render()).find(n => n.type === "button" && "aria-pressed" in n.props).props.onClick(); render(); };
  return { picks, render, rows, key, query, toggle,
    selected: () => rows().find(n => n.props.className.includes("is-key"))?.props.children[0].props.children,
    row() {
      const element = nodes(render()).find(n => n.type?.name === "Row" && n.props.path === "product");
      const instance = { slots: [] as any[], effects: [] as (() => void)[], changed: false };
      return () => draw(instance, element.type, element.props);
    },
  };
}

test("hiding advanced search results keeps a highlighted, valid keyboard choice and one undo step", () => {
  const h = mount(); h.toggle(); h.query("search");
  assert.equal(h.rows().length, 3);
  h.key("ArrowDown"); h.key("ArrowDown");
  assert.match(h.selected(), /disabled/);
  const before = snapshot(); h.toggle();
  assert.equal(h.rows().length, 1); assert.equal(h.selected(), "search");
  assert.deepEqual(snapshot(), before, "browsing does not change the document or history");
  h.key("Enter"); assert.deepEqual(h.picks, ["search"]);
  assert.equal(state().doc.nodes.target.field?.defaultValue, "{search}");
  assert.equal(state().past.length, before.past.length + 1);
  assert.deepEqual(state().doc.nodes.other, before.doc.nodes.other);
  const after = structuredClone(state().doc);
  state().undo(); assert.deepEqual(state().doc, before.doc);
  state().redo(); assert.deepEqual(state().doc, after);
});

test("live document updates can shrink or empty a search without stale keyboard selection", () => {
  const h = mount(); h.toggle(); h.query("search"); h.key("ArrowUp");
  assert.match(h.selected(), /disabled/);
  state().updateNode("search", { field: undefined, type: "box", text: { content: "Search" } });
  assert.equal(h.rows().length, 1); assert.equal(h.selected(), "search");
  h.key("ArrowUp"); assert.equal(h.selected(), "search");
  h.key("ArrowDown"); h.key("Enter"); assert.deepEqual(h.picks, ["search"]);
  state().deleteNodes(["search"]);
  const before = snapshot(); h.key("Enter"); h.key("ArrowDown");
  assert.equal(h.rows().length, 0); assert.deepEqual(snapshot(), before);
});

test("query changes, wrapping, mouse choice and IME Enter still select only the intended variable", () => {
  const h = mount(); h.toggle(); h.query("search");
  h.key("ArrowUp"); assert.match(h.selected(), /disabled/);
  h.key("ArrowDown"); assert.equal(h.selected(), "search");
  h.query("product"); assert.equal(h.selected(), "product");
  h.key("Enter", { nativeEvent: { isComposing: true } });
  h.key("Enter", { nativeEvent: { keyCode: 229 } });
  assert.deepEqual(h.picks, []);
  const last = h.rows().at(-1)!; last.props.onMouseEnter();
  const selected = h.selected(); h.key("Enter");
  assert.equal(h.picks[0], "product.details.label"); assert.match(selected, /label/);
  h.rows()[0].props.onClick(); assert.deepEqual(h.picks, ["product.details.label", "product"]);
});

test("nested expand-button keys do not select the parent, while row keys and clicks still work", () => {
  const h = mount(); const draw = h.row();
  const row = () => nodes(draw()).find(n => n.props?.className === "vx-row").props;
  const parent = {}, button = {};
  const key = (key: string, target = parent, extra: any = {}) => row().onKeyDown({ key, target, currentTarget: parent, ...extra });
  const before = snapshot();
  key("Enter", button); key("ArrowRight", button);
  assert.deepEqual(h.picks, []); assert.deepEqual(snapshot(), before);
  key("ArrowRight"); assert.equal(nodes(draw()).find(n => n.type === "button").props["aria-expanded"], true);
  key("ArrowLeft"); assert.equal(nodes(draw()).find(n => n.type === "button").props["aria-expanded"], false);
  nodes(draw()).find(n => n.type === "button").props.onClick({ stopPropagation() {} });
  assert.equal(nodes(draw()).find(n => n.type === "button").props["aria-expanded"], true);
  key("Enter", parent, { nativeEvent: { isComposing: true } }); assert.deepEqual(h.picks, []);
  key("Enter"); row().onClick(); assert.deepEqual(h.picks, ["product", "product"]);
});

test("the actual settings-panel keyboard fixture bundles for Chromium", async () => {
  assert.match(await varExplorerBundle(), /pickerStore/);
});
