import { build, transformSync } from "esbuild";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { pagePlan, previewDataVars } from "../../lib/data";
import { makeText } from "../../lib/presets";
import { useEditor } from "../../lib/store";
import type { SiteDoc } from "../../lib/types";
import { nestedOperationsDoc } from "./nested-list-operations";
import { nestedScopeItems } from "./nested-script-scope";
export { publishedComponentList as publishedClientNested } from "./component-list-export";

export function clientNestedDoc(component = false) {
  const doc = nestedOperationsDoc(component);
  const load = doc.pages.p.pageScripts![0];
  load.steps = load.steps.filter(s => s.id !== "alias");
  doc.nodes.reload = { ...makeText("Load items"), id: "reload", attrId: "reload", semantic: "button", scripts: [{
    id: "reload-script", trigger: "click", pos: { x: 20, y: 20 }, steps: [{ id: "reload-step", kind: "set-var", value: "{response}", into: "items" }],
  }] };
  doc.pages.p.children.unshift("reload");
  doc.nodes.products.attrId = "products-list";
  doc.nodes.row.children.unshift("hide", "show");
  for (const kind of ["hide", "show"] as const) doc.nodes[kind] = {
    ...makeText(`${kind} {label}`), id: kind, attrId: kind, semantic: "button", scripts: [{
      id: `${kind}-script`, trigger: "click", pos: { x: 20, y: 20 }, steps: [{ id: `${kind}-step`, kind, target: "detail" }],
    }],
  };
  return doc;
}

export function loadNestedUi(file: string, direct = false) {
  const path = resolve(file), local = createRequire(path), mod = { exports: {} as any };
  new Function("require", "module", "exports", transformSync(readFileSync(path, "utf8"), {
    loader: "tsx", jsx: "automatic", format: "cjs",
  }).code)((id: string) => id.endsWith("/lib/store")
    ? { ...local(id), useEditor: (select: any) => select(useEditor.getState()) }
    : direct && id === "react" ? { ...React, useState: (v: unknown) => [v, () => {}] } : local(id), mod, mod.exports);
  return mod.exports;
}

export function clientNestedCanvas(doc: SiteDoc, items: unknown[] = nestedScopeItems) {
  useEditor.getState().replaceDoc(doc);
  const local = createRequire(resolve("components/canvas/NodeView.tsx")), { VarsCtx } = local("./render");
  const { NodeView } = loadNestedUi("components/canvas/NodeView.tsx"), plan = pagePlan(doc, "p");
  return renderToStaticMarkup(React.createElement(VarsCtx.Provider, { value: {
    pageVars: { ...previewDataVars(doc, "p"), items }, preview: true, fieldValues: {}, clientVars: plan.clientVars, listOps: plan.listOps,
    setFieldValue() {}, refresh() {}, navigate() {},
  } }, doc.pages.p.children.map(id => React.createElement(NodeView, { id, key: id, isTop: true }))));
}

/** 設定画面で内側の配列を選び、スクリプト画面で外側をブラウザで読み込む設定にする。 */
export async function clientNestedBundle(component = false) {
  const doc = clientNestedDoc(component);
  doc.nodes.tags.list!.from = "";
  (doc.nodes.reload.scripts![0].steps[0] as { value: string }).value = "";
  return (await build({ stdin: { contents: `
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import SettingsPanel from "./components/SettingsPanel";
import ScriptEditor from "./components/ScriptEditor";
import Canvas from "./components/Canvas";
import { useEditor } from "./lib/store";
import css from "./app/globals.css";
const style = document.createElement("style"); style.textContent = css; document.head.append(style);
useEditor.getState().replaceDoc(${JSON.stringify(doc)});
useEditor.getState().setActivePage("p"); useEditor.getState().select("tags");
window.clientNestedStore = useEditor;
function Example() {
  const [edit, setEdit] = useState(false), mode = useEditor(s => s.mode);
  const selected = useEditor(s => s.selection);
  return <><button onClick={() => setEdit(true)}>Edit loading</button>
    <button onClick={() => useEditor.getState().setMode(mode === "preview" ? "design" : "preview")}>Toggle preview</button>
    <button onClick={() => useEditor.getState().undo()}>Undo</button>
    <button onClick={() => useEditor.getState().redo()}>Redo</button>
    <button onClick={() => useEditor.getState().replaceDoc(JSON.parse(JSON.stringify(useEditor.getState().doc)))}>Reload saved</button>
    <aside>{selected && <SettingsPanel nodeId={selected} />}</aside><Canvas />
    {edit && <ScriptEditor focusNodeId="reload" focusScriptId="reload-script" onClose={() => setEdit(false)} />}
  </>;
}
createRoot(document.getElementById("app")).render(<Example />);
`, resolveDir: resolve("."), sourcefile: "client-nested-lists-browser.tsx", loader: "tsx" },
    loader: { ".css": "text" }, bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
  })).outputFiles[0].text;
}
