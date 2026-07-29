import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { build } from "esbuild";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { splitVarTokens } from "../lib/vars";

// このモデルはeditableTextの走査だけに使う。Selection・IMEなどブラウザの編集動作は再現しない。
class TextNode {
  nodeType = 3;
  constructor(public data: string) {}
}
class Element {
  nodeType = 1;
  dataset: Record<string, string> = {};
  constructor(public tagName: string, public childNodes: (Element | TextNode)[] = []) {}
}
class Br extends Element {
  constructor() { super("BR"); this.dataset.end = "1"; }
}
Object.assign(globalThis, { Node: { TEXT_NODE: 3 }, HTMLElement: Element, HTMLBRElement: Br });

function editableDom(text: string) {
  const children = splitVarTokens(text).map((part) => part.name === undefined
    ? new TextNode(part.text) : new Element("SPAN", [new TextNode(part.text)]));
  if (!text || text.endsWith("\n")) children.push(new Br());
  return new Element("DIV", children);
}

let blur: (event: { currentTarget: Element }) => void;
const result = await build({
  stdin: { contents: `export {NodeView} from "./components/canvas/NodeView"; export {useEditor} from "./lib/store"; export {makeText,makeBox} from "./lib/presets"; export {editableText} from "./lib/editable";`, resolveDir: resolve("."), loader: "tsx" },
  bundle: true, platform: "node", format: "cjs", packages: "external", write: false,
});
const module = { exports: {} as any };
const require = createRequire(resolve("package.json"));
new Function("require", "module", "exports", result.outputFiles[0].text)((id: string) => id === "react" ? {
  ...React,
  createElement(type: any, props: any, ...children: any[]) {
    if (props?.["data-rich-edit"]) blur = props.onBlur;
    return React.createElement(type, props, ...children);
  },
} : require(id), module, module.exports);
const { NodeView, useEditor, makeText, makeBox, editableText } = module.exports;

function begin(content: string | null) {
  const doc = structuredClone(useEditor.getState().doc);
  const pageId = doc.pageOrder[0];
  doc.pageOrder = [pageId];
  doc.pages = { [pageId]: { ...doc.pages[pageId], children: ["text"] } };
  doc.nodes = { text: { ...(content === null ? makeBox() : makeText(content)), id: "text" } };
  useEditor.getState().replaceDoc(doc);
  return doc;
}
function commit(content: string) {
  useEditor.getState().setEditingText("text");
  // SSRの購読先は初期スナップショットなので、実ストアの現在値を合わせてから描画する。
  Object.assign(useEditor.getInitialState(), useEditor.getState());
  renderToStaticMarkup(React.createElement(NodeView, { id: "text", isTop: true }));
  const el = editableDom(content);
  assert.equal(editableText(el), content, "the placeholder is not part of the saved text");
  blur({ currentTarget: el });
}

for (const content of ["", "\n", "\n\n", "Plain text", "First\nSecond\n", "Hello {profile.name}\n\n", "<&> {name}\n"]) {
  test(`leaving an unchanged text edit preserves ${JSON.stringify(content)}`, () => {
    const before = begin(content);
    for (let repeat = 0; repeat < 3; repeat++) {
      commit(content);
      assert.equal(useEditor.getState().doc.nodes.text.text.content, content);
      assert.deepEqual(useEditor.getState().doc, before);
      assert.equal(useEditor.getState().past.length, 0, "an unchanged edit must not create undo history");
    }
  });
}

test("committed multiline text survives undo, redo and document serialization", () => {
  const before = begin("Before");
  const content = "First\n{profile.name}\n\n";
  commit(content);
  assert.equal(useEditor.getState().doc.nodes.text.text.content, content);
  assert.equal(useEditor.getState().past.length, 1);
  const saved = JSON.parse(JSON.stringify(useEditor.getState().doc));
  useEditor.getState().undo();
  assert.deepEqual(useEditor.getState().doc, before);
  useEditor.getState().redo();
  assert.deepEqual(useEditor.getState().doc, saved);
  useEditor.getState().replaceDoc(saved);
  commit(content);
  assert.deepEqual(useEditor.getState().doc, saved);
  assert.equal(useEditor.getState().past.length, 0);
});

test("an untouched empty box stays a container, but a deliberate blank line is text", () => {
  begin(null);
  commit("");
  assert.equal(useEditor.getState().doc.nodes.text.text, null);
  assert.equal(useEditor.getState().past.length, 0);
  commit("\n");
  assert.deepEqual(useEditor.getState().doc.nodes.text.text, { content: "\n", heading: 0 });
  useEditor.getState().undo();
  assert.equal(useEditor.getState().doc.nodes.text.text, null);
});
