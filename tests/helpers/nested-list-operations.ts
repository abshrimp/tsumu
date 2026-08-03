import { build } from "esbuild";
import { resolve } from "node:path";
import { makeBox, makeText } from "../../lib/presets";
import type { ScriptStep } from "../../lib/types";
import { nestedScopeDoc } from "./nested-script-scope";
import { publishedComponentList } from "./component-list-export";

export const listActions = ["descending", "ascending", "filter", "empty", "clear"] as const;
export function nestedOperationsDoc(component = false, selected = true) {
  const doc = nestedScopeDoc();
  const load = doc.pages.p.pageScripts![0];
  load.pos = { x: 800, y: 20 };
  // スクリプト画面で選べる名前付き配列。各リストでは項目内の tags を優先する。
  load.steps.push({ id: "tags-alias", kind: "set-var", value: "{response.0.tags}", into: "tags" });
  doc.nodes.row.children = ["detail"];
  delete doc.nodes.hide; delete doc.nodes.show;
  doc.nodes.tags.attrId = "tags-list";
  const array = selected ? "tags" : "";
  const steps: ScriptStep[] = [
    { id: "descending-step", kind: "sort-array", array, field: "label", dir: "desc" },
    { id: "ascending-step", kind: "sort-array", array, field: "label", dir: "asc" },
    { id: "filter-step", kind: "filter-array", array, field: "label", op: "contains", value: "r", no: 1 },
    { id: "empty-step", kind: "filter-array", array, field: "label", op: "eq", value: "missing", no: 2 },
    { id: "clear-step", kind: "unfilter-array", array },
  ];
  for (const [i, action] of listActions.entries()) doc.nodes[action] = {
    ...makeText(action), id: action, attrId: action, semantic: "button",
    scripts: [{ id: `${action}-script`, trigger: "click", pos: { x: 20, y: 20 + i * 160 }, steps: [steps[i]] }],
  };
  doc.pages.p.children = [...listActions, "products", "other"];
  if (component) {
    doc.nodes.card.children = ["name", "instance"];
    doc.nodes.instance = { ...makeBox(), id: "instance", type: "instance", componentId: "tag-card" };
    doc.nodes.master = { ...makeBox(), id: "master", children: ["tags"] };
    doc.components = { "tag-card": { id: "tag-card", name: "Tags", rootId: "master" } };
  }
  return doc;
}

/** 実際のスクリプト画面で配列を選び、キャンバスで動作させる。 */
export async function nestedOperationsBundle(component = false) {
  return (await build({ stdin: { contents: `
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import ScriptEditor from "./components/ScriptEditor";
import Canvas from "./components/Canvas";
import { useEditor } from "./lib/store";
import css from "./app/globals.css";
const style = document.createElement("style"); style.textContent = css; document.head.append(style);
useEditor.getState().replaceDoc(${JSON.stringify(nestedOperationsDoc(component, false))});
useEditor.getState().setActivePage("p");
window.nestedOperationsStore = useEditor;
function Example() {
  const [edit, setEdit] = useState(null);
  const mode = useEditor(s => s.mode);
  return <>{${JSON.stringify(listActions)}.map(action => <button key={action} onClick={() => setEdit(action)}>Edit {action}</button>)}
    <button onClick={() => useEditor.getState().setMode(mode === "preview" ? "design" : "preview")}>Toggle preview</button>
    <Canvas />
    {edit && <ScriptEditor focusNodeId={edit} focusScriptId={edit + "-script"} onClose={() => setEdit(null)} />}
  </>;
}
createRoot(document.getElementById("app")).render(<Example />);
`, loader: "tsx", sourcefile: "nested-list-operations-browser.tsx", resolveDir: resolve(".") },
    loader: { ".css": "text" }, bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
  })).outputFiles[0].text;
}

export const publishedNestedOperations = publishedComponentList;
