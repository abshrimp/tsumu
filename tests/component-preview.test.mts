import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";
import * as React from "react";
import { makeBox } from "../lib/presets";
import type { DocNode } from "../lib/types";

function renderRoot(patch: Partial<DocNode>, preview = true) {
  const filename = new URL("../components/canvas/NodeView.tsx", import.meta.url);
  const require = createRequire(filename);
  const { VarsCtx } = require("./render");
  const actions: string[] = [];
  const ctx = { preview, pageVars: { destination: "https://example.org/path" }, clientVars: new Set(), refresh: () => actions.push("refresh"), navigate: (url: string) => actions.push(url) };
  const root = { ...makeBox(), id: "root", text: { content: "Click", heading: 0 }, ...patch };
  const state = {
    doc: { nodes: { root, inst: { ...makeBox(), id: "inst", type: "instance", componentId: "c" } }, components: { c: { id: "c", rootId: "root" } }, pages: {} },
    mode: preview ? "preview" : "design", selectedIds: ["inst"], editingText: null,
    setActivePage: (id: string) => actions.push(`page:${id}`),
  };
  const mod = { exports: {} as { NodeView: (props: object) => any } };
  const code = transformSync(readFileSync(filename, "utf8"), { loader: "tsx", jsx: "automatic", format: "cjs" }).code;
  new Function("require", "module", "exports", code)((id: string) => {
    if (id === "../../lib/store") return { useEditor: (select: any) => select(state) };
    if (id === "react") return { ...React, useContext: (context: unknown) => context === VarsCtx ? ctx : [] };
    return require(id);
  }, mod, mod.exports);
  const element = mod.exports.NodeView({ id: "inst", isTop: true }).props.children;
  const click = () => element.props.onClick({ preventDefault: () => actions.push("prevent"), currentTarget: { closest: () => ({}) } });
  return { element, actions, click };
}

test("component preview retains root IDs and click scripts on the instance element", () => {
  const { element } = renderRoot({ attrId: "menu", scripts: [{ id: "sc", trigger: "click", pos: { x: 0, y: 0 }, steps: [{ id: "st", kind: "open-url", url: "https://example.org" }] }] });
  assert.equal(element.props.id, "menu");
  assert.equal(element.props["data-node"], "inst");
  assert.equal(element.props["data-ghost"], "root");
  assert.equal(JSON.parse(element.props["data-scripts"])[0].steps[0].url, "https://example.org");
});

test("component root URL links navigate with interpolated and sanitized URLs", () => {
  const result = renderRoot({ link: { kind: "url", url: "{destination}" } });
  assert.equal(result.element.type, "a");
  assert.equal(result.element.props.href, "https://example.org/path");
  result.click();
  assert.deepEqual(result.actions, ["prevent", "https://example.org/path"]);
  assert.equal(renderRoot({ link: { kind: "url", url: "javascript:alert(1)" } }).element.props.href, "#");
});

test("component root page links switch pages and new-tab links retain protections", () => {
  const page = renderRoot({ link: { kind: "page", pageId: "about" } });
  page.click();
  assert.deepEqual(page.actions, ["prevent", "page:about"]);
  const tab = renderRoot({ link: { kind: "url", url: "https://example.org", newTab: true } });
  assert.equal(tab.element.props.target, "_blank");
  assert.equal(tab.element.props.rel, "noopener noreferrer");
});

test("component root buttons use preview submission behavior without overriding click scripts", () => {
  const button = renderRoot({ semantic: "button" });
  assert.equal(button.element.props.type, "button");
  button.click();
  assert.deepEqual(button.actions, ["refresh"]);
  const scripted = renderRoot({ semantic: "button", scripts: [{ id: "sc", trigger: "click", pos: { x: 0, y: 0 }, steps: [] }] });
  assert.equal(scripted.element.props.onClick, undefined);
});

test("component editing stays selectable without activating master links", () => {
  const { element } = renderRoot({ link: { kind: "url", url: "https://example.org" } }, false);
  assert.equal(element.type, "div");
  assert.equal(element.props.href, undefined);
  assert.equal(element.props.onClick, undefined);
  assert.equal(element.props["data-sel"], "true");
});
